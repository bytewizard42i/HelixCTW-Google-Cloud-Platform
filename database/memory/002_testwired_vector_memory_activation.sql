-- SPDX-License-Identifier: Apache-2.0
-- Adapted from MidnightHelixCTW/database/activation/002_testwired_vector_memory_activation.sql
-- (same author, Apache-2.0) for the HelixCTW GCP Stage B database.
-- SOURCE_ONLY; committing this file is not evidence that it was executed.
-- Apply only as mhelix_gcp_migrator in DATABASE mhelix_gcp_testwired after
-- migration 002 and its schema verification succeed.
-- Plain INSERT and one transaction deliberately fail closed on conflict.

BEGIN;

INSERT INTO mhelix_gcp_testwired.mhelix_schema_migrations
  (migration_id, source_file_name, source_checksum, statement_count)
VALUES
  ('002_testwired_vector_memory',
   'database/memory/002_testwired_vector_memory.sql',
   'bcf172c976e7a0d86e8123e6253ae9afce52415f683f23d566b3bad6a7647b3d',
   7);

COMMIT;
