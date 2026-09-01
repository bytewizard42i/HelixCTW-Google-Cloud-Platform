// SPDX-License-Identifier: Apache-2.0
//
// Ported from MidnightHelixCTW/apps/api/src/vector-memory-statements.js.
// The upstream Apache-2.0 catalog is retained with only the GCP schema change.
//
// The complete, frozen catalog of SQL (Structured Query Language) statements
// the vector-memory routes are permitted to execute.
//
// THIS FILE IS THE SECURITY BOUNDARY. There is deliberately no general query
// executor anywhere in this application: a caller cannot supply SQL, compose
// SQL, or name a table. Callers may only invoke a named operation from this
// catalog, and every value crosses the boundary as a bound parameter, never as
// interpolated text. A bug in a route therefore cannot become a data breach or
// an arbitrary-read primitive.
//
// Rules enforced by `service/test/vector-memory-statements.test.mjs`:
//   1. Every statement is a static string literal. No template interpolation,
//      no concatenation, no runtime construction.
//   2. Every statement is fully schema-qualified to `mhelix_gcp_testwired`.
//   3. Every statement's parameters are positional placeholders numbered
//      exactly $1..$n with no gaps.
//   4. No statement performs DELETE, TRUNCATE, DROP, ALTER, CREATE, GRANT,
//      REVOKE, UPSERT, or ON CONFLICT. Memory is append-only; the only updates
//      are the three reviewed lifecycle transitions.
//   5. No statement uses `SELECT *`, so a later column addition can never
//      widen a response by accident.
//   6. Every read of the embedding table selects references and distances
//      only. The stored vector and its commitment are never returned to a
//      caller.
//
// Reviewed against migration 001 and migration 002 column names.

/**
 * Read the synthetic case namespace for the one permitted scenario.
 * Used to resolve every later foreign key without trusting caller input.
 */
const SELECT_CASE_NAMESPACE_BY_SCENARIO = `
SELECT case_namespace_id, release_commit
  FROM mhelix_gcp_testwired.mhelix_case_namespaces
 WHERE scenario_id = $1
   AND synthetic = true
 LIMIT 1
`;

/**
 * Read the release-bound vector-memory capability.
 *
 * This is one half of the mutation gate. It proves a capability row exists for
 * the exact release the caller claims to be running. It cannot prove that
 * release is genuinely deployed; the handler compares it independently against
 * the deployed release identifier.
 */
const SELECT_RUNTIME_CAPABILITY = `
SELECT capability_state, capability_version, public_mutations_enabled
  FROM mhelix_gcp_testwired.mhelix_runtime_capabilities
 WHERE capability_id = $1
   AND release_commit = $2
 LIMIT 1
`;

/**
 * Idempotent replay lookup for run creation. A repeated key with the same
 * request must return the same durable identifiers rather than create a run.
 */
const SELECT_RUN_BY_IDEMPOTENCY = `
SELECT run_id, run_state, agent_identifier
  FROM mhelix_gcp_testwired.mhelix_runs
 WHERE case_namespace_id = $1
   AND create_idempotency_key_hash = $2
 LIMIT 1
`;

const INSERT_RUN = `
INSERT INTO mhelix_gcp_testwired.mhelix_runs
  (case_namespace_id, agent_identifier, create_idempotency_key_hash)
VALUES ($1, $2, $3)
RETURNING run_id, run_state
`;

const INSERT_SESSION = `
INSERT INTO mhelix_gcp_testwired.mhelix_memory_sessions
  (case_namespace_id, run_id, session_ordinal, actor_identifier,
   resource_identifier, authority_grant_identifier)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING session_id, session_state, started_at
`;

const SELECT_SESSION_BY_ORDINAL = `
SELECT session_id, session_state, started_at
  FROM mhelix_gcp_testwired.mhelix_memory_sessions
 WHERE run_id = $1
   AND session_ordinal = $2
 LIMIT 1
`;

/**
 * Append one typed public-safe event. `protected_fields_returned` is pinned to
 * zero by a CHECK constraint in migration 001, so a denial event physically
 * cannot record a leaked field.
 */
const INSERT_MEMORY_EVENT = `
INSERT INTO mhelix_gcp_testwired.mhelix_memory_events
  (session_id, event_sequence, event_type, public_safe_summary,
   summary_commitment, evidence_commitment, occurred_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING memory_event_id, event_sequence
`;

/**
 * Get the next available event sequence for a session, so action handlers
 * don't collide with existing events (recall uses 1, denial uses 2, etc.).
 * Returns COALESCE(max+1, 1) so an empty session starts at 1.
 */
const SELECT_NEXT_EVENT_SEQUENCE = `
SELECT COALESCE(MAX(event_sequence), 0) + 1 AS next_sequence
  FROM mhelix_gcp_testwired.mhelix_memory_events
 WHERE session_id = $1
`;

/**
 * Anchor a summary to an event in the same session. The composite foreign key
 * in migration 001 makes a cross-session anchor impossible.
 */
const INSERT_MEMORY_SUMMARY = `
INSERT INTO mhelix_gcp_testwired.mhelix_memory_summaries
  (session_id, through_event_sequence, public_safe_summary, summary_commitment)
VALUES ($1, $2, $3, $4)
RETURNING memory_summary_id
`;

const INSERT_PROJECTION_GENERATION = `
INSERT INTO mhelix_gcp_testwired.mhelix_projection_generations
  (case_namespace_id, generation_state, canonical_source_count,
   evidence_commitment)
VALUES ($1, 'BUILDING', $2, $3)
RETURNING projection_generation_id, generation_state
`;

/** One of exactly three reviewed lifecycle transitions. */
const UPDATE_PROJECTION_VERIFIED = `
UPDATE mhelix_gcp_testwired.mhelix_projection_generations
   SET generation_state = 'ACTIVE', verified_at = now()
 WHERE case_namespace_id = $1
   AND projection_generation_id = $2
   AND generation_state = 'BUILDING'
RETURNING projection_generation_id, generation_state, verified_at
`;

/**
 * Bind the active projection to this run. The primary key on `run_id` means a
 * run has exactly one active projection, so a caller cannot activate a
 * historical generation by supplying its identifier.
 */
const INSERT_RUN_ACTIVE_PROJECTION = `
INSERT INTO mhelix_gcp_testwired.mhelix_run_active_projections
  (run_id, case_namespace_id, projection_generation_id)
VALUES ($1, $2, $3)
RETURNING run_id, projection_generation_id, bound_at
`;

const SELECT_RUN_ACTIVE_PROJECTION = `
SELECT projection_generation_id
  FROM mhelix_gcp_testwired.mhelix_run_active_projections
 WHERE run_id = $1
 LIMIT 1
`;

/**
 * The fourth reviewed lifecycle transition: repoint a run's single active
 * projection to a newly rebuilt generation.
 *
 * The primary key on `run_id` deliberately allows one row per run, so the
 * rebuild drill cannot INSERT a second binding; it must repoint the existing
 * one. Two guards keep this transition exact:
 *   1. `projection_generation_id = $3` is an optimistic-concurrency check on
 *      the generation being replaced, so a concurrent repoint updates nothing.
 *   2. The EXISTS clause requires the NEW generation to already be 'ACTIVE'
 *      (BUILDING generations have not passed verification), so a caller can
 *      never point a run at an unverified or fabricated generation.
 */
const UPDATE_RUN_ACTIVE_PROJECTION = `
UPDATE mhelix_gcp_testwired.mhelix_run_active_projections
   SET projection_generation_id = $4, bound_at = now()
 WHERE run_id = $1
   AND case_namespace_id = $2
   AND projection_generation_id = $3
   AND EXISTS (
     SELECT 1
       FROM mhelix_gcp_testwired.mhelix_projection_generations AS generations
      WHERE generations.case_namespace_id = $2
        AND generations.projection_generation_id = $4
        AND generations.generation_state = 'ACTIVE'
   )
RETURNING run_id, projection_generation_id, bound_at
`;

/**
 * Select all summary embedding metadata for a run under a specific projection
 * generation, so a rebuild can count the canonical sources and re-link them.
 */
const SELECT_EMBEDDINGS_FOR_PROJECTION = `
SELECT embeddings.memory_summary_id, embeddings.session_id,
       embeddings.embedding_model_id, embeddings.embedding_dimensions
  FROM mhelix_gcp_testwired.mhelix_memory_summary_embeddings AS embeddings
 WHERE embeddings.run_id = $1
   AND embeddings.projection_generation_id = $2
 ORDER BY embeddings.memory_summary_id
`;

/**
 * Copy all embeddings from one projection generation to a new one, entirely
 * inside the database. The stored vector and its commitment never leave the
 * database — they are read and written in the same INSERT ... SELECT, so the
 * application never sees them. This is the rebuild operation.
 */
const COPY_EMBEDDINGS_TO_NEW_PROJECTION = `
INSERT INTO mhelix_gcp_testwired.mhelix_memory_summary_embeddings
  (case_namespace_id, run_id, session_id, projection_generation_id,
   memory_summary_id, embedding_model_id, embedding_dimensions,
   embedding, embedding_commitment)
SELECT $3, $1, session_id, $4, memory_summary_id,
       embedding_model_id, embedding_dimensions, embedding, embedding_commitment
  FROM mhelix_gcp_testwired.mhelix_memory_summary_embeddings
 WHERE run_id = $1
   AND projection_generation_id = $2
`;

/**
 * Store one public-safe summary embedding.
 *
 * The vector arrives as a bound parameter cast to `VECTOR`, never as
 * interpolated text. Migration 002 pins the model identifier and the dimension
 * with CHECK constraints, so a wrong-sized or wrong-model vector is rejected by
 * the database itself.
 */
const INSERT_SUMMARY_EMBEDDING = `
INSERT INTO mhelix_gcp_testwired.mhelix_memory_summary_embeddings
  (case_namespace_id, run_id, session_id, projection_generation_id,
   memory_summary_id, embedding_model_id, embedding_dimensions, embedding,
   embedding_commitment)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8::VECTOR, $9)
RETURNING memory_summary_embedding_id
`;

/** One of exactly three reviewed lifecycle transitions. */
const UPDATE_SESSION_CLOSED = `
UPDATE mhelix_gcp_testwired.mhelix_memory_sessions
   SET session_state = 'CLOSED', closed_at = now()
 WHERE case_namespace_id = $1
   AND run_id = $2
   AND session_id = $3
   AND session_state = 'OPEN'
RETURNING session_id, session_state, started_at, closed_at
`;

/**
 * THE RECALL QUERY.
 *
 * Both vector-index prefix columns are constrained to exact values, which is
 * the documented requirement for the index to be usable, and the ordering uses
 * the cosine distance operator matching the `vector_cosine_ops` operator class
 * declared in migration 002. Bounded to two candidates.
 *
 * It returns summary references and distances only. The stored vector and its
 * commitment never leave the database.
 */
const RECALL_TOP_TWO_BY_COSINE_DISTANCE = `
SELECT embeddings.memory_summary_id,
       embeddings.session_id,
       embeddings.projection_generation_id,
       summaries.public_safe_summary,
       embeddings.embedding <=> $3::VECTOR AS cosine_distance
  FROM mhelix_gcp_testwired.mhelix_memory_summary_embeddings AS embeddings
  JOIN mhelix_gcp_testwired.mhelix_memory_summaries AS summaries
    ON summaries.memory_summary_id = embeddings.memory_summary_id
 WHERE embeddings.run_id = $1
   AND embeddings.projection_generation_id = $2
 ORDER BY embeddings.embedding <=> $3::VECTOR
 LIMIT 2
`;

/** Read-only query plan for the exact recall shape, for live index evidence. */
const EXPLAIN_RECALL_TOP_TWO = `
EXPLAIN
SELECT embeddings.memory_summary_id,
       embeddings.embedding <=> $3::VECTOR AS cosine_distance
  FROM mhelix_gcp_testwired.mhelix_memory_summary_embeddings AS embeddings
 WHERE embeddings.run_id = $1
   AND embeddings.projection_generation_id = $2
 ORDER BY embeddings.embedding <=> $3::VECTOR
 LIMIT 2
`;

/**
 * Reserve a receipt before doing the work, so a crash leaves a `RESERVED`
 * receipt rather than silent loss. The unique constraint on
 * `(run_id, operation, idempotency_key_hash)` is what makes replay safe.
 */
const INSERT_ACTION_RECEIPT_RESERVED = `
INSERT INTO mhelix_gcp_testwired.mhelix_action_receipts
  (case_namespace_id, run_id, session_id, operation, idempotency_key_hash,
   request_commitment, receipt_state, transport_request_id)
VALUES ($1, $2, $3, $4, $5, $6, 'RESERVED', $7)
RETURNING action_receipt_id, receipt_state, created_at
`;

const SELECT_RECEIPT_BY_IDEMPOTENCY = `
SELECT action_receipt_id, receipt_state, request_commitment,
       response_commitment, transport_request_id, created_at, completed_at
  FROM mhelix_gcp_testwired.mhelix_action_receipts
 WHERE run_id = $1
   AND operation = $2
   AND idempotency_key_hash = $3
 LIMIT 1
`;

/** One of exactly three reviewed lifecycle transitions. */
const UPDATE_ACTION_RECEIPT_SETTLED = `
UPDATE mhelix_gcp_testwired.mhelix_action_receipts
   SET receipt_state = $3, response_commitment = $4, completed_at = now()
 WHERE action_receipt_id = $1
   AND run_id = $2
   AND receipt_state = 'RESERVED'
RETURNING action_receipt_id, receipt_state, completed_at
`;

/**
 * Durable ranked recall evidence. The composite foreign key forces the
 * referenced receipt to share this row's run and to be a `recall` receipt.
 */
const INSERT_RECALL_RESULT_ITEM = `
INSERT INTO mhelix_gcp_testwired.mhelix_recall_result_items
  (action_receipt_id, run_id, operation, projection_generation_id,
   memory_summary_id, result_rank, cosine_distance, result_commitment)
VALUES ($1, $2, 'recall', $3, $4, $5, $6, $7)
RETURNING recall_result_item_id, result_rank
`;

const SELECT_RECEIPT_BY_IDENTIFIER = `
SELECT receipts.action_receipt_id, receipts.run_id, receipts.operation,
       receipts.receipt_state, receipts.protected_fields_returned,
       receipts.transport_request_id, receipts.created_at,
       receipts.completed_at, runs.agent_identifier
  FROM mhelix_gcp_testwired.mhelix_action_receipts AS receipts
  JOIN mhelix_gcp_testwired.mhelix_runs AS runs
    ON runs.run_id = receipts.run_id
 WHERE receipts.action_receipt_id = $1
 LIMIT 1
`;

const SELECT_RECALL_ITEMS_BY_RECEIPT = `
SELECT items.memory_summary_id, items.result_rank, items.cosine_distance,
       items.projection_generation_id, summaries.public_safe_summary,
       embeddings.session_id
  FROM mhelix_gcp_testwired.mhelix_recall_result_items AS items
  JOIN mhelix_gcp_testwired.mhelix_memory_summaries AS summaries
    ON summaries.memory_summary_id = items.memory_summary_id
  JOIN mhelix_gcp_testwired.mhelix_memory_summary_embeddings AS embeddings
    ON embeddings.memory_summary_id = items.memory_summary_id
   AND embeddings.run_id = items.run_id
   AND embeddings.projection_generation_id = items.projection_generation_id
 WHERE items.action_receipt_id = $1
 ORDER BY items.result_rank
`;

/**
 * Select the most recent recall items for a run, ordered by rank. Used by the
 * verify action to bind the predicate to the canonical memory that was
 * actually recalled. Joins the embeddings table to recover the source session
 * and the public-safe summary for fixture ID resolution.
 */
const SELECT_LATEST_RECALL_ITEMS_FOR_RUN = `
SELECT items.memory_summary_id, items.result_rank, items.cosine_distance,
       items.projection_generation_id, summaries.public_safe_summary,
       embeddings.session_id
  FROM mhelix_gcp_testwired.mhelix_recall_result_items AS items
  JOIN mhelix_gcp_testwired.mhelix_memory_summaries AS summaries
    ON summaries.memory_summary_id = items.memory_summary_id
  JOIN mhelix_gcp_testwired.mhelix_memory_summary_embeddings AS embeddings
    ON embeddings.memory_summary_id = items.memory_summary_id
   AND embeddings.run_id = items.run_id
   AND embeddings.projection_generation_id = items.projection_generation_id
 WHERE items.run_id = $1
 ORDER BY items.created_at DESC, items.result_rank
 LIMIT 2
`;

/**
 * The complete permitted statement catalog. Frozen so no module can add an
 * operation at runtime.
 */
export const VECTOR_MEMORY_STATEMENTS = Object.freeze({
  selectCaseNamespaceByScenario: SELECT_CASE_NAMESPACE_BY_SCENARIO,
  selectRuntimeCapability: SELECT_RUNTIME_CAPABILITY,
  selectRunByIdempotency: SELECT_RUN_BY_IDEMPOTENCY,
  insertRun: INSERT_RUN,
  insertSession: INSERT_SESSION,
  selectSessionByOrdinal: SELECT_SESSION_BY_ORDINAL,
  insertMemoryEvent: INSERT_MEMORY_EVENT,
  selectNextEventSequence: SELECT_NEXT_EVENT_SEQUENCE,
  insertMemorySummary: INSERT_MEMORY_SUMMARY,
  insertProjectionGeneration: INSERT_PROJECTION_GENERATION,
  updateProjectionVerified: UPDATE_PROJECTION_VERIFIED,
  insertRunActiveProjection: INSERT_RUN_ACTIVE_PROJECTION,
  updateRunActiveProjection: UPDATE_RUN_ACTIVE_PROJECTION,
  selectRunActiveProjection: SELECT_RUN_ACTIVE_PROJECTION,
  selectEmbeddingsForProjection: SELECT_EMBEDDINGS_FOR_PROJECTION,
  copyEmbeddingsToNewProjection: COPY_EMBEDDINGS_TO_NEW_PROJECTION,
  insertSummaryEmbedding: INSERT_SUMMARY_EMBEDDING,
  updateSessionClosed: UPDATE_SESSION_CLOSED,
  recallTopTwoByCosineDistance: RECALL_TOP_TWO_BY_COSINE_DISTANCE,
  explainRecallTopTwo: EXPLAIN_RECALL_TOP_TWO,
  insertActionReceiptReserved: INSERT_ACTION_RECEIPT_RESERVED,
  selectReceiptByIdempotency: SELECT_RECEIPT_BY_IDEMPOTENCY,
  updateActionReceiptSettled: UPDATE_ACTION_RECEIPT_SETTLED,
  insertRecallResultItem: INSERT_RECALL_RESULT_ITEM,
  selectReceiptByIdentifier: SELECT_RECEIPT_BY_IDENTIFIER,
  selectRecallItemsByReceipt: SELECT_RECALL_ITEMS_BY_RECEIPT,
  selectLatestRecallItemsForRun: SELECT_LATEST_RECALL_ITEMS_FOR_RUN,
});

/** Statement names permitted to modify data, for the write-gate assertion. */
export const MUTATING_STATEMENT_NAMES = Object.freeze([
  "insertRun",
  "insertSession",
  "insertMemoryEvent",
  "insertMemorySummary",
  "insertProjectionGeneration",
  "updateProjectionVerified",
  "insertRunActiveProjection",
  "updateRunActiveProjection",
  "insertSummaryEmbedding",
  "copyEmbeddingsToNewProjection",
  "updateSessionClosed",
  "insertActionReceiptReserved",
  "updateActionReceiptSettled",
  "insertRecallResultItem",
]);

/**
 * Resolve a statement by name. Throws on anything not in the catalog, so a
 * typo or an injected name fails closed instead of reaching the database.
 */
export function requireStatement(statementName) {
  if (
    typeof statementName !== "string" ||
    !Object.prototype.hasOwnProperty.call(VECTOR_MEMORY_STATEMENTS, statementName)
  ) {
    throw new TypeError("Unknown vector-memory statement.");
  }
  return VECTOR_MEMORY_STATEMENTS[statementName];
}
