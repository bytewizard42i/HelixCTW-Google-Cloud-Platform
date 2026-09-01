// SPDX-License-Identifier: Apache-2.0
// Reused with attribution from MidnightHelixCTW/apps/api/src/cockroach-query-executor.js
// (same author, Apache-2.0). Adaptations for the HelixCTW GCP edition:
//   - probes helixctw_gcp.environment_markers via the canonical statement in
//     cockroachdb-provider.js;
//   - the didz-testwired CockroachDB Cloud Basic cluster serves publicly
//     trusted TLS certificates, so a custom CA bundle is OPTIONAL here. When
//     no caCertificatePem is supplied, Node's built-in CA store verifies the
//     server (rejectUnauthorized stays true either way).

import { X509Certificate } from "node:crypto";

import pg from "pg";

import {
  HELIXCTW_GCP_COCKROACH_PROBE_RESULT_COLUMNS,
  HELIXCTW_GCP_COCKROACH_PROBE_STATEMENT,
} from "./cockroachdb-provider.js";

const { Pool } = pg;
const HOST_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const CERTIFICATE_BEGIN = "-----BEGIN CERTIFICATE-----";
const CERTIFICATE_END = "-----END CERTIFICATE-----";
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u;
const SAFE_RESULT_STRING_PATTERN = /^[^\u0000-\u001F\u007F]{1,256}$/u;
const MAXIMUM_RESULT_ROWS = 2;
const CLOSE_TIMEOUT_MILLISECONDS = 250;
const MINIMUM_OUTER_TIMEOUT_MARGIN_MILLISECONDS = 250;

function requireObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(label + " must be a plain object.");
  }
  return value;
}

function requireString(value, label, pattern, maximumLength) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    !pattern.test(value)
  ) {
    throw new TypeError(label + " is invalid.");
  }
  return value;
}

function requireInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(label + " is outside its reviewed bounds.");
  }
  return value;
}

function invalidCertificate() {
  return new TypeError("The CockroachDB CA certificate is invalid.");
}

function validateCertificateBlock(certificateBlock) {
  const lines = certificateBlock.split("\n");
  if (
    lines.length < 3 ||
    lines[0] !== CERTIFICATE_BEGIN ||
    lines.at(-1) !== CERTIFICATE_END
  ) {
    throw invalidCertificate();
  }

  const bodyLines = lines.slice(1, -1);
  for (const [index, line] of bodyLines.entries()) {
    const isFinalBodyLine = index === bodyLines.length - 1;
    if (
      line.length < 1 ||
      line.length > 76 ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(line) ||
      (!isFinalBodyLine && line.includes("="))
    ) {
      throw invalidCertificate();
    }
  }

  const encodedCertificate = bodyLines.join("");
  if (encodedCertificate.length % 4 !== 0) {
    throw invalidCertificate();
  }

  try {
    const decodedCertificate = Buffer.from(encodedCertificate, "base64");
    if (
      decodedCertificate.length === 0 ||
      decodedCertificate.toString("base64") !== encodedCertificate
    ) {
      throw new Error("non-canonical base64");
    }
    const certificate = new X509Certificate(certificateBlock);
    if (certificate.ca !== true) {
      throw new Error("not a certificate authority");
    }
  } catch {
    throw invalidCertificate();
  }
}

export function normalizeCertificateAuthorityBundle(value) {
  if (
    typeof value !== "string" ||
    value.length < 256 ||
    value.length > 32_768 ||
    value.includes("\u0000") ||
    PRIVATE_KEY_PATTERN.test(value)
  ) {
    throw invalidCertificate();
  }

  const normalizedValue = value.replace(/\r\n/gu, "\n");
  if (normalizedValue.includes("\r")) {
    throw invalidCertificate();
  }

  const certificateBlocks = [];
  let cursor = 0;
  while (cursor < normalizedValue.length) {
    if (!normalizedValue.startsWith(CERTIFICATE_BEGIN, cursor)) {
      throw invalidCertificate();
    }

    const certificateEndIndex = normalizedValue.indexOf(
      "\n" + CERTIFICATE_END,
      cursor + CERTIFICATE_BEGIN.length,
    );
    if (certificateEndIndex < 0) {
      throw invalidCertificate();
    }

    const blockEnd = certificateEndIndex + 1 + CERTIFICATE_END.length;
    const certificateBlock = normalizedValue.slice(cursor, blockEnd);
    validateCertificateBlock(certificateBlock);
    certificateBlocks.push(certificateBlock);
    cursor = blockEnd;

    if (cursor === normalizedValue.length) break;
    if (normalizedValue[cursor] !== "\n") {
      throw invalidCertificate();
    }
    cursor += 1;
    if (cursor === normalizedValue.length) break;
  }

  if (certificateBlocks.length === 0) {
    throw invalidCertificate();
  }

  const canonicalBundle = certificateBlocks.join("\n") + "\n";
  if (
    normalizedValue !== canonicalBundle &&
    normalizedValue !== canonicalBundle.slice(0, -1)
  ) {
    throw invalidCertificate();
  }
  return canonicalBundle;
}

function requireCanonicalProbeStatement(statement) {
  if (statement !== HELIXCTW_GCP_COCKROACH_PROBE_STATEMENT) {
    throw new TypeError("Only the canonical bounded CockroachDB probe is allowed.");
  }
  return statement;
}

function requireProbeParameters(parameters) {
  if (
    !Array.isArray(parameters) ||
    parameters.length !== 4 ||
    parameters.some(
      (value) =>
        typeof value !== "string" ||
        value.length < 1 ||
        value.length > 128 ||
        /[\u0000-\u001F\u007F]/u.test(value),
    )
  ) {
    throw new TypeError("The canonical probe requires four bounded parameters.");
  }
  return [...parameters];
}

function requireExactResultColumns(row) {
  if (
    row === null ||
    typeof row !== "object" ||
    Array.isArray(row) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(row))
  ) {
    throw new TypeError("The CockroachDB probe row is invalid.");
  }
  const actualColumns = Object.keys(row).sort();
  const expectedColumns = [...HELIXCTW_GCP_COCKROACH_PROBE_RESULT_COLUMNS].sort();
  if (
    actualColumns.length !== expectedColumns.length ||
    actualColumns.some((column, index) => column !== expectedColumns[index])
  ) {
    throw new TypeError("The CockroachDB probe row is invalid.");
  }
}

function requireSafeResultString(value) {
  if (typeof value !== "string" || !SAFE_RESULT_STRING_PATTERN.test(value)) {
    throw new TypeError("The CockroachDB probe row is invalid.");
  }
  return value;
}

function normalizeBoundedProbeRow(row) {
  requireExactResultColumns(row);
  if (
    typeof row.database_matches !== "boolean" ||
    typeof row.runtime_user_matches !== "boolean" ||
    typeof row.marker_commitment_matches !== "boolean"
  ) {
    throw new TypeError("The CockroachDB probe row is invalid.");
  }
  requireSafeResultString(row.marker_id);
  requireSafeResultString(row.build_stage);
  requireSafeResultString(row.evidence_receipt_id);
  if (
    !Number.isSafeInteger(row.marker_version) &&
    !/^[0-9]{1,20}$/u.test(String(row.marker_version))
  ) {
    throw new TypeError("The CockroachDB probe row is invalid.");
  }

  const observedAt =
    row.observed_at instanceof Date
      ? row.observed_at.toISOString()
      : requireSafeResultString(row.observed_at);
  return Object.freeze({ ...row, observed_at: observedAt });
}

function normalizeBoundedProbeRows(rows) {
  if (!Array.isArray(rows) || rows.length > MAXIMUM_RESULT_ROWS) {
    throw new TypeError("The CockroachDB probe row count is invalid.");
  }
  return rows.map(normalizeBoundedProbeRow);
}

export function createCockroachQueryExecutor(options) {
  const configuration = requireObject(options, "options");
  const statementTimeoutMilliseconds = requireInteger(
    configuration.statementTimeoutMilliseconds,
    "statementTimeoutMilliseconds",
    50,
    4_999,
  );
  const queryTimeoutMilliseconds = requireInteger(
    configuration.queryTimeoutMilliseconds,
    "queryTimeoutMilliseconds",
    statementTimeoutMilliseconds + 1,
    5_000,
  );
  const connectionTimeoutMilliseconds = requireInteger(
    configuration.connectionTimeoutMilliseconds,
    "connectionTimeoutMilliseconds",
    50,
    2_000,
  );
  const probeTimeoutMilliseconds = requireInteger(
    configuration.probeTimeoutMilliseconds,
    "probeTimeoutMilliseconds",
    500,
    5_000,
  );
  if (
    connectionTimeoutMilliseconds + queryTimeoutMilliseconds >
    probeTimeoutMilliseconds - MINIMUM_OUTER_TIMEOUT_MARGIN_MILLISECONDS
  ) {
    throw new TypeError(
      "Connection and query timeouts require a reviewed outer timeout margin.",
    );
  }
  if (
    typeof configuration.password !== "string" ||
    configuration.password.length < 16 ||
    configuration.password.length > 1_024 ||
    /[\u0000\r\n]/u.test(configuration.password)
  ) {
    throw new TypeError("password is invalid.");
  }

  // GCP-edition adaptation: the CA bundle is optional. CockroachDB Cloud
  // Basic clusters present publicly trusted certificates, which Node verifies
  // against its built-in CA store. Certificate verification is never disabled.
  const ssl =
    configuration.caCertificatePem === undefined
      ? { rejectUnauthorized: true }
      : {
          ca: normalizeCertificateAuthorityBundle(configuration.caCertificatePem),
          rejectUnauthorized: true,
        };

  const PoolClass = configuration.PoolClass ?? Pool;
  const pool = new PoolClass({
    host: requireString(configuration.host, "host", HOST_PATTERN, 253),
    port: requireInteger(configuration.port, "port", 1, 65_535),
    database: requireString(configuration.database, "database", NAME_PATTERN, 63),
    user: requireString(configuration.user, "user", NAME_PATTERN, 63),
    password: configuration.password,
    ssl,
    max: 1,
    min: 0,
    allowExitOnIdle: true,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: connectionTimeoutMilliseconds,
    maxLifetimeSeconds: 300,
    keepAlive: true,
    statement_timeout: statementTimeoutMilliseconds,
    query_timeout: queryTimeoutMilliseconds,
    idle_in_transaction_session_timeout: statementTimeoutMilliseconds,
    application_name: "helixctw-gcp-testwired-readonly",
  });
  pool.on("error", () => undefined);

  let closePromise;

  async function closePool() {
    if (closePromise !== undefined) return closePromise;
    const endPromise = Promise.resolve()
      .then(() => pool.end())
      .catch(() => undefined);
    closePromise = (async () => {
      let timeoutHandle;
      try {
        await Promise.race([
          endPromise,
          new Promise((resolve) => {
            timeoutHandle = setTimeout(resolve, CLOSE_TIMEOUT_MILLISECONDS);
          }),
        ]);
      } finally {
        clearTimeout(timeoutHandle);
      }
    })();
    return closePromise;
  }

  return Object.freeze({
    async query(statement, parameters, queryOptions) {
      const reviewedStatement = requireCanonicalProbeStatement(statement);
      const reviewedParameters = requireProbeParameters(parameters);
      if (
        queryOptions?.statementTimeoutMilliseconds !==
        statementTimeoutMilliseconds
      ) {
        throw new TypeError("The reviewed statement timeout is required.");
      }
      try {
        const result = await pool.query({
          text: reviewedStatement,
          values: reviewedParameters,
          query_timeout: queryTimeoutMilliseconds,
        });
        return { rows: normalizeBoundedProbeRows(result?.rows) };
      } catch {
        throw new Error("CockroachDB query execution failed closed.");
      }
    },
    close: closePool,
  });
}
