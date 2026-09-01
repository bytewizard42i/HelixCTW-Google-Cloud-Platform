-- SPDX-License-Identifier: Apache-2.0
-- Adapted from MidnightHelixCTW/database/migrations/002_testwired_vector_memory.sql
-- (same author, Apache-2.0) for the HelixCTW GCP Stage B database.
--
-- SOURCE_ONLY: no statement here is evidence of live CockroachDB execution.
-- Connect only to DATABASE mhelix_gcp_testwired before applying it. Every object
-- is qualified to SCHEMA mhelix_gcp_testwired.
-- ADDITIVE AND NON-DESTRUCTIVE: no user, privilege, secret, fixture row, DROP,
-- TRUNCATE, DELETE, UPDATE, existing-column rewrite, or cluster setting change.
-- If feature.vector_index.enabled is false, vector-table creation must fail
-- closed rather than silently creating an unindexed table.
--
-- Privacy boundary: the embedding table contains references to already-public-
-- safe summaries, VECTOR(8), a fixed model identifier, a commitment, and audit
-- fields. It deliberately has no raw content or protected-data text column.

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_runtime_capabilities (
  capability_id STRING NOT NULL,
  marker_id STRING NOT NULL
    REFERENCES mhelix_gcp_testwired.mhelix_environment_markers (marker_id),
  release_commit STRING NOT NULL,
  capability_state STRING NOT NULL,
  capability_version INT8 NOT NULL,
  public_mutations_enabled BOOL NOT NULL DEFAULT false,
  evidence_commitment BYTES NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (capability_id, release_commit),
  UNIQUE (marker_id, capability_id, release_commit),
  CHECK (capability_id IN ('vector_memory_recall')),
  CHECK (capability_state IN ('SOURCE_ONLY', 'VERIFIED_LOCAL', 'LIVE_TESTWIRED')),
  CHECK (capability_version = 1),
  CHECK (NOT public_mutations_enabled),
  CHECK (release_commit ~ '^[0-9a-f]{40}$'),
  CHECK (octet_length(evidence_commitment) = 32)
);

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_run_active_projections (
  run_id UUID NOT NULL PRIMARY KEY,
  case_namespace_id UUID NOT NULL,
  projection_generation_id UUID NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_namespace_id, run_id, projection_generation_id),
  UNIQUE (run_id, projection_generation_id),
  FOREIGN KEY (case_namespace_id, run_id)
    REFERENCES mhelix_gcp_testwired.mhelix_runs (case_namespace_id, run_id),
  FOREIGN KEY (case_namespace_id, projection_generation_id)
    REFERENCES mhelix_gcp_testwired.mhelix_projection_generations
      (case_namespace_id, projection_generation_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mhelix_memory_summaries_session_summary
  ON mhelix_gcp_testwired.mhelix_memory_summaries
    (session_id, memory_summary_id);

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_memory_summary_embeddings (
  memory_summary_embedding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_namespace_id UUID NOT NULL,
  run_id UUID NOT NULL,
  session_id UUID NOT NULL,
  projection_generation_id UUID NOT NULL,
  memory_summary_id UUID NOT NULL,
  embedding_model_id STRING NOT NULL,
  embedding_dimensions INT8 NOT NULL,
  embedding VECTOR(8) NOT NULL,
  embedding_commitment BYTES NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, projection_generation_id, memory_summary_id),
  UNIQUE (projection_generation_id, memory_summary_id),
  FOREIGN KEY (case_namespace_id, run_id)
    REFERENCES mhelix_gcp_testwired.mhelix_runs (case_namespace_id, run_id),
  FOREIGN KEY (case_namespace_id, run_id, session_id)
    REFERENCES mhelix_gcp_testwired.mhelix_memory_sessions
      (case_namespace_id, run_id, session_id),
  FOREIGN KEY (session_id, memory_summary_id)
    REFERENCES mhelix_gcp_testwired.mhelix_memory_summaries
      (session_id, memory_summary_id),
  FOREIGN KEY (case_namespace_id, projection_generation_id)
    REFERENCES mhelix_gcp_testwired.mhelix_projection_generations
      (case_namespace_id, projection_generation_id),
  CHECK (embedding_model_id = 'mhelixctw-synthetic-embedding-v1'),
  CHECK (embedding_dimensions = 8),
  CHECK (octet_length(embedding_commitment) = 32),
  VECTOR INDEX vec_mhelix_summary_embeddings_run_projection (
    run_id,
    projection_generation_id,
    embedding vector_cosine_ops
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mhelix_action_receipts_run_receipt_operation
  ON mhelix_gcp_testwired.mhelix_action_receipts
    (run_id, action_receipt_id, operation);

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_recall_result_items (
  recall_result_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_receipt_id UUID NOT NULL,
  run_id UUID NOT NULL,
  operation STRING NOT NULL,
  projection_generation_id UUID NOT NULL,
  memory_summary_id UUID NOT NULL,
  result_rank INT8 NOT NULL,
  cosine_distance FLOAT8 NOT NULL,
  result_commitment BYTES NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (action_receipt_id, result_rank),
  UNIQUE (action_receipt_id, memory_summary_id),
  FOREIGN KEY (run_id, action_receipt_id, operation)
    REFERENCES mhelix_gcp_testwired.mhelix_action_receipts
      (run_id, action_receipt_id, operation),
  FOREIGN KEY (run_id, projection_generation_id, memory_summary_id)
    REFERENCES mhelix_gcp_testwired.mhelix_memory_summary_embeddings
      (run_id, projection_generation_id, memory_summary_id),
  CHECK (operation = 'recall'),
  CHECK (result_rank >= 1),
  CHECK (result_rank <= 2),
  CHECK (cosine_distance >= 0.0),
  CHECK (cosine_distance <= 2.0),
  CHECK (octet_length(result_commitment) = 32)
);

ALTER TABLE mhelix_gcp_testwired.mhelix_action_receipts
  ADD COLUMN IF NOT EXISTS transport_request_id STRING
    CHECK (
      transport_request_id IS NULL
      OR transport_request_id ~ '^[A-Za-z0-9._:-]{1,128}$'
    );
