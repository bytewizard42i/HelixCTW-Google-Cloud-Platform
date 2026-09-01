-- SPDX-License-Identifier: Apache-2.0
-- Adapted from MidnightHelixCTW/database/activation/verify_vector_memory_capability.sql
-- (same author, Apache-2.0) for the HelixCTW GCP Stage B database.
-- SOURCE_ONLY and NOT EXECUTED. This read-only verifier takes exactly $1, the
-- expected release commit. It proves internal database consistency only, not
-- deployment equality, authenticity, public behavior, or live execution.

SELECT (
         SELECT count(*)
           FROM mhelix_gcp_testwired.mhelix_runtime_capabilities
          WHERE release_commit = $1
            AND capability_id = 'vector_memory_recall'
            AND marker_id = 'helixctw-gcp-testwired-environment'
            AND capability_version = 1
            AND capability_state = 'SOURCE_ONLY'
            AND public_mutations_enabled = false
            AND octet_length(evidence_commitment) = 32
            AND recorded_at IS NOT NULL
       ) = 1 AS exactly_one_expected_capability_row,
       (
         SELECT count(*)
           FROM mhelix_gcp_testwired.mhelix_runtime_capabilities
          WHERE capability_id = 'vector_memory_recall'
            AND release_commit <> $1
       ) = 0 AS no_other_release_claims_this_capability,
       (
         SELECT count(*)
           FROM mhelix_gcp_testwired.mhelix_runtime_capabilities AS installed
           JOIN mhelix_gcp_testwired.mhelix_environment_markers AS canonical_marker
             ON canonical_marker.marker_id = installed.marker_id
           JOIN mhelix_gcp_testwired.mhelix_schema_migrations AS applied_migration
             ON applied_migration.migration_id = '002_testwired_vector_memory'
          WHERE installed.release_commit = $1
            AND installed.capability_id = 'vector_memory_recall'
            AND canonical_marker.marker_id =
                  'helixctw-gcp-testwired-environment'
            AND installed.evidence_commitment = digest(
                  concat_ws(
                    e'\n',
                    'domain=mhelixctw-vector-memory-capability-v1',
                    'marker_id=' || canonical_marker.marker_id,
                    'release_commit=' || $1,
                    'migration_id=002_testwired_vector_memory',
                    'migration_checksum=' || applied_migration.source_checksum,
                    'vector_dimension=8',
                    'distance_metric=cosine',
                    'embedding_model=mhelixctw-synthetic-embedding-v1'
                  ),
                  'sha256'
                )
       ) = 1 AS stored_commitment_matches_recomputed_commitment,
       (
         SELECT count(*)
           FROM mhelix_gcp_testwired.mhelix_schema_migrations
          WHERE migration_id = '002_testwired_vector_memory'
            AND source_file_name =
                  'database/memory/002_testwired_vector_memory.sql'
            AND source_checksum =
                  'bcf172c976e7a0d86e8123e6253ae9afce52415f683f23d566b3bad6a7647b3d'
            AND statement_count = 7
       ) = 1 AS migration_ledger_still_matches_reviewed_source,
       (
         SELECT count(*) FROM (SELECT 1) AS one_row
          WHERE $1 ~ '^[0-9a-f]{40}$'
       ) = 1 AS supplied_release_commit_is_well_formed;
