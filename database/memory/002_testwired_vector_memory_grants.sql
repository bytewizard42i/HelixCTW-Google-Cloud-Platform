-- SPDX-License-Identifier: Apache-2.0
-- Adapted from MidnightHelixCTW/database/activation/002_testwired_vector_memory_grants.sql
-- (same author, Apache-2.0) for the HelixCTW GCP Stage B database and the
-- destination's frozen service/src/vector-memory-statements.js catalog.
-- SOURCE_ONLY; no statement here is evidence of live execution.
--
-- CockroachDB GRANT may auto-commit, so this packet deliberately has no
-- transaction. It is resumable/idempotent, and only the separate exact readback
-- establishes completion. There are no wildcard, grantable, ownership,
-- migration-ledger, destructive, cluster-setting, or future-table privileges.

GRANT CONNECT ON DATABASE mhelix_gcp_testwired TO mhelix_gcp_runtime;
GRANT USAGE ON SCHEMA mhelix_gcp_testwired TO mhelix_gcp_runtime;

GRANT SELECT ON TABLE mhelix_gcp_testwired.mhelix_environment_markers
  TO mhelix_gcp_runtime;
GRANT SELECT ON TABLE mhelix_gcp_testwired.mhelix_runtime_capabilities
  TO mhelix_gcp_runtime;
GRANT SELECT ON TABLE mhelix_gcp_testwired.mhelix_case_namespaces
  TO mhelix_gcp_runtime;
GRANT SELECT, INSERT ON TABLE mhelix_gcp_testwired.mhelix_runs
  TO mhelix_gcp_runtime;
GRANT SELECT, INSERT, UPDATE
  ON TABLE mhelix_gcp_testwired.mhelix_memory_sessions
  TO mhelix_gcp_runtime;
GRANT SELECT, INSERT ON TABLE mhelix_gcp_testwired.mhelix_memory_events
  TO mhelix_gcp_runtime;
GRANT SELECT, INSERT ON TABLE mhelix_gcp_testwired.mhelix_memory_summaries
  TO mhelix_gcp_runtime;
GRANT SELECT, INSERT
  ON TABLE mhelix_gcp_testwired.mhelix_memory_summary_embeddings
  TO mhelix_gcp_runtime;
GRANT SELECT, INSERT, UPDATE
  ON TABLE mhelix_gcp_testwired.mhelix_projection_generations
  TO mhelix_gcp_runtime;
GRANT SELECT, INSERT, UPDATE
  ON TABLE mhelix_gcp_testwired.mhelix_run_active_projections
  TO mhelix_gcp_runtime;
GRANT SELECT, INSERT, UPDATE
  ON TABLE mhelix_gcp_testwired.mhelix_action_receipts
  TO mhelix_gcp_runtime;
GRANT SELECT, INSERT ON TABLE mhelix_gcp_testwired.mhelix_recall_result_items
  TO mhelix_gcp_runtime;
