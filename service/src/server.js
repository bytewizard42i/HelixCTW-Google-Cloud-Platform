// SPDX-License-Identifier: Apache-2.0
// HelixCTW GCP edition — Cloud Run service entry point.
//
// Routes (same contract as the Cloudflare Worker, plus the TestWired status
// probe pattern from the AWS edition):
//   GET  /health                     liveness only, no downstream probes
//   GET  /                           service identity (Worker GET parity)
//   GET  /api/v1/status              TestWired status + provider probes
//   POST /                           compliance check (Worker POST parity)
//   POST /api/v1/compliance/check    same handler, canonical path
//   ANY  /judge/*                    ported judge API (mhelixctw/api/v1) —
//                                    the TestWired memory-journey contract.
//                                    The web app's VITE_API_BASE_URL points
//                                    at <service>/judge.
//
// Honesty rules (see MidnightHelixCTW AGENTS.md): a probe result is evidence
// for exactly what it probed, nothing more. Failures are replaced with one
// bounded safe error and the provider reports NOT_CONNECTED.

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import {
  validateComplianceInput,
  runComplianceCheck,
} from "./compliance.js";
import { createHandler as createJudgeHandler } from "./judge-handler.js";
import { createReceiptStore } from "./gcs-receipts.js";
import { createCockroachDbProvider } from "./cockroachdb-provider.js";
import { createGcpVectorMemoryProvider } from "./gcp-vector-bootstrap.js";
import { createCockroachQueryExecutor } from "./cockroach-query-executor.js";
import { HELIXCTW_GCP_ENVIRONMENT_MARKER_COMMITMENT_HEX } from "./environment-marker.js";

const SERVICE_NAME = "helixctw-gcp-compliance";
const BUILD_STAGE = "TESTWIRED";
const MAX_REQUEST_BYTES = 32_768;

// ---------------------------------------------------------------------------
// Configuration — every value arrives via environment variables set by
// Terraform on the Cloud Run service. The database URL is a Secret Manager
// reference; it never appears in code, image, or logs.
// ---------------------------------------------------------------------------
const configuration = Object.freeze({
  port: Number.parseInt(process.env.PORT ?? "8080", 10),
  environment: process.env.HELIXCTW_ENVIRONMENT ?? "testwired-dev",
  midnightNetwork: process.env.MIDNIGHT_NETWORK_ID ?? "testnet-02",
  receiptsBucket: process.env.HELIXCTW_RECEIPTS_BUCKET ?? "",
  allowedOrigins: (process.env.HELIXCTW_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  databaseUrl: process.env.HELIXCTW_GCP_DB_URL ?? "",
  vectorDatabaseUrl: process.env.HELIXCTW_GCP_VECTOR_DB_URL ?? "",
  releaseCommit: process.env.HELIXCTW_RELEASE_COMMIT ?? "",
});

const receiptStore = createReceiptStore({
  bucketName: configuration.receiptsBucket,
});

// ---------------------------------------------------------------------------
// CockroachDB probe wiring — fail closed. If the URL is absent or malformed,
// the provider stays undefined and status reports NOT_CONNECTED rather than
// crashing the service or inventing evidence.
// ---------------------------------------------------------------------------
function buildCockroachProvider(databaseUrl) {
  if (!databaseUrl) return undefined;

  try {
    const parsed = new URL(databaseUrl);
    const executor = createCockroachQueryExecutor({
      host: parsed.hostname,
      port: Number.parseInt(parsed.port || "26257", 10),
      database: parsed.pathname.replace(/^\//, ""),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      statementTimeoutMilliseconds: 1_000,
      queryTimeoutMilliseconds: 1_500,
      connectionTimeoutMilliseconds: 1_500,
      probeTimeoutMilliseconds: 3_500,
    });

    return createCockroachDbProvider({
      queryExecutor: executor,
      expectedDatabaseName: parsed.pathname.replace(/^\//, ""),
      expectedRuntimeUser: decodeURIComponent(parsed.username),
      expectedMarkerCommitmentHex: HELIXCTW_GCP_ENVIRONMENT_MARKER_COMMITMENT_HEX,
      statementTimeoutMilliseconds: 1_000,
      probeTimeoutMilliseconds: 4_000,
    });
  } catch {
    return undefined;
  }
}

const cockroachProvider = buildCockroachProvider(configuration.databaseUrl);

function buildVectorMemoryProvider(databaseUrl, releaseCommit) {
  if (!databaseUrl || !releaseCommit) return undefined;
  try {
    return createGcpVectorMemoryProvider({ databaseUrl, releaseCommit });
  } catch {
    return undefined;
  }
}

const vectorMemoryProvider = buildVectorMemoryProvider(
  configuration.vectorDatabaseUrl,
  configuration.releaseCommit,
);

// The ported judge API (see judge-handler.js). The read-only environment probe
// and the dedicated vector-memory provider are independent: either can fail
// closed without exposing a credential or crashing the service.
const judgeHandler = createJudgeHandler({ cockroachProvider, vectorMemoryProvider });

// ---------------------------------------------------------------------------
// Judge adapter — converts a Node request into the Lambda payload-format 2.0
// event shape the ported handler expects, so the handler itself stays aligned
// with upstream. Preflight is answered here because API Gateway did that job
// in the AWS deployment.
// ---------------------------------------------------------------------------
const JUDGE_MAX_BODY_BYTES = 65_536;

function judgePreflightHeaders(request) {
  const origin = request.headers.origin;
  if (origin && configuration.allowedOrigins.includes(origin)) {
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, idempotency-key",
      "access-control-max-age": "600",
      vary: "Origin",
    };
  }
  return {};
}

async function handleJudgeRequest(request, response, url) {
  const judgePath = url.pathname.slice("/judge".length) || "/";

  if (request.method === "OPTIONS") {
    response.writeHead(204, judgePreflightHeaders(request));
    return response.end();
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > JUDGE_MAX_BODY_BYTES) {
      response.writeHead(413, { "content-type": "application/json; charset=utf-8" });
      return response.end(JSON.stringify({ ok: false, error: "Request body is too large." }));
    }
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");

  const event = {
    rawPath: judgePath,
    rawQueryString: url.search.startsWith("?") ? url.search.slice(1) : url.search,
    headers: request.headers,
    body: rawBody === "" ? undefined : rawBody,
    isBase64Encoded: false,
    requestContext: {
      requestId: randomUUID(),
      http: { method: request.method ?? "", path: judgePath },
    },
  };

  const result = await judgeHandler(event);
  response.writeHead(result.statusCode, result.headers);
  return response.end(result.body);
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------
function corsHeaders(request) {
  const origin = request.headers.origin;
  if (origin && configuration.allowedOrigins.includes(origin)) {
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
      vary: "Origin",
    };
  }
  return {};
}

function sendJson(request, response, body, status = 200) {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders(request),
  });
  response.end(payload);
}

function sendError(request, response, message, status = 400) {
  sendJson(request, response, { ok: false, error: message }, status);
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { error: { message: "Content-Type must be application/json.", status: 415 } };
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) {
      return { error: { message: "Request body is too large.", status: 413 } };
    }
    chunks.push(chunk);
  }

  try {
    return { input: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { error: { message: "Request body must be valid JSON.", status: 400 } };
  }
}

function serviceIdentity() {
  return {
    ok: true,
    service: SERVICE_NAME,
    edition: "gcp",
    environment: configuration.environment,
    midnightNetwork: configuration.midnightNetwork,
  };
}

async function statusResponse() {
  // GCS: configuration evidence only — an enabled store proves a bucket is
  // configured, not that a write succeeded. Writes are proven per-receipt.
  const providers = {
    gcs: {
      providerId: "gcs",
      state: receiptStore.enabled ? "CONFIGURED" : "NOT_CONNECTED",
    },
    cockroachdb: { providerId: "cockroachdb", state: "NOT_CONNECTED" },
  };

  if (cockroachProvider !== undefined) {
    try {
      const proof = await cockroachProvider.probe();
      providers.cockroachdb = {
        providerId: "cockroachdb",
        state: "CONNECTED",
        schemaVersion: proof.schemaVersion,
        receiptId: proof.receiptId,
        observedAt: proof.observedAt,
      };
    } catch {
      // fail closed: stays NOT_CONNECTED, no details leak
    }
  }

  return {
    ok: true,
    service: SERVICE_NAME,
    edition: "gcp",
    buildStage: BUILD_STAGE,
    environment: configuration.environment,
    midnightNetwork: configuration.midnightNetwork,
    transport: {
      providerId: "gcp",
      scope: "GCP_CLOUD_RUN_ONLY",
    },
    providers,
  };
}

async function complianceResponse(request, response) {
  const parsed = await readJsonBody(request);
  if (parsed.error) {
    return sendError(request, response, parsed.error.message, parsed.error.status);
  }

  const validationError = validateComplianceInput(parsed.input);
  if (validationError) {
    return sendError(request, response, validationError);
  }

  const receipt = runComplianceCheck(parsed.input, {
    environment: configuration.environment,
    midnightNetwork: configuration.midnightNetwork,
  });

  let auditStored = false;
  try {
    auditStored = await receiptStore.put(receipt);
  } catch {
    // Fail closed but keep the answer honest: the check ran, persistence did
    // not. auditStored=false says exactly that.
    auditStored = false;
  }

  return sendJson(request, response, {
    ok: true,
    compliance: receipt,
    auditStored,
    persistenceNote: auditStored
      ? "GCS audit receipt stored."
      : "Audit receipt was NOT persisted (bucket unconfigured or write failed).",
  });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;

    if (path === "/judge" || path.startsWith("/judge/")) {
      return await handleJudgeRequest(request, response, url);
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders(request));
      return response.end();
    }

    if (request.method === "GET" && path === "/health") {
      return sendJson(request, response, { ok: true, service: SERVICE_NAME });
    }

    if (request.method === "GET" && path === "/") {
      return sendJson(request, response, serviceIdentity());
    }

    if (request.method === "GET" && path === "/api/v1/status") {
      return sendJson(request, response, await statusResponse());
    }

    if (
      request.method === "POST" &&
      (path === "/" || path === "/api/v1/compliance/check")
    ) {
      return complianceResponse(request, response);
    }

    if (path === "/" || path === "/api/v1/compliance/check") {
      return sendError(request, response, "Use POST for compliance checks.", 405);
    }

    return sendError(request, response, "Not found.", 404);
  } catch {
    return sendError(request, response, "The request could not be completed.", 500);
  }
});

server.listen(configuration.port, () => {
  // Cloud Run captures stdout as structured-ish logs. No secrets here.
  console.log(
    JSON.stringify({
      message: "listening",
      service: SERVICE_NAME,
      port: configuration.port,
      environment: configuration.environment,
      receiptsBucketConfigured: receiptStore.enabled,
      cockroachProbeConfigured: cockroachProvider !== undefined,
    }),
  );
});
