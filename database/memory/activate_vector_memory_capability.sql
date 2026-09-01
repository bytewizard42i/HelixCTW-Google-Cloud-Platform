-- SPDX-License-Identifier: Apache-2.0
-- Adapted from MidnightHelixCTW/database/activation/activate_vector_memory_capability.sql
-- (same author, Apache-2.0) for the HelixCTW GCP Stage B database.
-- SOURCE_ONLY and NOT EXECUTED. Execute as one parameterized statement with
-- exactly one bound value: $1, the expected 40-character lowercase release
-- commit. The database derives the commitment; zero inserted rows is failure.
-- Plain INSERT only: no UPSERT or conflict suppression.

INSERT INTO mhelix_gcp_testwired.mhelix_runtime_capabilities
  (capability_id, marker_id, release_commit, capability_state,
   capability_version, public_mutations_enabled, evidence_commitment)
SELECT 'vector_memory_recall',
       canonical_marker.marker_id,
       $1,
       'SOURCE_ONLY',
       1,
       false,
       digest(
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
  FROM mhelix_gcp_testwired.mhelix_environment_markers AS canonical_marker,
       mhelix_gcp_testwired.mhelix_schema_migrations AS applied_migration
 WHERE $1 ~ '^[0-9a-f]{40}$'
   AND canonical_marker.marker_id = 'helixctw-gcp-testwired-environment'
   AND canonical_marker.build_stage = 'TESTWIRED'
   AND applied_migration.migration_id = '002_testwired_vector_memory'
   AND applied_migration.source_file_name =
         'database/memory/002_testwired_vector_memory.sql'
   AND applied_migration.source_checksum =
         'bcf172c976e7a0d86e8123e6253ae9afce52415f683f23d566b3bad6a7647b3d'
   AND applied_migration.statement_count = 7
   AND applied_migration.applied_at IS NOT NULL
   AND (SELECT count(*)
          FROM mhelix_gcp_testwired.mhelix_environment_markers) = 1
   AND (SELECT count(*)
          FROM mhelix_gcp_testwired.mhelix_schema_migrations
         WHERE migration_id = '002_testwired_vector_memory') = 1
   AND (SELECT count(*)
          FROM mhelix_gcp_testwired.mhelix_runtime_capabilities
         WHERE capability_id = 'vector_memory_recall') = 0;
