-- 001_gcp_environment_marker.sql
-- HelixCTW GCP edition — TestWired environment marker table.
-- Target: didz-testwired cluster, database helix_testtown.
-- (The helixchain-hackathon cluster is FROZEN for judging; never target it.)
--
-- This migration only creates structure. The canonical marker row is inserted
-- by scripts/apply-marker.mjs, which derives the marker commitment from the
-- manifest in service/src/environment-marker.js at apply time. Keeping the
-- commitment out of this file avoids a circular hash (the commitment includes
-- this file's SHA-256).
--
-- Statement count: 2 (the manifest's statement_count must match).

CREATE SCHEMA IF NOT EXISTS helixctw_gcp;

CREATE TABLE IF NOT EXISTS helixctw_gcp.environment_markers (
  marker_id           STRING      NOT NULL PRIMARY KEY,
  build_stage         STRING      NOT NULL,
  marker_version      INT8        NOT NULL,
  marker_commitment   BYTES       NOT NULL CHECK (octet_length(marker_commitment) = 32),
  evidence_receipt_id UUID        NOT NULL DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
