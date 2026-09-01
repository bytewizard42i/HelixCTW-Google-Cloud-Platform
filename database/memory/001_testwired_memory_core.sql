-- SPDX-License-Identifier: Apache-2.0
-- Adapted from MidnightHelixCTW/database/migrations/001_testwired_memory_core.sql
-- (same author, Apache-2.0) for the HelixCTW GCP Stage B database.
--
-- SOURCE_ONLY: this file is committed source, not evidence of live execution.
-- Connect only to DATABASE mhelix_gcp_testwired before applying it. Every object
-- is qualified to the equally named SCHEMA mhelix_gcp_testwired.
-- ADDITIVE AND NON-DESTRUCTIVE: no user, privilege, secret, connection, fixture
-- row, destructive statement, or existing-column rewrite is performed here.

CREATE SCHEMA IF NOT EXISTS mhelix_gcp_testwired;

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_schema_migrations (
  migration_id STRING PRIMARY KEY,
  source_file_name STRING NOT NULL,
  source_checksum STRING NOT NULL,
  statement_count INT8 NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (statement_count > 0),
  CHECK (length(source_checksum) = 64)
);

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_environment_markers (
  marker_id STRING PRIMARY KEY,
  build_stage STRING NOT NULL,
  marker_commitment BYTES NOT NULL,
  marker_version INT8 NOT NULL,
  evidence_receipt_id UUID NOT NULL DEFAULT gen_random_uuid(),
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (evidence_receipt_id),
  CHECK (build_stage = 'TESTWIRED'),
  CHECK (marker_version = 1),
  CHECK (octet_length(marker_commitment) = 32)
);

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_case_namespaces (
  case_namespace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marker_id STRING NOT NULL
    REFERENCES mhelix_gcp_testwired.mhelix_environment_markers (marker_id),
  scenario_id STRING NOT NULL,
  fixture_commitment BYTES NOT NULL,
  synthetic BOOL NOT NULL,
  release_commit STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (marker_id, scenario_id, release_commit),
  CHECK (synthetic),
  CHECK (octet_length(fixture_commitment) = 32),
  CHECK (release_commit ~ '^[0-9a-f]{40}$')
);

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_namespace_id UUID NOT NULL
    REFERENCES mhelix_gcp_testwired.mhelix_case_namespaces (case_namespace_id),
  agent_identifier STRING NOT NULL,
  create_idempotency_key_hash BYTES NOT NULL,
  run_state STRING NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  UNIQUE (case_namespace_id, run_id),
  UNIQUE (case_namespace_id, create_idempotency_key_hash),
  CHECK (octet_length(create_idempotency_key_hash) = 32),
  CHECK (run_state IN ('OPEN', 'CLOSED')),
  CHECK (
    (run_state = 'OPEN' AND closed_at IS NULL)
    OR (run_state = 'CLOSED' AND closed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mhelix_runs_case
  ON mhelix_gcp_testwired.mhelix_runs (case_namespace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_memory_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_namespace_id UUID NOT NULL,
  run_id UUID NOT NULL,
  session_ordinal STRING NOT NULL,
  actor_identifier STRING NOT NULL,
  resource_identifier STRING NOT NULL,
  authority_grant_identifier STRING NOT NULL,
  session_state STRING NOT NULL DEFAULT 'OPEN',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  UNIQUE (run_id, session_ordinal),
  UNIQUE (case_namespace_id, run_id, session_id),
  FOREIGN KEY (case_namespace_id, run_id)
    REFERENCES mhelix_gcp_testwired.mhelix_runs (case_namespace_id, run_id),
  CHECK (session_ordinal IN ('A', 'B')),
  CHECK (session_state IN ('OPEN', 'CLOSED')),
  CHECK (
    (session_state = 'OPEN' AND closed_at IS NULL)
    OR (session_state = 'CLOSED' AND closed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mhelix_memory_sessions_run
  ON mhelix_gcp_testwired.mhelix_memory_sessions (run_id, started_at DESC);

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_memory_events (
  memory_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL
    REFERENCES mhelix_gcp_testwired.mhelix_memory_sessions (session_id),
  event_sequence INT8 NOT NULL,
  event_type STRING NOT NULL,
  public_safe_summary STRING NOT NULL,
  summary_commitment BYTES NOT NULL,
  evidence_commitment BYTES NOT NULL,
  protected_fields_returned INT8 NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, event_sequence),
  CHECK (event_sequence > 0),
  CHECK (event_type IN (
    'SESSION_OPENED',
    'SESSION_CLOSED',
    'MEMORY_RECALLED',
    'PREDICATE_VERIFIED',
    'DISCLOSURE_DENIED',
    'PROJECTION_REBUILT'
  )),
  CHECK (octet_length(summary_commitment) = 32),
  CHECK (octet_length(evidence_commitment) = 32),
  CHECK (protected_fields_returned = 0)
);

CREATE INDEX IF NOT EXISTS idx_mhelix_memory_events_session
  ON mhelix_gcp_testwired.mhelix_memory_events (session_id, event_sequence);

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_memory_summaries (
  memory_summary_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL
    REFERENCES mhelix_gcp_testwired.mhelix_memory_sessions (session_id),
  through_event_sequence INT8 NOT NULL,
  public_safe_summary STRING NOT NULL,
  summary_commitment BYTES NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, through_event_sequence),
  FOREIGN KEY (session_id, through_event_sequence)
    REFERENCES mhelix_gcp_testwired.mhelix_memory_events
      (session_id, event_sequence),
  CHECK (through_event_sequence > 0),
  CHECK (octet_length(summary_commitment) = 32)
);

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_projection_generations (
  projection_generation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_namespace_id UUID NOT NULL
    REFERENCES mhelix_gcp_testwired.mhelix_case_namespaces (case_namespace_id),
  generation_state STRING NOT NULL,
  canonical_source_count INT8 NOT NULL,
  evidence_commitment BYTES NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  UNIQUE (case_namespace_id, projection_generation_id),
  CHECK (generation_state IN ('BUILDING', 'VERIFIED', 'ACTIVE', 'RETIRED')),
  CHECK (canonical_source_count >= 0),
  CHECK (octet_length(evidence_commitment) = 32),
  CHECK (
    (generation_state = 'BUILDING' AND verified_at IS NULL)
    OR (generation_state <> 'BUILDING' AND verified_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mhelix_projection_generations_case
  ON mhelix_gcp_testwired.mhelix_projection_generations
    (case_namespace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_active_projections (
  case_namespace_id UUID PRIMARY KEY
    REFERENCES mhelix_gcp_testwired.mhelix_case_namespaces (case_namespace_id),
  projection_generation_id UUID NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (case_namespace_id, projection_generation_id)
    REFERENCES mhelix_gcp_testwired.mhelix_projection_generations
      (case_namespace_id, projection_generation_id)
);

CREATE TABLE IF NOT EXISTS mhelix_gcp_testwired.mhelix_action_receipts (
  action_receipt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_namespace_id UUID NOT NULL,
  run_id UUID NOT NULL,
  session_id UUID NOT NULL,
  operation STRING NOT NULL,
  idempotency_key_hash BYTES NOT NULL,
  request_commitment BYTES NOT NULL,
  response_commitment BYTES,
  receipt_state STRING NOT NULL,
  protected_fields_returned INT8 NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (run_id, operation, idempotency_key_hash),
  FOREIGN KEY (case_namespace_id, run_id)
    REFERENCES mhelix_gcp_testwired.mhelix_runs (case_namespace_id, run_id),
  FOREIGN KEY (case_namespace_id, run_id, session_id)
    REFERENCES mhelix_gcp_testwired.mhelix_memory_sessions
      (case_namespace_id, run_id, session_id),
  CHECK (operation IN (
    'create_run',
    'close_session',
    'recall',
    'verify_unencumbered',
    'attempt_protected_disclosure',
    'rebuild_recall_projection'
  )),
  CHECK (octet_length(idempotency_key_hash) = 32),
  CHECK (octet_length(request_commitment) = 32),
  CHECK (response_commitment IS NULL OR octet_length(response_commitment) = 32),
  CHECK (receipt_state IN ('RESERVED', 'COMMITTED', 'DENIED', 'FAILED')),
  CHECK (protected_fields_returned = 0),
  CHECK (
    (receipt_state = 'RESERVED' AND completed_at IS NULL)
    OR (receipt_state <> 'RESERVED' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mhelix_action_receipts_run
  ON mhelix_gcp_testwired.mhelix_action_receipts (run_id, created_at DESC);
