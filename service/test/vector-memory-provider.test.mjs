// SPDX-License-Identifier: Apache-2.0
//
// Adapted from MidnightHelixCTW/apps/api/test/vector-memory-provider.test.mjs.
//
// Behavioural tests for the vector-memory provider against a scripted fake
// CockroachDB client. No database, no network.
//
// These prove the properties that matter for trust: one transaction per
// operation, rollback on failure, retry limited to serialization conflicts,
// idempotent replay, refusal of a reused key with different content, the write
// gate, and the rule that no stored vector or raw idempotency key ever escapes.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  VECTOR_MEMORY_CAPABILITY_ID,
  VectorMemoryError,
  commitToCanonicalObject,
  createVectorMemoryProvider,
} from "../src/vector-memory-provider.js";

const RELEASE_COMMIT = "a".repeat(40);
const SCENARIO_ID = "morrow-farmhouse-testwired-v1";
const CASE_NAMESPACE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_A_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_B_ID = "44444444-4444-4444-8444-444444444444";
const PROJECTION_ID = "55555555-5555-4555-8555-555555555555";
const RECEIPT_ID = "66666666-6666-4666-8666-666666666666";
const SUMMARY_ID = "77777777-7777-4777-8777-777777777777";
// A request-scoped replay identifier fixture. Deliberately not named or
// shaped like a credential: it is a public, non-secret request marker.
const REPLAY_IDENTIFIER = "penny-test-replay-identifier-0001";

/**
 * A fake pool that records every statement and returns scripted rows.
 * `responder` receives the SQL text and parameters and returns rows.
 */
function createFakePool(responder, options = {}) {
  const log = [];
  let connectCount = 0;
  let releaseCount = 0;
  const pool = {
    log,
    get connectCount() {
      return connectCount;
    },
    get releaseCount() {
      return releaseCount;
    },
    async connect() {
      connectCount += 1;
      return {
        async query(request) {
          // Catalog statements are formatted literals that begin with a
          // newline, so normalize before matching or `startsWith` never fires.
          const rawText = typeof request === "string" ? request : request.text;
          const text = rawText.trim();
          const values = typeof request === "string" ? [] : request.values;
          log.push({ text, values });
          const rows = await responder(text, values, log);
          return { rows: rows ?? [] };
        },
        release() {
          releaseCount += 1;
        },
      };
    },
  };
  return Object.assign(pool, options);
}

/** Default happy-path responder covering the full journey. */
function defaultResponder(overrides = {}) {
  const state = { capabilityRows: [{ capability_state: "SOURCE_ONLY", capability_version: 1, public_mutations_enabled: false }], ...overrides };
  return async (text, values) => {
    if (text.startsWith("BEGIN") || text.startsWith("COMMIT") || text.startsWith("ROLLBACK")) {
      return [];
    }
    if (text.includes("mhelix_runtime_capabilities")) return state.capabilityRows;
    if (text.includes("mhelix_case_namespaces")) {
      return [{ case_namespace_id: CASE_NAMESPACE_ID, release_commit: RELEASE_COMMIT }];
    }
    if (text.includes("create_idempotency_key_hash")) {
      if (text.startsWith("SELECT")) return state.priorRun ?? [];
      return [{ run_id: RUN_ID, run_state: "OPEN" }];
    }
    if (text.includes("FROM mhelix_gcp_testwired.mhelix_memory_sessions")) {
      const ordinal = values[1];
      if (ordinal === "A") return state.sessionA ?? [{ session_id: SESSION_A_ID, session_state: "OPEN", started_at: "t" }];
      return state.sessionB ?? [{ session_id: SESSION_B_ID, session_state: "OPEN", started_at: "t" }];
    }
    if (text.startsWith("INSERT INTO mhelix_gcp_testwired.mhelix_memory_sessions")) {
      return [{ session_id: values[2] === "A" ? SESSION_A_ID : SESSION_B_ID, session_state: "OPEN", started_at: "t" }];
    }
    if (text.includes("FROM mhelix_gcp_testwired.mhelix_action_receipts")) {
      return state.priorReceipt ?? [];
    }
    if (text.startsWith("INSERT INTO mhelix_gcp_testwired.mhelix_action_receipts")) {
      return [{ action_receipt_id: RECEIPT_ID, receipt_state: "RESERVED", created_at: "t" }];
    }
    if (text.startsWith("INSERT INTO mhelix_gcp_testwired.mhelix_projection_generations")) {
      return [{ projection_generation_id: PROJECTION_ID, generation_state: "BUILDING" }];
    }
    if (text.startsWith("INSERT INTO mhelix_gcp_testwired.mhelix_memory_summaries")) {
      return [{ memory_summary_id: SUMMARY_ID }];
    }
    if (text.startsWith("INSERT INTO mhelix_gcp_testwired.mhelix_memory_events")) {
      return [{ memory_event_id: "e", event_sequence: values[1] }];
    }
    if (text.includes("FROM mhelix_gcp_testwired.mhelix_run_active_projections")) {
      return state.activeProjection ?? [{ projection_generation_id: PROJECTION_ID }];
    }
    if (text.includes("<=>")) {
      return state.recallRows ?? [
        { memory_summary_id: SUMMARY_ID, session_id: SESSION_A_ID, projection_generation_id: PROJECTION_ID, public_safe_summary: "Edgar Morrow is a TestTown citizen.", cosine_distance: 0.0125 },
      ];
    }
    if (text.includes("FROM mhelix_gcp_testwired.mhelix_recall_result_items")) {
      return state.storedItems ?? [];
    }
    return [{ ok: true }];
  };
}

function buildProvider(responder, extra = {}) {
  const pool = createFakePool(responder);
  const provider = createVectorMemoryProvider({
    pool,
    scenarioId: SCENARIO_ID,
    releaseCommit: RELEASE_COMMIT,
    agentIdentifier: "didz:testtown:agent:morrow-property-assistant",
    resourceIdentifier: "rwaz:testtown:property:morrow-family-farmhouse",
    authorityGrantIdentifier: "grant:testtown:morrow-property-unencumbered:v1",
    permittedPredicate: "property.is_unencumbered",
    ...extra,
  });
  return { pool, provider };
}

const CORPUS_ENTRY = Object.freeze({
  fixtureId: "testtown-citizens-edgar-morrow",
  publicSafeSummary: "Edgar Morrow is a TestTown citizen.",
  embeddingModelId: "mhelixctw-synthetic-embedding-v1",
  embeddingDimensions: 8,
  vectorLiteral: "[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8]",
  embeddingCommitmentHex: "ab".repeat(32),
});

test("the provider requires a pool, a scenario, and a real release commit", () => {
  assert.throws(() => createVectorMemoryProvider({}), TypeError);
  assert.throws(
    () => createVectorMemoryProvider({ pool: { connect() {} } }),
    TypeError,
  );
  assert.throws(
    () =>
      createVectorMemoryProvider({
        pool: { connect() {} },
        scenarioId: SCENARIO_ID,
        releaseCommit: "not-a-commit",
      }),
    TypeError,
  );
});

test("every write runs inside one serializable transaction", async () => {
  const { pool, provider } = buildProvider(defaultResponder());
  await provider.createRun({
    agentIdentifier: "didz:testtown:agent:morrow-property-assistant",
    idempotencyKey: REPLAY_IDENTIFIER,
    transportRequestId: "req-1",
  });
  const begins = pool.log.filter((entry) => entry.text.startsWith("BEGIN"));
  const commits = pool.log.filter((entry) => entry.text === "COMMIT");
  assert.equal(begins.length, 1);
  assert.equal(commits.length, 1);
  assert.match(begins[0].text, /ISOLATION LEVEL SERIALIZABLE/);
  // The connection is always returned to the pool.
  assert.equal(pool.connectCount, pool.releaseCount);
});

test("a failure rolls back and releases the connection", async () => {
  const { pool, provider } = buildProvider(async (text) => {
    if (text.startsWith("BEGIN") || text.startsWith("ROLLBACK")) return [];
    if (text.includes("mhelix_runtime_capabilities")) {
      return [{ capability_state: "SOURCE_ONLY", capability_version: 1, public_mutations_enabled: false }];
    }
    if (text.includes("mhelix_case_namespaces")) {
      throw Object.assign(new Error("boom"), { code: "XXUNKNOWN" });
    }
    return [];
  });
  await assert.rejects(
    provider.createRun({ agentIdentifier: "a", idempotencyKey: REPLAY_IDENTIFIER, transportRequestId: "r" }),
    /boom/,
  );
  assert.equal(pool.log.filter((entry) => entry.text === "ROLLBACK").length, 1);
  assert.equal(pool.log.filter((entry) => entry.text === "COMMIT").length, 0);
  assert.equal(pool.connectCount, pool.releaseCount);
});

test("only serialization conflicts retry, and at most three attempts", async () => {
  let attempts = 0;
  const { pool, provider } = buildProvider(async (text, values) => {
    if (text.startsWith("BEGIN")) {
      attempts += 1;
      return [];
    }
    if (text.startsWith("ROLLBACK") || text.startsWith("COMMIT")) return [];
    if (text.includes("mhelix_runtime_capabilities")) {
      throw Object.assign(new Error("restart transaction"), { code: "40001" });
    }
    return [];
  });
  await assert.rejects(
    provider.createRun({ agentIdentifier: "a", idempotencyKey: REPLAY_IDENTIFIER, transportRequestId: "r" }),
    /restart transaction/,
  );
  assert.equal(attempts, 3, "expected exactly three bounded attempts");
  assert.equal(pool.connectCount, pool.releaseCount);
});

test("a non-serialization error is never retried", async () => {
  let attempts = 0;
  const { provider } = buildProvider(async (text) => {
    if (text.startsWith("BEGIN")) {
      attempts += 1;
      return [];
    }
    if (text.startsWith("ROLLBACK")) return [];
    if (text.includes("mhelix_runtime_capabilities")) {
      throw Object.assign(new Error("permission denied"), { code: "42501" });
    }
    return [];
  });
  await assert.rejects(
    provider.createRun({ agentIdentifier: "a", idempotencyKey: REPLAY_IDENTIFIER, transportRequestId: "r" }),
    /permission denied/,
  );
  assert.equal(attempts, 1);
});

test("the write gate blocks when no capability is recorded for this release", async () => {
  const { provider } = buildProvider(defaultResponder({ capabilityRows: [] }));
  await assert.rejects(
    provider.createRun({ agentIdentifier: "a", idempotencyKey: REPLAY_IDENTIFIER, transportRequestId: "r" }),
    (error) => error instanceof VectorMemoryError && error.code === "CAPABILITY_NOT_ACTIVATED",
  );
});

test("the write gate blocks a capability claiming public mutation readiness", async () => {
  const { provider } = buildProvider(
    defaultResponder({
      capabilityRows: [
        { capability_state: "LIVE_TESTWIRED", capability_version: 1, public_mutations_enabled: true },
      ],
    }),
  );
  await assert.rejects(
    provider.createRun({ agentIdentifier: "a", idempotencyKey: REPLAY_IDENTIFIER, transportRequestId: "r" }),
    (error) => error instanceof VectorMemoryError && error.code === "CAPABILITY_INVALID",
  );
});

test("the capability is queried for this exact release commit", async () => {
  const { pool, provider } = buildProvider(defaultResponder());
  await provider.checkCapability();
  const query = pool.log.find((entry) => entry.text.includes("mhelix_runtime_capabilities"));
  assert.deepEqual(query.values, [VECTOR_MEMORY_CAPABILITY_ID, RELEASE_COMMIT]);
});

test("the raw idempotency key is hashed and never sent to the database", async () => {
  const { pool, provider } = buildProvider(defaultResponder());
  await provider.createRun({
    agentIdentifier: "a",
    idempotencyKey: REPLAY_IDENTIFIER,
    transportRequestId: "req-1",
  });
  const expectedHash = createHash("sha256").update(REPLAY_IDENTIFIER, "utf8").digest();
  const everyValue = pool.log.flatMap((entry) => entry.values ?? []);
  // The raw key must appear nowhere.
  assert.equal(
    everyValue.some((value) => typeof value === "string" && value.includes(REPLAY_IDENTIFIER)),
    false,
    "raw idempotency key reached the database",
  );
  // Its 32-byte hash must appear.
  assert.equal(
    everyValue.some((value) => Buffer.isBuffer(value) && value.equals(expectedHash)),
    true,
    "hashed idempotency key missing",
  );
});

test("a malformed idempotency key is rejected before any connection", async () => {
  const { pool, provider } = buildProvider(defaultResponder());
  for (const bad of ["", "short", "has spaces in it here", "x".repeat(129)]) {
    await assert.rejects(
      provider.createRun({ agentIdentifier: "a", idempotencyKey: bad, transportRequestId: "r" }),
      (error) => error.code === "INVALID_IDEMPOTENCY_KEY",
    );
  }
  assert.equal(pool.connectCount, 0, "a bad key must not open a connection");
});

test("replaying the same key with the same request returns the same run", async () => {
  const { pool, provider } = buildProvider(
    defaultResponder({ priorRun: [{ run_id: RUN_ID, run_state: "OPEN", agent_identifier: "a" }] }),
  );
  const result = await provider.createRun({
    agentIdentifier: "a",
    idempotencyKey: REPLAY_IDENTIFIER,
    transportRequestId: "req-2",
  });
  assert.equal(result.replayed, true);
  assert.equal(result.runId, RUN_ID);
  // No new run may be inserted on replay.
  assert.equal(
    pool.log.some((entry) => entry.text.startsWith("INSERT INTO mhelix_gcp_testwired.mhelix_runs")),
    false,
  );
});

test("reusing a key with different content fails and writes nothing", async () => {
  const differentCommitment = commitToCanonicalObject({ something: "else" });
  const { pool, provider } = buildProvider(
    defaultResponder({
      priorReceipt: [
        {
          action_receipt_id: RECEIPT_ID,
          receipt_state: "COMMITTED",
          request_commitment: differentCommitment,
        },
      ],
    }),
  );
  await assert.rejects(
    provider.recall({
      runId: RUN_ID,
      idempotencyKey: REPLAY_IDENTIFIER,
      transportRequestId: "r",
      queryVectorLiteral: "[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8]",
      queryText: "where were we",
    }),
    (error) => error instanceof VectorMemoryError && error.code === "IDEMPOTENCY_CONFLICT",
  );
  // Nothing was written, and the transaction rolled back.
  assert.equal(
    pool.log.some((entry) => entry.text.startsWith("INSERT INTO mhelix_gcp_testwired.mhelix_recall_result_items")),
    false,
  );
  assert.equal(pool.log.filter((entry) => entry.text === "COMMIT").length, 0);
  assert.equal(pool.log.filter((entry) => entry.text === "ROLLBACK").length, 1);
});

test("recall constrains both index prefixes and resolves the projection from the run", async () => {
  const { pool, provider } = buildProvider(defaultResponder());
  const result = await provider.recall({
    runId: RUN_ID,
    idempotencyKey: REPLAY_IDENTIFIER,
    transportRequestId: "r",
    queryVectorLiteral: "[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8]",
    queryText: "where were we",
  });
  const vectorQuery = pool.log.find((entry) => entry.text.includes("<=>"));
  assert.equal(vectorQuery.values[0], RUN_ID);
  assert.equal(vectorQuery.values[1], PROJECTION_ID, "projection must come from the run");
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].objectId, "rwaz:testtown:property:morrow-family-farmhouse");
  assert.equal(result.matches[0].permittedPredicate, "property.is_unencumbered");
});

test("recall fails closed when the run has no active projection", async () => {
  const { provider } = buildProvider(defaultResponder({ activeProjection: [] }));
  await assert.rejects(
    provider.recall({
      runId: RUN_ID,
      idempotencyKey: REPLAY_IDENTIFIER,
      transportRequestId: "r",
      queryVectorLiteral: "[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8]",
      queryText: "q",
    }),
    (error) => error.code === "PROJECTION_NOT_ACTIVE",
  );
});

test("closing a session stores summaries, embeddings, and activates the projection", async () => {
  const { pool, provider } = buildProvider(defaultResponder());
  const result = await provider.closeSessionAndBuildProjection({
    runId: RUN_ID,
    idempotencyKey: REPLAY_IDENTIFIER,
    transportRequestId: "r",
    corpusEntries: [CORPUS_ENTRY, { ...CORPUS_ENTRY, fixtureId: "second" }],
  });
  assert.equal(result.storedSummaryCount, 2);
  assert.equal(result.projectionGenerationId, PROJECTION_ID);
  const embeddingInserts = pool.log.filter((entry) =>
    entry.text.startsWith("INSERT INTO mhelix_gcp_testwired.mhelix_memory_summary_embeddings"),
  );
  assert.equal(embeddingInserts.length, 2);
  // The vector crosses as a bound parameter, never interpolated text.
  assert.equal(embeddingInserts[0].values[7], CORPUS_ENTRY.vectorLiteral);
  assert.match(embeddingInserts[0].text, /\$8::VECTOR/);
  // The commitment is stored as 32 raw bytes.
  assert.equal(Buffer.isBuffer(embeddingInserts[0].values[8]), true);
  assert.equal(embeddingInserts[0].values[8].length, 32);
  // Projection is activated and the session closed, in one transaction.
  assert.equal(pool.log.filter((entry) => entry.text === "COMMIT").length, 1);
});

test("the denial writes a DENIED receipt and returns zero protected fields", async () => {
  const { pool, provider } = buildProvider(
    defaultResponder({ sessionB: [{ session_id: SESSION_B_ID, session_state: "OPEN" }] }),
  );
  const result = await provider.recordDisclosureDenial({
    runId: RUN_ID,
    idempotencyKey: REPLAY_IDENTIFIER,
    transportRequestId: "r",
    requestedProtectedFieldNames: ["ein", "born", "not valid!", 42],
  });
  assert.equal(result.protectedFieldsReturned, 0);
  assert.equal(result.receiptState, "DENIED");
  // Only well-formed field NAMES survive; no values are involved at all.
  assert.deepEqual(result.requestedProtectedFieldNames, ["ein", "born"]);
  const settle = pool.log.find((entry) =>
    entry.text.startsWith("UPDATE mhelix_gcp_testwired.mhelix_action_receipts"),
  );
  assert.equal(settle.values[2], "DENIED");
});

test("a receipt fetch returns only allowlisted public fields", async () => {
  const { provider } = buildProvider(async (text) => {
    if (text.includes("FROM mhelix_gcp_testwired.mhelix_action_receipts")) {
      return [
        {
          action_receipt_id: RECEIPT_ID,
          run_id: RUN_ID,
          operation: "recall",
          receipt_state: "COMMITTED",
          protected_fields_returned: 0,
          transport_request_id: "req-9",
          created_at: "t0",
          completed_at: "t1",
          agent_identifier: "a",
          // A column that must never surface:
          idempotency_key_hash: Buffer.alloc(32, 1),
        },
      ];
    }
    if (text.includes("FROM mhelix_gcp_testwired.mhelix_recall_result_items")) {
      return [
        {
          memory_summary_id: SUMMARY_ID,
          result_rank: 1,
          cosine_distance: 0.02,
          projection_generation_id: PROJECTION_ID,
          public_safe_summary: "Edgar Morrow is a TestTown citizen.",
          session_id: "33333333-3333-4333-8333-333333333333",
        },
      ];
    }
    return [];
  });
  const receipt = await provider.fetchReceipt({ receiptId: RECEIPT_ID });
  assert.deepEqual(Object.keys(receipt).sort(), [
    "completedAt",
    "createdAt",
    "matches",
    "operation",
    "protectedFieldsReturned",
    "receiptId",
    "receiptState",
    "runId",
    "transportRequestId",
  ]);
  assert.equal("idempotency_key_hash" in receipt, false);
  assert.equal(receipt.protectedFieldsReturned, 0);
  assert.equal(receipt.matches[0].objectId, "rwaz:testtown:property:morrow-family-farmhouse");
  assert.equal(receipt.matches[0].permittedPredicate, "property.is_unencumbered");
});

test("a malformed identifier is rejected before any query", async () => {
  const { pool, provider } = buildProvider(defaultResponder());
  await assert.rejects(
    provider.fetchReceipt({ receiptId: "not-a-uuid" }),
    (error) => error.code === "INVALID_INPUT",
  );
  assert.equal(pool.connectCount, 0);
});

test("overlength summary text is refused rather than truncated", async () => {
  const { provider } = buildProvider(defaultResponder());
  await assert.rejects(
    provider.closeSessionAndBuildProjection({
      runId: RUN_ID,
      idempotencyKey: REPLAY_IDENTIFIER,
      transportRequestId: "r",
      corpusEntries: [{ ...CORPUS_ENTRY, publicSafeSummary: "x".repeat(513) }],
    }),
    (error) => error.code === "INVALID_INPUT",
  );
});
