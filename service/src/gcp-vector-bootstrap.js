// SPDX-License-Identifier: Apache-2.0
// GCP-native vector-memory bootstrap for the Stage B judge journey.
//
// The AWS edition lazily downloads a JSON credential from AWS Secrets Manager.
// Cloud Run already mounts the reviewed GCP Secret Manager version into
// HELIXCTW_GCP_VECTOR_DB_URL, so this adapter validates that URL and constructs
// the same bounded pg Pool consumed by the ported vector-memory provider.
//
// Security boundary:
// - only the dedicated database `mhelix_gcp_testwired` is accepted;
// - only the least-privilege runtime user `mhelix_gcp_runtime` is accepted;
// - only CockroachDB Cloud hosts and TLS port 26257 are accepted;
// - no parsed credential or driver error is logged or returned publicly;
// - at most two connections, with bounded connect/statement/query timeouts.

import pg from "pg";

import { CANONICAL_SCENARIO } from "./judge-constants.js";
import { createVectorMemoryProvider } from "./vector-memory-provider.js";

export const GCP_VECTOR_DATABASE_NAME = "mhelix_gcp_testwired";
export const GCP_VECTOR_RUNTIME_USER = "mhelix_gcp_runtime";

const HOST_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.cockroachlabs\.cloud$/;
const RELEASE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function parseGcpVectorDatabaseUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length < 32 || rawUrl.length > 4_096) {
    throw new TypeError("The vector database URL is invalid.");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new TypeError("The vector database URL is invalid.");
  }

  const database = parsed.pathname.replace(/^\//, "");
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !HOST_PATTERN.test(parsed.hostname) ||
    Number.parseInt(parsed.port || "26257", 10) !== 26_257 ||
    database !== GCP_VECTOR_DATABASE_NAME ||
    username !== GCP_VECTOR_RUNTIME_USER ||
    password.length < 16 ||
    password.length > 1_024 ||
    /[\u0000\r\n]/u.test(password) ||
    parsed.hash !== ""
  ) {
    throw new TypeError("The vector database URL identity is invalid.");
  }

  return Object.freeze({
    host: parsed.hostname,
    port: 26_257,
    database,
    user: username,
    password,
  });
}

export function createGcpVectorMemoryProvider(options = {}) {
  const databaseUrl = options.databaseUrl;
  const releaseCommit = options.releaseCommit;
  if (
    typeof releaseCommit !== "string" ||
    !RELEASE_COMMIT_PATTERN.test(releaseCommit)
  ) {
    throw new TypeError("A 40-character release commit is required.");
  }

  const connection = parseGcpVectorDatabaseUrl(databaseUrl);
  const poolFactory = options.poolFactory ?? ((configuration) => new pg.Pool(configuration));
  const providerFactory = options.providerFactory ?? createVectorMemoryProvider;
  const pool = poolFactory({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    ssl: { rejectUnauthorized: true },
    max: 2,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 4_000,
    query_timeout: 4_500,
    allowExitOnIdle: true,
  });

  return providerFactory({
    pool,
    scenarioId: CANONICAL_SCENARIO.scenarioId,
    releaseCommit,
    agentIdentifier: CANONICAL_SCENARIO.agentDidz,
    resourceIdentifier: CANONICAL_SCENARIO.resourceId,
    authorityGrantIdentifier: CANONICAL_SCENARIO.grantId,
    permittedPredicate: CANONICAL_SCENARIO.predicate,
  });
}
