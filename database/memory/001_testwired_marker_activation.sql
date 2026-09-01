-- SPDX-License-Identifier: Apache-2.0
-- Adapted from MidnightHelixCTW/database/activation/001_testwired_marker_activation.sql
-- (same author, Apache-2.0) for the HelixCTW GCP Stage B database.
-- SOURCE_ONLY; committing this file is not evidence that it was executed.
-- Apply only as mhelix_gcp_migrator while connected to DATABASE
-- mhelix_gcp_testwired, after migration 001 has been independently verified.
-- Plain INSERT and one transaction deliberately fail closed on any conflict.
-- The marker commitment is derived in CockroachDB from the canonical GCP marker
-- manifest in service/src/environment-marker.js; it is not operator supplied.

BEGIN;

INSERT INTO mhelix_gcp_testwired.mhelix_schema_migrations
  (migration_id, source_file_name, source_checksum, statement_count)
VALUES
  ('001_testwired_memory_core',
   'database/memory/001_testwired_memory_core.sql',
   '0b676f78935894b91ce3471156c07e05d3477ed93fb7cc6bf0fe35d20e341aa2',
   16);

INSERT INTO mhelix_gcp_testwired.mhelix_environment_markers
  (marker_id, build_stage, marker_commitment, marker_version)
VALUES
  ('helixctw-gcp-testwired-environment',
   'TESTWIRED',
   digest(
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
   ),
   1);

COMMIT;
