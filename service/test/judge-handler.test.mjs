// SPDX-License-Identifier: Apache-2.0
// Port-integrity tests for the judge API (see judge-handler.js). Style follows
// MidnightHelixCTW/apps/api/test/handler.test.mjs: configuration is set via
// environment variables, events use the Lambda payload-format 2.0 shape, and
// fail-closed behaviour is asserted, never assumed.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { createHandler } from "../src/judge-handler.js";
import { PROVIDER_STATES } from "../src/judge-constants.js";

const ALLOWED_ORIGIN = "https://helixctw.com";

beforeEach(() => {
  process.env.HELIXCTW_ALLOWED_ORIGINS = `${ALLOWED_ORIGIN},http://localhost:5178`;
  process.env.HELIXCTW_RELEASE_COMMIT = "a".repeat(40);
  process.env.HELIXCTW_GCP_REGION = "us-east1";
  delete process.env.K_SERVICE;
  delete process.env.K_REVISION;
  delete process.env.K_CONFIGURATION;
  delete process.env.PORT;
});

function buildEvent({ method = "GET", path = "/health", origin, body, idempotencyKey } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return {
    rawPath: path,
    rawQueryString: "",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { requestId: "test-request-1", http: { method, path } },
  };
}

test("health answers the envelope with the GCP service identity", async () => {
  const handler = createHandler();
  const response = await handler(buildEvent({ path: "/health", origin: ALLOWED_ORIGIN }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-request-id"], "test-request-1");
  assert.equal(response.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
  assert.equal(response.headers["access-control-expose-headers"], "x-request-id");
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.schemaVersion, "mhelixctw/api/v1");
  assert.equal(payload.service, "helixctw-gcp-judge-api");
  assert.equal(payload.transport.providerId, "gcp");
  assert.equal(payload.transport.scope, "GCP_CLOUD_RUN_ONLY");
});

test("healthz stays unavailable: Cloud Run reserves z-suffixed paths", async () => {
  const handler = createHandler();
  const response = await handler(buildEvent({ path: "/healthz" }));
  assert.equal(response.statusCode, 404);
});

test("outside a validated Cloud Run runtime the gcp row stays SOURCE_ONLY", async () => {
  const handler = createHandler();
  const response = await handler(buildEvent({ path: "/api/v1/status" }));
  const payload = JSON.parse(response.body);
  const gcpRow = payload.providers.find((provider) => provider.id === "gcp");
  assert.equal(gcpRow.evidence, "SOURCE_ONLY");
  assert.equal(gcpRow.connection, "NOT_CONNECTED");
});

test("a consistent Cloud Run runtime promotes only the gcp transport row", async () => {
  process.env.K_SERVICE = "helixctw-compliance";
  process.env.K_REVISION = "helixctw-compliance-00007-abc";
  process.env.K_CONFIGURATION = "helixctw-compliance";
  process.env.PORT = "8080";
  const handler = createHandler();
  const response = await handler(buildEvent({ path: "/api/v1/status" }));
  const payload = JSON.parse(response.body);
  const gcpRow = payload.providers.find((provider) => provider.id === "gcp");
  assert.equal(gcpRow.evidence, "REALDEAL_TEST");
  assert.equal(gcpRow.connection, "CONNECTED");
  assert.equal(gcpRow.evidenceReference.provider, "gcp");
  for (const provider of payload.providers) {
    if (provider.id !== "gcp") {
      assert.equal(provider.connection, "NOT_CONNECTED", provider.id);
    }
  }
});

test("status keeps the memory journey locked in Stage A", async () => {
  const handler = createHandler();
  const response = await handler(buildEvent({ path: "/api/v1/status" }));
  const payload = JSON.parse(response.body);
  assert.equal(payload.readyForMutations, false);
  assert.equal(payload.memorySlice.available, false);
  assert.equal(payload.memorySlice.embeddingEvidence, "MOCK");
});

test("scenarios catalogues the synthetic Morrow case without a model provider", async () => {
  const handler = createHandler();
  const response = await handler(buildEvent({ path: "/api/v1/judge/scenarios" }));
  const payload = JSON.parse(response.body);
  const [scenario] = payload.scenarios;
  assert.equal(scenario.scenarioId, "morrow-farmhouse-testwired-v1");
  assert.equal(scenario.synthetic, true);
  assert.deepEqual(scenario.requiredLiveProviders, ["cockroachdb", "midnight"]);
});

test("a valid mutation fails closed with 503 while no memory provider exists", async () => {
  const handler = createHandler();
  const response = await handler(
    buildEvent({
      method: "POST",
      path: "/api/v1/judge/runs",
      origin: ALLOWED_ORIGIN,
      body: { scenarioId: "morrow-farmhouse-testwired-v1" },
      idempotencyKey: "mhelix-test:0123456789abcdef",
    }),
  );
  assert.equal(response.statusCode, 503);
  const payload = JSON.parse(response.body);
  assert.equal(payload.error.code, "LIVE_PROVIDERS_NOT_CONNECTED");
});

test("an origin outside the allowlist is refused", async () => {
  const handler = createHandler();
  const response = await handler(
    buildEvent({ path: "/health", origin: "https://evil.example" }),
  );
  assert.equal(response.statusCode, 403);
});

test("a connected CockroachDB probe upgrades exactly its own row", async () => {
  const probeReceiptId = "690f67f3-1cc9-4cdd-9d1f-9896d9b048b9";
  const observedAt = new Date().toISOString();
  const handler = createHandler({
    cockroachProvider: {
      probe: async () => ({
        schemaVersion: "helixctw-gcp/cockroach-probe/v1",
        connected: true,
        receiptId: probeReceiptId,
        observedAt,
      }),
    },
  });
  const response = await handler(buildEvent({ path: "/api/v1/status" }));
  const payload = JSON.parse(response.body);
  const cockroachRow = payload.providers.find(
    (provider) => provider.id === "cockroachdb",
  );
  assert.equal(cockroachRow.evidence, "REALDEAL_TEST");
  assert.equal(cockroachRow.connection, "CONNECTED");
  assert.equal(cockroachRow.evidenceReference.receiptId, probeReceiptId);
});

test("the provider baseline itself is fail-closed", () => {
  for (const provider of PROVIDER_STATES) {
    assert.equal(provider.evidence, "SOURCE_ONLY", provider.id);
    assert.equal(provider.connection, "NOT_CONNECTED", provider.id);
  }
});
