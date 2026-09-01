-- SPDX-License-Identifier: Apache-2.0
-- Adapted from MidnightHelixCTW/database/activation/verify_marker_activation.sql
-- (same author, Apache-2.0) for the HelixCTW GCP Stage B database.
-- SOURCE_ONLY readback: it returns booleans only and proves no live execution.
-- Missing, duplicate, stale, or malformed rows produce false.

SELECT (
         SELECT count(*)
           FROM mhelix_gcp_testwired.mhelix_environment_markers
          WHERE marker_id = 'helixctw-gcp-testwired-environment'
            AND build_stage = 'TESTWIRED'
            AND marker_version = 1
            AND marker_commitment = digest(
                  concat_ws(
                    e'\n',
                    'helixctw-gcp/environment-marker/v1',
                    'marker_id=helixctw-gcp-testwired-environment',
                    'build_stage=TESTWIRED',
                    'marker_version=1',
                    'migration_id=001_gcp_environment_marker',
                    'source_file_name=database/migrations/001_gcp_environment_marker.sql',
                    'migration_sha256=23003de5b457cbd6c41a65a851acbb48950d10357475dcf679f8feb40dfb898f',
                    'statement_count=2'
                  ),
                  'sha256'
                )
            AND octet_length(marker_commitment) = 32
            AND evidence_receipt_id IS NOT NULL
            AND installed_at IS NOT NULL
       ) = 1 AS marker_row_is_exact,
       (
         SELECT count(*)
           FROM mhelix_gcp_testwired.mhelix_environment_markers
       ) = 1 AS marker_is_unambiguous;

SELECT (
         SELECT count(*)
           FROM mhelix_gcp_testwired.mhelix_schema_migrations
          WHERE migration_id = '001_testwired_memory_core'
            AND source_file_name =
                  'database/memory/001_testwired_memory_core.sql'
            AND source_checksum =
                  '0b676f78935894b91ce3471156c07e05d3477ed93fb7cc6bf0fe35d20e341aa2'
            AND statement_count = 16
            AND applied_at IS NOT NULL
       ) = 1 AS migration_001_ledger_row_is_exact;
