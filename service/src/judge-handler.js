// SPDX-License-Identifier: Apache-2.0
// Ported with attribution from MidnightHelixCTW/apps/api/src/handler.js
// (same author, Apache-2.0). The dispatch, validation, and fail-closed
// evidence logic are kept verbatim; only the runtime validation (Cloud Run
// instead of Lambda), configuration names, and provider identifiers changed.
// Deviations from upstream are marked with "GCP deviation" comments.

import { randomUUID } from "node:crypto";

import {
  ACTIONS,
  ALLOWED_AGENT_IDENTIFIERS,
  RESPONSE_SCHEMA_VERSION,
  CANONICAL_SCENARIO,
  PROVIDER_STATES,
} from "./judge-constants.js";
import { HELIXCTW_GCP_COCKROACH_PROBE_SCHEMA_VERSION } from "./cockroachdb-provider.js";
import {
  generateSyntheticEmbedding,
  toVectorLiteral,
} from "./synthetic-embedding.js";
import memoryCorpus from "./memory-corpus.json" with { type: "json" };

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
// Cloud Run service names: lowercase letters, digits, and hyphens.
const CLOUD_RUN_SERVICE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const RESOURCE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RELEASE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const REQUEST_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
// GCP deviation: Google regions look like us-east1 (no dash before the digit).
const REGION_PATTERN = /^[a-z]+-[a-z]+\d$/;
const TEXT_WITHOUT_CONTROL_CHARACTERS = /^[^\u0000-\u001F\u007F]*$/u;
const EVIDENCE_RECEIPT_IDENTIFIER_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class PublicApiError extends Error {
  constructor(statusCode, code, message, retryable = false) {
    super(message);
    this.name = "PublicApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

function readBoundedInteger(rawValue, fallback, minimum, maximum) {
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isSafeInteger(parsedValue)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, parsedValue));
}

function readSafeEnvironmentValue(rawValue, pattern, fallback) {
  if (typeof rawValue !== "string" || !pattern.test(rawValue)) {
    return fallback;
  }

  return rawValue;
}

/**
 * Browser input can never promote provider evidence. Cloud Run reserves the
 * K_SERVICE, K_REVISION, K_CONFIGURATION, and PORT variables in the managed
 * runtime contract. Requiring the full, internally consistent set keeps
 * local tests and emulators at SOURCE_ONLY (GCP deviation: the equivalent
 * upstream check validated the AWS Lambda runtime contract).
 */
function isValidatedCloudRunRuntime(configurationValues) {
  const serviceName = process.env.K_SERVICE;
  const revisionName = process.env.K_REVISION;
  const configurationName = process.env.K_CONFIGURATION;
  const portNumber = Number(process.env.PORT);

  return (
    typeof serviceName === "string" &&
    CLOUD_RUN_SERVICE_NAME_PATTERN.test(serviceName) &&
    typeof revisionName === "string" &&
    revisionName.startsWith(`${serviceName}-`) &&
    configurationName === serviceName &&
    Number.isInteger(portNumber) &&
    portNumber >= 1 &&
    portNumber <= 65_535 &&
    configurationValues.region === "us-east1" &&
    configurationValues.releaseCommit !== "UNSET" &&
    configurationValues.publicAllowedOrigins.length > 0
  );
}

function isAllowedOriginShape(parsedOrigin) {
  if (parsedOrigin.protocol === "https:") {
    return true;
  }
  // GCP deviation: development origins are allowed over HTTP for localhost
  // only, matching the browser client's own base-URL validator and the
  // compliance service that shares this deployment.
  return (
    parsedOrigin.protocol === "http:" &&
    (parsedOrigin.hostname === "localhost" || parsedOrigin.hostname === "127.0.0.1")
  );
}

function readConfiguration() {
  const configuredAllowedOrigins =
    process.env.HELIXCTW_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()) ??
    [];

  // A browser origin must contain only scheme, host, and optional port. Paths,
  // credentials, query strings, fragments, wildcard origins, invalid members,
  // duplicates, and unexpectedly broad lists are refused as one fail-closed
  // configuration unit. (GCP deviation: the bounded limit is eight: current
  // production/development origins plus two slots for future custom domains.)
  let publicAllowedOrigins = [];
  if (configuredAllowedOrigins.length > 0 && configuredAllowedOrigins.length <= 8) {
    const validatedOrigins = [];
    let originConfigurationIsValid = true;
    for (const configuredOrigin of configuredAllowedOrigins) {
      try {
        const parsedOrigin = new URL(configuredOrigin);
        if (
          !isAllowedOriginShape(parsedOrigin) ||
          parsedOrigin.origin !== configuredOrigin ||
          parsedOrigin.username !== "" ||
          parsedOrigin.password !== "" ||
          validatedOrigins.includes(configuredOrigin)
        ) {
          originConfigurationIsValid = false;
          break;
        }
        validatedOrigins.push(configuredOrigin);
      } catch {
        originConfigurationIsValid = false;
        break;
      }
    }
    if (originConfigurationIsValid) {
      publicAllowedOrigins = validatedOrigins;
    }
  }

  const releaseCommit = readSafeEnvironmentValue(
    process.env.HELIXCTW_RELEASE_COMMIT,
    RELEASE_COMMIT_PATTERN,
    "UNSET",
  );
  const region = readSafeEnvironmentValue(
    process.env.HELIXCTW_GCP_REGION,
    REGION_PATTERN,
    "UNSET",
  );
  const validatedCloudRunRuntime = isValidatedCloudRunRuntime({
    publicAllowedOrigins,
    releaseCommit,
    region,
  });

  return {
    publicAllowedOrigins,
    maxRequestBytes: readBoundedInteger(
      process.env.HELIXCTW_MAX_REQUEST_BYTES,
      4_096,
      1_024,
      16_384,
    ),
    maxResponseBytes: readBoundedInteger(
      process.env.HELIXCTW_MAX_RESPONSE_BYTES,
      32_768,
      512,
      65_536,
    ),
    releaseCommit,
    region,
    buildStage: "TESTWIRED",
    // This field describes the integrated deployment as a whole. It remains
    // SOURCE_ONLY because the downstream providers are still disconnected.
    deploymentEvidence: "SOURCE_ONLY",
    transport: {
      providerId: "gcp",
      scope: "GCP_CLOUD_RUN_ONLY",
      evidence: validatedCloudRunRuntime ? "REALDEAL_TEST" : "SOURCE_ONLY",
      connection: validatedCloudRunRuntime ? "CONNECTED" : "NOT_CONNECTED",
      downstreamProvidersConnected: false,
    },
  };
}

function getHeader(event, requestedHeaderName) {
  const normalizedRequestedName = requestedHeaderName.toLowerCase();
  const headerEntries = Object.entries(event?.headers ?? {});
  const matchingEntry = headerEntries.find(
    ([headerName]) => headerName.toLowerCase() === normalizedRequestedName,
  );

  return typeof matchingEntry?.[1] === "string" ? matchingEntry[1].trim() : "";
}

function getRequestId(event) {
  const candidateRequestId = event?.requestContext?.requestId;
  if (
    typeof candidateRequestId === "string" &&
    REQUEST_IDENTIFIER_PATTERN.test(candidateRequestId)
  ) {
    return candidateRequestId;
  }

  return randomUUID();
}

function getRequestMethod(event) {
  const candidateMethod = event?.requestContext?.http?.method;
  return typeof candidateMethod === "string" ? candidateMethod.toUpperCase() : "";
}

function getRequestPath(event) {
  const candidatePath = event?.rawPath ?? event?.requestContext?.http?.path;
  return typeof candidatePath === "string" ? candidatePath : "";
}

function buildTransportStatus(configuration, requestId) {
  if (configuration.transport.evidence !== "REALDEAL_TEST") {
    return { ...configuration.transport };
  }

  return {
    ...configuration.transport,
    evidenceReference: {
      label: "REALDEAL_TEST",
      provider: "gcp",
      requestId,
    },
  };
}

function cloneProviderStates(configuration, requestId) {
  return PROVIDER_STATES.map((providerState) => {
    if (providerState.id !== "gcp") {
      return { ...providerState };
    }

    const gcpProviderState = {
      ...providerState,
      evidence: configuration.transport.evidence,
      connection: configuration.transport.connection,
    };
    if (configuration.transport.evidence !== "REALDEAL_TEST") {
      return gcpProviderState;
    }

    return {
      ...gcpProviderState,
      evidenceReference: {
        label: "REALDEAL_TEST",
        provider: "gcp",
        requestId,
      },
    };
  });
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") {
    return false;
  }

  const parsedTimestamp = new Date(value);
  return (
    Number.isFinite(parsedTimestamp.getTime()) &&
    parsedTimestamp.toISOString() === value
  );
}

/**
 * Read-only connection evidence is allowlisted field by field. A provider can
 * never spread a database row, driver error, URL (Uniform Resource Locator),
 * database name, or user name
 * into a public response.
 */
async function buildReadOnlyProviderStates(
  configuration,
  requestId,
  cockroachProvider,
) {
  const providerStates = cloneProviderStates(configuration, requestId);
  if (cockroachProvider === undefined) {
    return providerStates;
  }

  const cockroachProviderIndex = providerStates.findIndex(
    (providerState) => providerState.id === "cockroachdb",
  );
  const baselineCockroachState = providerStates[cockroachProviderIndex];

  try {
    if (typeof cockroachProvider?.probe !== "function") {
      throw new Error("Invalid CockroachDB provider.");
    }

    const probeResult = await cockroachProvider.probe();
    if (
      probeResult?.schemaVersion !== HELIXCTW_GCP_COCKROACH_PROBE_SCHEMA_VERSION ||
      probeResult.connected !== true ||
      typeof probeResult.receiptId !== "string" ||
      !EVIDENCE_RECEIPT_IDENTIFIER_PATTERN.test(probeResult.receiptId) ||
      !isCanonicalUtcTimestamp(probeResult.observedAt)
    ) {
      throw new Error("Invalid CockroachDB connection proof.");
    }

    providerStates[cockroachProviderIndex] = {
      ...baselineCockroachState,
      evidence: "REALDEAL_TEST",
      connection: "CONNECTED",
      evidenceReference: {
        label: "REALDEAL_TEST",
        provider: "cockroachdb",
        receiptId: probeResult.receiptId.toLowerCase(),
        observedAt: probeResult.observedAt,
      },
      detail:
        "The bounded read-only query verified the CockroachDB connection, runtime identity, and reviewed TestWired environment marker. It does not prove or enable memory persistence or vector retrieval.",
    };
  } catch {
    providerStates[cockroachProviderIndex] = {
      ...baselineCockroachState,
      evidence: "SOURCE_ONLY",
      connection: "ERROR",
      detail:
        "The CockroachDB connection and environment probe failed closed; memory persistence, vector retrieval, and dependent operations remain disabled.",
    };
  }

  return providerStates;
}

function buildBasePayload(ok, requestId) {
  return {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    ok,
    requestId,
  };
}

function buildResponseHeaders(requestId, allowedOrigin, additionalHeaders = {}) {
  const responseHeaders = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
    ...additionalHeaders,
  };

  if (allowedOrigin !== "") {
    responseHeaders["access-control-allow-origin"] = allowedOrigin;
    // The browser evidence validator requires the raw transport request ID,
    // not merely the JSON copy. CORS hides non-safelisted response headers
    // unless the API explicitly exposes them.
    responseHeaders["access-control-expose-headers"] = "x-request-id";
    responseHeaders.vary = "Origin";
  }

  return responseHeaders;
}

function createJsonResponse(
  configuration,
  statusCode,
  payload,
  requestId,
  responseOrigin,
  additionalHeaders = {},
) {
  let responseStatusCode = statusCode;
  let responseBody = JSON.stringify(payload);

  if (Buffer.byteLength(responseBody, "utf8") > configuration.maxResponseBytes) {
    responseStatusCode = 500;
    responseBody = JSON.stringify({
      ...buildBasePayload(false, requestId),
      error: {
        code: "RESPONSE_LIMIT_EXCEEDED",
        message: "The bounded response could not be returned.",
        retryable: false,
      },
    });
  }

  return {
    statusCode: responseStatusCode,
    headers: buildResponseHeaders(requestId, responseOrigin, additionalHeaders),
    body: responseBody,
    isBase64Encoded: false,
  };
}

function validateOrigin(event, configuration) {
  const requestOrigin = getHeader(event, "origin");
  if (requestOrigin === "") {
    return "";
  }

  if (
    configuration.publicAllowedOrigins.length === 0 ||
    !configuration.publicAllowedOrigins.includes(requestOrigin)
  ) {
    throw new PublicApiError(
      403,
      "ORIGIN_NOT_ALLOWED",
      "This browser origin is not allowed to call the TestWired API.",
    );
  }

  return requestOrigin;
}

function assertNoQueryParameters(event) {
  if (typeof event?.rawQueryString === "string" && event.rawQueryString !== "") {
    throw new PublicApiError(
      400,
      "QUERY_PARAMETERS_NOT_ALLOWED",
      "This fixed-operation route does not accept query parameters.",
    );
  }
}

function decodeBoundedRequestBody(event, maximumRequestBytes) {
  if (typeof event?.body !== "string" || event.body === "") {
    throw new PublicApiError(
      400,
      "JSON_BODY_REQUIRED",
      "A non-empty JSON object is required.",
    );
  }

  const contentLengthHeader = getHeader(event, "content-length");
  if (/^\d+$/.test(contentLengthHeader) && Number(contentLengthHeader) > maximumRequestBytes) {
    throw new PublicApiError(
      413,
      "REQUEST_LIMIT_EXCEEDED",
      `The request body exceeds the ${maximumRequestBytes}-byte limit.`,
    );
  }

  let requestBytes;
  if (event.isBase64Encoded === true) {
    const maximumEncodedLength = Math.ceil(maximumRequestBytes / 3) * 4 + 4;
    if (
      event.body.length > maximumEncodedLength ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        event.body,
      )
    ) {
      throw new PublicApiError(
        400,
        "INVALID_BODY_ENCODING",
        "The request body encoding is invalid.",
      );
    }
    requestBytes = Buffer.from(event.body, "base64");
  } else {
    requestBytes = Buffer.from(event.body, "utf8");
  }

  if (requestBytes.byteLength > maximumRequestBytes) {
    throw new PublicApiError(
      413,
      "REQUEST_LIMIT_EXCEEDED",
      `The request body exceeds the ${maximumRequestBytes}-byte limit.`,
    );
  }

  try {
    const parsedBody = JSON.parse(requestBytes.toString("utf8"));
    if (parsedBody === null || Array.isArray(parsedBody) || typeof parsedBody !== "object") {
      throw new PublicApiError(
        400,
        "JSON_OBJECT_REQUIRED",
        "The JSON body must be an object.",
      );
    }
    return parsedBody;
  } catch (error) {
    if (error instanceof PublicApiError) {
      throw error;
    }
    throw new PublicApiError(400, "INVALID_JSON", "The request body is not valid JSON.");
  }
}

function readPostBody(event, configuration) {
  const contentType = getHeader(event, "content-type");
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new PublicApiError(
      415,
      "JSON_CONTENT_TYPE_REQUIRED",
      "Content-Type must be application/json.",
    );
  }

  const idempotencyKey = getHeader(event, "idempotency-key");
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new PublicApiError(
      428,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key must contain 16 to 128 safe characters.",
    );
  }

  // The validated idempotency key is deliberately not returned or logged. The
  // provider hashes it before any lookup or storage, so the raw value never
  // reaches the database.
  return decodeBoundedRequestBody(event, configuration.maxRequestBytes);
}

/**
 * Re-read the idempotency key for the provider. `readPostBody` has already
 * validated its shape and rejected the request otherwise.
 */
function getIdempotencyKey(event) {
  return getHeader(event, "idempotency-key");
}

/**
 * The protected field names the disclosure attempt asks for and is refused.
 * These are NAMES ONLY. No protected value exists anywhere in this repository,
 * so the denial cannot leak one even in principle.
 */
const PROTECTED_FIELD_NAMES_REFUSED = Object.freeze([
  "deed.full_text",
  "mortgage.full_record",
  "owner.birth_date",
  "owner.private_contact_information",
]);

/**
 * The committed public-safe corpus, shaped for the provider. Loaded once.
 * These are the deterministic TestTown fixtures, never live data.
 */
let cachedCorpusEntries;
function loadMemoryCorpusEntries() {
  if (cachedCorpusEntries === undefined) {
    cachedCorpusEntries = Object.freeze(
      memoryCorpus.entries.map((entry) =>
        Object.freeze({
          fixtureId: entry.fixtureId,
          publicSafeSummary: entry.publicSafeSummary,
          embeddingModelId: memoryCorpus.embeddingModelId,
          embeddingDimensions: memoryCorpus.embeddingDimensions,
          vectorLiteral: toVectorLiteral(entry.embedding),
          embeddingCommitmentHex: entry.embeddingCommitmentHex,
        }),
      ),
    );
  }
  return cachedCorpusEntries;
}

function assertStrictObjectShape(value, requiredKeys, optionalKeys = []) {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new PublicApiError(
        400,
        "UNKNOWN_REQUEST_FIELD",
        "The request contains an unsupported field.",
      );
    }
  }

  for (const requiredKey of requiredKeys) {
    if (!Object.hasOwn(value, requiredKey)) {
      throw new PublicApiError(
        400,
        "REQUIRED_REQUEST_FIELD_MISSING",
        `The request is missing the required field: ${requiredKey}.`,
      );
    }
  }
}

function assertCanonicalAgentIdentifier(agentDidz) {
  if (agentDidz === undefined) {
    return;
  }

  if (typeof agentDidz !== "string" || !ALLOWED_AGENT_IDENTIFIERS.includes(agentDidz)) {
    throw new PublicApiError(
      400,
      "INVALID_AGENT_IDENTIFIER",
      "The agent identifier is not part of the fixed synthetic scenario.",
    );
  }
}

function assertBoundedIdentifier(identifier, fieldName) {
  if (typeof identifier !== "string" || !RESOURCE_IDENTIFIER_PATTERN.test(identifier)) {
    throw new PublicApiError(
      400,
      "INVALID_RESOURCE_IDENTIFIER",
      `${fieldName} must be a bounded identifier.`,
    );
  }
}

function validateStartRunBody(requestBody) {
  assertStrictObjectShape(requestBody, ["scenarioId"], ["agentDidz"]);
  if (requestBody.scenarioId !== CANONICAL_SCENARIO.scenarioId) {
    throw new PublicApiError(
      400,
      "UNKNOWN_SCENARIO",
      "Only the fixed Morrow farmhouse TestWired scenario is available.",
    );
  }
  assertCanonicalAgentIdentifier(requestBody.agentDidz);
}

function validateCloseSessionBody(requestBody) {
  assertStrictObjectShape(requestBody, ["sessionId"]);
  assertBoundedIdentifier(requestBody.sessionId, "sessionId");
}

function validateRecallBody(requestBody) {
  assertStrictObjectShape(requestBody, ["query"], ["agentDidz"]);
  if (
    typeof requestBody.query !== "string" ||
    requestBody.query.trim().length === 0 ||
    requestBody.query.length > 500 ||
    !TEXT_WITHOUT_CONTROL_CHARACTERS.test(requestBody.query)
  ) {
    throw new PublicApiError(
      400,
      "INVALID_RECALL_QUERY",
      "query must contain 1 to 500 characters without control characters.",
    );
  }
  assertCanonicalAgentIdentifier(requestBody.agentDidz);
}

function validateActionBody(requestBody) {
  assertStrictObjectShape(requestBody, ["action"], ["agentDidz"]);
  if (typeof requestBody.action !== "string" || !ACTIONS.includes(requestBody.action)) {
    throw new PublicApiError(
      400,
      "UNSUPPORTED_ACTION",
      "The action is not part of the fixed TestWired action set.",
    );
  }
  assertCanonicalAgentIdentifier(requestBody.agentDidz);
}

/**
 * Resolve whether the narrow vector-memory slice may run, WITHOUT touching the
 * database unless it plausibly can.
 *
 * Order matters and is deliberate:
 *
 *   1. If no memory provider is deployed, the gate is closed. No work done.
 *   2. Ask the provider for the release-bound capability row. When the slice
 *      is not activated, this fails fast (secret missing, capability row
 *      absent), the gate stays closed, and CRUCIALLY no environment probe has
 *      run — a blocked mutation must not touch the database, and its response
 *      must carry the baseline provider states exactly as it always has.
 *   3. Only after the capability check succeeds is the environment-marker
 *      probe consulted, and the marker must read CONNECTED.
 *
 * This gate never promotes the application. currentAvailability stays
 * NOT_CONNECTED, readyForMutations stays false, and deferred providers stay
 * untouched. It cannot throw, because a gate that can crash is not fail-closed.
 *
 * Returns the provider states the response should carry: baseline states when
 * the gate never probed, live states when it did.
 */
async function resolveMemoryReadiness(
  vectorMemoryProvider,
  cockroachProvider,
  configuration,
  requestId,
) {
  const baselineStates = cloneProviderStates(configuration, requestId);
  if (
    !vectorMemoryProvider ||
    typeof vectorMemoryProvider.checkCapability !== "function"
  ) {
    return { ready: false, providerStates: baselineStates };
  }
  try {
    await vectorMemoryProvider.checkCapability();
  } catch {
    // Not activated. The specific reason deliberately stays private, and no
    // probe has touched the database.
    return { ready: false, providerStates: baselineStates };
  }
  const liveStates = await buildReadOnlyProviderStates(
    configuration,
    requestId,
    cockroachProvider,
  );
  const cockroachState = liveStates.find(
    (providerState) => providerState.id === "cockroachdb",
  );
  if (cockroachState?.connection !== "CONNECTED") {
    return { ready: false, providerStates: liveStates };
  }
  return { ready: true, providerStates: liveStates };
}

/**
 * Map a provider failure to an exact public status without leaking internals.
 * Unrecognized codes become a generic 503, never a database message.
 */
function memoryErrorToPublicError(error) {
  const mapping = new Map([
    ["INVALID_INPUT", [400, "INVALID_REQUEST"]],
    ["INVALID_IDEMPOTENCY_KEY", [428, "IDEMPOTENCY_KEY_REQUIRED"]],
    ["IDEMPOTENCY_CONFLICT", [409, "IDEMPOTENCY_KEY_CONFLICT"]],
    ["RECEIPT_NOT_FOUND", [404, "RECEIPT_NOT_FOUND"]],
    ["SESSION_NOT_FOUND", [409, "SESSION_NOT_READY"]],
    ["PROJECTION_NOT_ACTIVE", [409, "PROJECTION_NOT_ACTIVE"]],
    ["SCENARIO_UNAVAILABLE", [503, "LIVE_PROVIDERS_NOT_CONNECTED"]],
    ["CAPABILITY_NOT_ACTIVATED", [503, "LIVE_PROVIDERS_NOT_CONNECTED"]],
    ["CAPABILITY_INVALID", [503, "LIVE_PROVIDERS_NOT_CONNECTED"]],
  ]);
  const [statusCode, code] = mapping.get(error?.code) ?? [
    503,
    "LIVE_PROVIDERS_NOT_CONNECTED",
  ];
  const safeMessage =
    statusCode === 503
      ? "The reviewed live memory providers are not connected."
      : String(error?.message ?? "The request could not be completed.");
  return new PublicApiError(statusCode, code, safeMessage);
}

/**
 * Execute one of the four write checkpoints.
 *
 * Every response is assembled field by field from provider output, never
 * spread from a database row, so a future column cannot widen the public
 * surface. `protectedFieldsReturned` is always zero: the disclosure path reads
 * no protected value, so there is none to return.
 */
async function executeMemoryRoute({
  resolvedRoute,
  requestBody,
  event,
  configuration,
  requestId,
  providerStates,
  vectorMemoryProvider,
}) {
  const idempotencyKey = getIdempotencyKey(event);
  // Mutation responses carry only the fields the browser validator allows.
  // providers is deliberately absent: it is a health/status concern, not a
  // per-mutation field, and the validator's exact-key check would reject it.
  const basePayload = {
    ...buildBasePayload(true, requestId),
    buildStage: configuration.buildStage,
    // Mutation responses are reached only through the live memory-slice
    // routes, which require a deployed vector-memory provider and a connected
    // CockroachDB. The global deploymentEvidence stays SOURCE_ONLY (not every
    // deferred provider is promoted), but the mutation context IS live, so the
    // response carries LIVE_TESTWIRED here. The health and status endpoints
    // keep the honest global view.
    deploymentEvidence: "LIVE_TESTWIRED",
    releaseCommit: configuration.releaseCommit,
    protectedFieldsReturned: 0,
  };

  try {
    if (resolvedRoute.name === "startRun") {
      const created = await vectorMemoryProvider.createRun({
        agentIdentifier: requestBody.agentDidz ?? CANONICAL_SCENARIO.agentDidz,
        idempotencyKey,
        transportRequestId: requestId,
      });
      return {
        statusCode: created.replayed ? 200 : 201,
        payload: {
          ...basePayload,
          runId: created.runId,
          scenarioId: CANONICAL_SCENARIO.scenarioId,
          session: {
            sessionId: created.sessionId,
            ordinal: "A",
            state: created.sessionState,
            createdAt: created.sessionCreatedAt,
          },
        },
      };
    }

    if (resolvedRoute.name === "closeSession") {
      const closed = await vectorMemoryProvider.closeSessionAndBuildProjection({
        runId: resolvedRoute.parameters.runId,
        idempotencyKey,
        transportRequestId: requestId,
        corpusEntries: loadMemoryCorpusEntries(),
      });
      return {
        statusCode: 200,
        payload: {
          ...basePayload,
          runId: resolvedRoute.parameters.runId,
          session: {
            sessionId: closed.sessionId,
            ordinal: "A",
            state: closed.sessionState,
            createdAt: closed.sessionCreatedAt,
            closedAt: closed.sessionClosedAt,
          },
          canonicalMemoryIds: closed.canonicalMemoryIds,
          receiptId: closed.receiptId,
        },
      };
    }

    if (resolvedRoute.name === "recall") {
      const queryEmbedding = generateSyntheticEmbedding(requestBody.query);
      const recalled = await vectorMemoryProvider.recall({
        runId: resolvedRoute.parameters.runId,
        idempotencyKey,
        transportRequestId: requestId,
        queryVectorLiteral: toVectorLiteral(queryEmbedding.embedding),
        queryText: queryEmbedding.canonicalInput,
        corpusEntries: loadMemoryCorpusEntries(),
      });
      return {
        statusCode: 200,
        payload: {
          ...basePayload,
          runId: resolvedRoute.parameters.runId,
          session: {
            sessionId: recalled.sessionId,
            ordinal: "B",
            state: recalled.sessionState,
            createdAt: recalled.sessionCreatedAt,
          },
          query: queryEmbedding.canonicalInput,
          matches: recalled.matches,
          receiptId: recalled.receiptId,
        },
      };
    }

    if (resolvedRoute.name === "action") {
      if (requestBody.action === "verify_unencumbered") {
        const verified = await vectorMemoryProvider.verifyPredicate({
          runId: resolvedRoute.parameters.runId,
          idempotencyKey,
          transportRequestId: requestId,
          corpusEntries: loadMemoryCorpusEntries(),
        });
        return {
          statusCode: 200,
          payload: {
            ...basePayload,
            runId: resolvedRoute.parameters.runId,
            action: "verify_unencumbered",
            receiptId: verified.receiptId,
            result: {
              kind: "VERIFIED_PREDICATE",
              predicate: verified.predicate,
              value: verified.value,
              sourceTextDisclosed: verified.sourceTextDisclosed,
              canonicalMemoryId: verified.canonicalMemoryId,
              evidenceCommitment: verified.evidenceCommitment,
              projectionGenerationId: verified.projectionGenerationId,
              midnightReceiptId: verified.midnightReceiptId,
            },
            protectedFieldsReturned: 0,
          },
        };
      }

      if (requestBody.action === "rebuild_recall_projection") {
        const rebuilt = await vectorMemoryProvider.rebuildProjection({
          runId: resolvedRoute.parameters.runId,
          idempotencyKey,
          transportRequestId: requestId,
          corpusEntries: loadMemoryCorpusEntries(),
        });
        return {
          statusCode: 200,
          payload: {
            ...basePayload,
            runId: resolvedRoute.parameters.runId,
            action: "rebuild_recall_projection",
            receiptId: rebuilt.receiptId,
            result: {
              kind: "PROJECTION_REBUILT",
              previousGenerationId: rebuilt.previousGenerationId,
              activeGenerationId: rebuilt.activeGenerationId,
              canonicalSourceCount: rebuilt.canonicalSourceCount,
              commitmentVerified: rebuilt.commitmentVerified,
              evidenceCommitment: rebuilt.evidenceCommitment,
            },
            protectedFieldsReturned: 0,
          },
        };
      }

      if (requestBody.action !== "attempt_protected_disclosure") {
        throw new PublicApiError(
          503,
          "LIVE_PROVIDERS_NOT_CONNECTED",
          "Only the protected-disclosure attempt is available in this slice.",
        );
      }
      const denial = await vectorMemoryProvider.recordDisclosureDenial({
        runId: resolvedRoute.parameters.runId,
        idempotencyKey,
        transportRequestId: requestId,
        requestedProtectedFieldNames: PROTECTED_FIELD_NAMES_REFUSED,
      });
      return {
        statusCode: 200,
        payload: {
          ...basePayload,
          runId: resolvedRoute.parameters.runId,
          action: "attempt_protected_disclosure",
          receiptId: denial.receiptId,
          result: {
            kind: "DISCLOSURE_DENIED",
            reason:
              "The requesting agent holds no authority grant for protected fields on this resource.",
            requestedProtectedFields: denial.requestedProtectedFieldNames,
          },
          // The refusal is enforced by code and by a database CHECK. No
          // protected value is ever read, so none can be returned.
          protectedFieldsReturned: denial.protectedFieldsReturned,
        },
      };
    }
  } catch (error) {
    if (error instanceof PublicApiError) {
      throw error;
    }
    throw memoryErrorToPublicError(error);
  }

  throw new PublicApiError(404, "ROUTE_NOT_FOUND", "The requested route does not exist.");
}

function unavailableOperationPayload(configuration, requestId, providerStates) {
  return {
    ...buildBasePayload(false, requestId),
    releaseCommit: configuration.releaseCommit,
    error: {
      code: "LIVE_PROVIDERS_NOT_CONNECTED",
      message:
        "This Phase 1 API shell does not execute or persist judge operations until the reviewed live providers are connected.",
      retryable: false,
    },
    providers: providerStates,
  };
}

function resolveRoute(requestPath) {
  const staticRoutes = new Map([
    // GCP deviation: Cloud Run reserves some URL paths ending in `z`, so the
    // liveness route is /health here and in this repo's web client copy.
    ["/health", { name: "health", method: "GET", parameters: {} }],
    ["/api/v1/status", { name: "status", method: "GET", parameters: {} }],
    [
      "/api/v1/judge/scenarios",
      { name: "scenarios", method: "GET", parameters: {} },
    ],
    ["/api/v1/judge/runs", { name: "startRun", method: "POST", parameters: {} }],
  ]);

  const staticRoute = staticRoutes.get(requestPath);
  if (staticRoute) {
    return staticRoute;
  }

  const closeSessionMatch = requestPath.match(
    /^\/api\/v1\/judge\/runs\/([^/]+)\/sessions\/close$/,
  );
  if (closeSessionMatch) {
    return {
      name: "closeSession",
      method: "POST",
      parameters: { runId: closeSessionMatch[1] },
    };
  }

  const recallMatch = requestPath.match(/^\/api\/v1\/judge\/runs\/([^/]+)\/recall$/);
  if (recallMatch) {
    return {
      name: "recall",
      method: "POST",
      parameters: { runId: recallMatch[1] },
    };
  }

  const actionMatch = requestPath.match(/^\/api\/v1\/judge\/runs\/([^/]+)\/actions$/);
  if (actionMatch) {
    return {
      name: "action",
      method: "POST",
      parameters: { runId: actionMatch[1] },
    };
  }

  const receiptMatch = requestPath.match(/^\/api\/v1\/judge\/receipts\/([^/]+)$/);
  if (receiptMatch) {
    return {
      name: "receipt",
      method: "GET",
      parameters: { receiptId: receiptMatch[1] },
    };
  }

  return null;
}

async function dispatchRequest(
  event,
  configuration,
  requestId,
  cockroachProvider,
  vectorMemoryProvider,
) {
  assertNoQueryParameters(event);

  const requestPath = getRequestPath(event);
  const requestMethod = getRequestMethod(event);
  const resolvedRoute = resolveRoute(requestPath);

  if (!resolvedRoute) {
    throw new PublicApiError(404, "ROUTE_NOT_FOUND", "The requested route does not exist.");
  }

  if (requestMethod !== resolvedRoute.method) {
    const methodError = new PublicApiError(
      405,
      "METHOD_NOT_ALLOWED",
      "The HTTP method is not allowed for this route.",
    );
    methodError.allowedMethod = resolvedRoute.method;
    throw methodError;
  }

  if (resolvedRoute.parameters.runId !== undefined) {
    assertBoundedIdentifier(resolvedRoute.parameters.runId, "runId");
  }
  if (resolvedRoute.parameters.receiptId !== undefined) {
    assertBoundedIdentifier(resolvedRoute.parameters.receiptId, "receiptId");
  }

  // Only the read-only routes resolve live provider states up front. The
  // memory routes decide through the two-stage gate below, which probes the
  // database only after the release-bound capability check has succeeded, so
  // a blocked mutation never touches the database and reports baseline states.
  const providerStates = ["health", "status", "scenarios"].includes(
    resolvedRoute.name,
  )
    ? await buildReadOnlyProviderStates(
        configuration,
        requestId,
        cockroachProvider,
      )
    : cloneProviderStates(configuration, requestId);

  if (resolvedRoute.name === "health") {
    return {
      statusCode: 200,
      payload: {
        ...buildBasePayload(true, requestId),
        service: "helixctw-gcp-judge-api",
        buildStage: configuration.buildStage,
        deploymentEvidence: configuration.deploymentEvidence,
        transport: buildTransportStatus(configuration, requestId),
        handler: "READY",
        dependenciesConnected: false,
        region: configuration.region,
        releaseCommit: configuration.releaseCommit,
        limits: {
          maxRequestBytes: configuration.maxRequestBytes,
          maxResponseBytes: configuration.maxResponseBytes,
        },
        providers: providerStates,
      },
    };
  }

  if (resolvedRoute.name === "status") {
    // The narrow memory-slice signal. This is NOT the global readiness flag:
    // readyForMutations stays false and currentAvailability stays
    // NOT_CONNECTED until every deferred provider earns promotion. The slice
    // signal reports only whether the five reviewed memory routes would pass
    // their own two-stage gate right now, so the browser can unlock exactly
    // that journey and nothing else.
    const memorySliceReadiness = await resolveMemoryReadiness(
      vectorMemoryProvider,
      cockroachProvider,
      configuration,
      requestId,
    );
    return {
      statusCode: 200,
      payload: {
        ...buildBasePayload(true, requestId),
        buildStage: configuration.buildStage,
        deploymentEvidence: configuration.deploymentEvidence,
        transport: buildTransportStatus(configuration, requestId),
        releaseCommit: configuration.releaseCommit,
        currentAvailability: "NOT_CONNECTED",
        readyForMutations: false,
        writeOperations: "BLOCKED_UNTIL_CONNECTED",
        memorySlice: {
          available: memorySliceReadiness.ready,
          scope: "five-route synthetic memory journey only",
          routes: [
            "create_run",
            "close_session",
            "recall",
            "attempt_protected_disclosure",
            "fetch_receipt",
          ],
          embeddingEvidence: "MOCK",
        },
        actions: [...ACTIONS],
        providers: providerStates,
      },
    };
  }

  if (resolvedRoute.name === "scenarios") {
    return {
      statusCode: 200,
      payload: {
        ...buildBasePayload(true, requestId),
        buildStage: configuration.buildStage,
        deploymentEvidence: configuration.deploymentEvidence,
        transport: buildTransportStatus(configuration, requestId),
        releaseCommit: configuration.releaseCommit,
        scenarios: [
          {
            ...CANONICAL_SCENARIO,
            fixtureEvidence: "SOURCE_ONLY",
            currentAvailability: "NOT_CONNECTED",
            actions: [...ACTIONS],
            // GCP deviation: no model-provider row exists in this edition —
            // embeddings are a deterministic fixture, so claiming one would
            // be false.
            requiredLiveProviders: ["cockroachdb", "midnight"],
            privacyBoundary:
              "The underlying deed and mortgage text must never be returned by this API.",
          },
        ],
        providers: providerStates,
      },
    };
  }

  if (resolvedRoute.name === "receipt") {
    const readiness = await resolveMemoryReadiness(
      vectorMemoryProvider,
      cockroachProvider,
      configuration,
      requestId,
    );
    if (!readiness.ready) {
      return {
        statusCode: 503,
        payload: unavailableOperationPayload(
          configuration,
          requestId,
          readiness.providerStates,
        ),
      };
    }
    let stored;
    try {
      stored = await vectorMemoryProvider.fetchReceipt({
        receiptId: resolvedRoute.parameters.receiptId,
      });
    } catch (error) {
      throw memoryErrorToPublicError(error);
    }
    return {
      statusCode: 200,
      payload: {
        ...buildBasePayload(true, requestId),
        buildStage: configuration.buildStage,
        deploymentEvidence: configuration.deploymentEvidence,
        releaseCommit: configuration.releaseCommit,
        receipt: {
          receiptId: stored.receiptId,
          runId: stored.runId,
          scenarioId: CANONICAL_SCENARIO.scenarioId,
          operation: stored.operation,
          receiptState: stored.receiptState,
          createdAt: stored.createdAt,
          completedAt: stored.completedAt,
          transportRequestId: stored.transportRequestId,
          matches: stored.matches,
          protectedFieldsReturned: stored.protectedFieldsReturned,
        },
        providers: readiness.providerStates,
      },
    };
  }

  const requestBody = readPostBody(event, configuration);
  if (resolvedRoute.name === "startRun") {
    validateStartRunBody(requestBody);
  } else if (resolvedRoute.name === "closeSession") {
    validateCloseSessionBody(requestBody);
  } else if (resolvedRoute.name === "recall") {
    validateRecallBody(requestBody);
  } else if (resolvedRoute.name === "action") {
    validateActionBody(requestBody);
  }

  const memoryReadiness = await resolveMemoryReadiness(
    vectorMemoryProvider,
    cockroachProvider,
    configuration,
    requestId,
  );
  if (memoryReadiness.ready) {
    return executeMemoryRoute({
      resolvedRoute,
      requestBody,
      event,
      configuration,
      requestId,
      providerStates: memoryReadiness.providerStates,
      vectorMemoryProvider,
    });
  }

  return {
    statusCode: 503,
    payload: unavailableOperationPayload(
      configuration,
      requestId,
      memoryReadiness.providerStates,
    ),
  };
}

/**
 * Event-shaped judge handler (Lambda payload-format 2.0 events; on GCP the
 * Node server adapter in server.js builds the same event shape, which keeps
 * this port aligned with upstream for Stage B).
 *
 * The default exported transport shell deliberately receives no database,
 * model, wallet, or test-network provider. A valid mutation returns an explicit
 * 503 until later adapters are connected, which prevents fixture behavior from
 * masquerading as a live CockroachDB or Midnight result. Tests may
 * inject the narrow read-only CockroachDB probe without enabling mutations.
 */
export function createHandler({ cockroachProvider, vectorMemoryProvider } = {}) {
  return async function configuredHandler(event) {
    const configuration = readConfiguration();
    const requestId = getRequestId(event);
    let responseOrigin = "";

    try {
      responseOrigin = validateOrigin(event, configuration);
      const dispatchedResponse = await dispatchRequest(
        event,
        configuration,
        requestId,
        cockroachProvider,
        vectorMemoryProvider,
      );
      return createJsonResponse(
        configuration,
        dispatchedResponse.statusCode,
        dispatchedResponse.payload,
        requestId,
        responseOrigin,
      );
    } catch (error) {
      if (error instanceof PublicApiError) {
        const additionalHeaders =
          error.allowedMethod === undefined ? {} : { allow: error.allowedMethod };
        return createJsonResponse(
          configuration,
          error.statusCode,
          {
            ...buildBasePayload(false, requestId),
            error: {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
            },
          },
          requestId,
          responseOrigin,
          additionalHeaders,
        );
      }

      // Never serialize or log the unexpected error object. Provider libraries
      // can place credentials or private payload fragments in their messages.
      console.error(
        JSON.stringify({
          level: "error",
          code: "UNEXPECTED_HANDLER_FAILURE",
          requestId,
        }),
      );

      return createJsonResponse(
        configuration,
        500,
        {
          ...buildBasePayload(false, requestId),
          error: {
            code: "INTERNAL_ERROR",
            message: "The bounded request could not be completed.",
            retryable: false,
          },
        },
        requestId,
        responseOrigin,
      );
    }
  };
}

// The default export remains database-disconnected until a later reviewed
// bootstrap injects a query executor that enforces the required server-side
// statement timeout.
export const handler = createHandler();
