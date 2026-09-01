-- SPDX-License-Identifier: Apache-2.0
-- Adapted from MidnightHelixCTW/database/activation/activate_vector_memory_capability.sql
-- (same author, Apache-2.0) for a guarded GCP release rotation.
-- Stage B maintenance source: atomically replace one obsolete release-bound
-- vector-memory capability after a reviewed service fix.
--
-- THIS FILE IS DESTRUCTIVE: it deletes exactly one obsolete capability row.
-- It must never run as part of migration/bootstrap. The operator wrapper
-- requires explicit invocation after human approval, executes both statements
-- in one transaction, and rolls back unless DELETE and INSERT each affect one
-- row. $1 is the exact old release; $2 is the exact new release.
--
-- This rotation is required because keeping both rows would allow the stale
-- deployment to continue passing its release-bound capability check. No judge
-- run, memory, projection, receipt, or user data references this marker row.

DELETE FROM mhelix_gcp_testwired.mhelix_runtime_capabilities
 WHERE capability_id = 'vector_memory_recall'
   AND release_commit = $1
   AND marker_id = 'helixctw-gcp-testwired-environment'
   AND capability_state = 'SOURCE_ONLY'
   AND capability_version = 1
   AND public_mutations_enabled = false
   AND octet_length(evidence_commitment) = 32
   AND (SELECT count(*)
          FROM mhelix_gcp_testwired.mhelix_runtime_capabilities
         WHERE capability_id = 'vector_memory_recall') = 1;

INSERT INTO mhelix_gcp_testwired.mhelix_runtime_capabilities
  (capability_id, marker_id, release_commit, capability_state,
   capability_version, public_mutations_enabled, evidence_commitment)
SELECT 'vector_memory_recall',
       canonical_marker.marker_id,
       $2,
       'SOURCE_ONLY',
       1,
       false,
       digest(
         concat_ws(
           e'\n',
           'domain=mhelixctw-vector-memory-capability-v1',
           'marker_id=' || canonical_marker.marker_id,
           'release_commit=' || $2,
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
 WHERE $2 ~ '^[0-9a-f]{40}$'
   AND $2 <> $1
   AND canonical_marker.marker_id = 'helixctw-gcp-testwired-environment'
   AND canonical_marker.build_stage = 'TESTWIRED'
   AND applied_migration.migration_id = '002_testwired_vector_memory'
   AND applied_migration.source_file_name =
         'database/memory/002_testwired_vector_memory.sql'
   AND applied_migration.source_checksum =
         'bcf172c976e7a0d86e8123e6253ae9afce52415f683f23d566b3bad6a7647b3d'
   AND applied_migration.statement_count = 7
   AND (SELECT count(*)
          FROM mhelix_gcp_testwired.mhelix_runtime_capabilities
         WHERE capability_id = 'vector_memory_recall') = 0;
