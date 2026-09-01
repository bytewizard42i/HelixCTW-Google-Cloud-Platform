// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createGcpVectorMemoryProvider,
  GCP_VECTOR_DATABASE_NAME,
  GCP_VECTOR_RUNTIME_USER,
  parseGcpVectorDatabaseUrl,
} from "../src/gcp-vector-bootstrap.js";

const VALID_URL =
  "postgresql://mhelix_gcp_runtime:0123456789abcdef@sample.cockroachlabs.cloud:26257/mhelix_gcp_testwired?sslmode=verify-full";
const RELEASE_COMMIT = "a".repeat(40);

test("parses only the dedicated GCP vector database identity", () => {
  const parsed = parseGcpVectorDatabaseUrl(VALID_URL);
  assert.equal(parsed.database, GCP_VECTOR_DATABASE_NAME);
  assert.equal(parsed.user, GCP_VECTOR_RUNTIME_USER);
  assert.equal(parsed.host, "sample.cockroachlabs.cloud");
  assert.equal(parsed.port, 26_257);
});

for (const [label, invalidUrl] of [
  ["database", VALID_URL.replace("mhelix_gcp_testwired", "helix_testtown")],
  ["runtime user", VALID_URL.replace("mhelix_gcp_runtime", "admin")],
  ["host", VALID_URL.replace("sample.cockroachlabs.cloud", "database.example.com")],
  ["password", VALID_URL.replace("0123456789abcdef", "too-short")],
]) {
  test(`rejects the wrong ${label}`, () => {
    assert.throws(
      () => parseGcpVectorDatabaseUrl(invalidUrl),
      /vector database URL identity is invalid/,
    );
  });
}

test("builds the provider with a bounded two-connection TLS pool", () => {
  let poolConfiguration;
  let providerOptions;
  const fakePool = { connect: async () => undefined };
  const fakeProvider = { checkCapability: async () => undefined };

  const provider = createGcpVectorMemoryProvider({
    databaseUrl: VALID_URL,
    releaseCommit: RELEASE_COMMIT,
    poolFactory(configuration) {
      poolConfiguration = configuration;
      return fakePool;
    },
    providerFactory(options) {
      providerOptions = options;
      return fakeProvider;
    },
  });

  assert.equal(provider, fakeProvider);
  assert.equal(poolConfiguration.database, GCP_VECTOR_DATABASE_NAME);
  assert.equal(poolConfiguration.user, GCP_VECTOR_RUNTIME_USER);
  assert.equal(poolConfiguration.max, 2);
  assert.deepEqual(poolConfiguration.ssl, { rejectUnauthorized: true });
  assert.equal(poolConfiguration.statement_timeout, 4_000);
  assert.equal(poolConfiguration.query_timeout, 4_500);
  assert.equal(providerOptions.pool, fakePool);
  assert.equal(providerOptions.releaseCommit, RELEASE_COMMIT);
  assert.equal(providerOptions.scenarioId, "morrow-farmhouse-testwired-v1");
});

test("rejects an invalid release commit before constructing a pool", () => {
  assert.throws(
    () => createGcpVectorMemoryProvider({ databaseUrl: VALID_URL, releaseCommit: "main" }),
    /40-character release commit/,
  );
});
