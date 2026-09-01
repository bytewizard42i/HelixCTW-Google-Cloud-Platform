-- SPDX-License-Identifier: Apache-2.0
-- Adapted from MidnightHelixCTW/database/activation/verify_vector_memory_activation.sql
-- (same author, Apache-2.0) for the HelixCTW GCP Stage B database.
-- SOURCE_ONLY and NOT EXECUTED. These read-only queries return booleans only.
-- Run after migrations, ledger activation, and grants, but before capability
-- activation. Missing, duplicate, stale, inherited, or extra state fails closed.
-- There is deliberately no vacuous coalesce-to-true behavior.

-- Dedicated database and exact migration ledger provenance.
SELECT current_database() = 'mhelix_gcp_testwired'
         AS connected_to_dedicated_database,
       (
         SELECT count(*)
           FROM mhelix_gcp_testwired.mhelix_schema_migrations
          WHERE migration_id = '002_testwired_vector_memory'
            AND source_file_name =
                  'database/memory/002_testwired_vector_memory.sql'
            AND source_checksum =
                  'bcf172c976e7a0d86e8123e6253ae9afce52415f683f23d566b3bad6a7647b3d'
            AND statement_count = 7
            AND applied_at IS NOT NULL
       ) = 1 AS ledger_row_is_exact;

-- Required tables exist only as exact named objects in the dedicated schema.
SELECT (
         SELECT count(*) FROM information_schema.tables
          WHERE table_schema = 'mhelix_gcp_testwired'
            AND table_name IN (
              'mhelix_runtime_capabilities',
              'mhelix_run_active_projections',
              'mhelix_memory_summary_embeddings',
              'mhelix_recall_result_items'
            )
       ) = 4 AS four_new_tables_present,
       (
         SELECT count(*) FROM information_schema.tables
          WHERE table_schema = 'mhelix_gcp_testwired'
            AND table_name IN (
              'mhelix_environment_markers',
              'mhelix_case_namespaces',
              'mhelix_runs',
              'mhelix_memory_sessions',
              'mhelix_memory_summaries',
              'mhelix_projection_generations',
              'mhelix_action_receipts'
            )
       ) = 7 AS depended_on_tables_present;

-- Exact vector shape and privacy-safe column surface.
SELECT (
         SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'mhelix_gcp_testwired'
            AND table_name = 'mhelix_memory_summary_embeddings'
            AND column_name = 'embedding'
            AND crdb_sql_type = 'VECTOR(8)'
            AND is_nullable = 'NO'
       ) = 1 AS embedding_is_exactly_vector_8,
       (
         SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'mhelix_gcp_testwired'
            AND table_name = 'mhelix_memory_summary_embeddings'
            AND column_name = 'embedding_commitment'
            AND crdb_sql_type = 'BYTES'
            AND is_nullable = 'NO'
       ) = 1 AS embedding_commitment_is_bytes,
       (
         SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'mhelix_gcp_testwired'
            AND table_name = 'mhelix_memory_summary_embeddings'
            AND crdb_sql_type LIKE 'STRING%'
            AND column_name <> 'embedding_model_id'
       ) = 0 AS vector_table_has_no_free_text_column;

-- Exact index order/operator class and additive unique indexes.
SELECT (
         SELECT count(*) FROM information_schema.statistics
          WHERE table_schema = 'mhelix_gcp_testwired'
            AND table_name = 'mhelix_memory_summary_embeddings'
            AND index_name = 'vec_mhelix_summary_embeddings_run_projection'
            AND (
              (seq_in_index = 1 AND column_name = 'run_id') OR
              (seq_in_index = 2 AND column_name = 'projection_generation_id') OR
              (seq_in_index = 3 AND column_name = 'embedding')
            )
       ) = 3 AS vector_index_prefix_columns_in_order,
       (
         SELECT count(*)
           FROM [SHOW CREATE TABLE
                 mhelix_gcp_testwired.mhelix_memory_summary_embeddings]
          WHERE create_statement LIKE
            '%VECTOR INDEX vec_mhelix_summary_embeddings_run_projection (run_id ASC, projection_generation_id ASC, embedding vector_cosine_ops)%'
             OR create_statement LIKE
            '%VECTOR INDEX vec_mhelix_summary_embeddings_run_projection (run_id, projection_generation_id, embedding vector_cosine_ops)%'
       ) = 1 AS vector_index_definition_is_exact,
       (
         SELECT count(*) FROM information_schema.statistics
          WHERE table_schema = 'mhelix_gcp_testwired'
            AND table_name = 'mhelix_memory_summaries'
            AND index_name = 'uq_mhelix_memory_summaries_session_summary'
            AND non_unique = 'NO'
            AND ((seq_in_index = 1 AND column_name = 'session_id') OR
                 (seq_in_index = 2 AND column_name = 'memory_summary_id'))
       ) = 2 AS summaries_composite_unique_index_present,
       (
         SELECT count(*) FROM information_schema.statistics
          WHERE table_schema = 'mhelix_gcp_testwired'
            AND table_name = 'mhelix_action_receipts'
            AND index_name =
                  'uq_mhelix_action_receipts_run_receipt_operation'
            AND non_unique = 'NO'
            AND ((seq_in_index = 1 AND column_name = 'run_id') OR
                 (seq_in_index = 2 AND column_name = 'action_receipt_id') OR
                 (seq_in_index = 3 AND column_name = 'operation'))
       ) = 3 AS receipt_identity_unique_index_present,
       (
         SELECT count(*) FROM information_schema.statistics
          WHERE table_schema = 'mhelix_gcp_testwired'
            AND index_name = 'idx_mhelix_recall_result_items_receipt'
       ) = 0 AS no_redundant_receipt_rank_index;

-- Exact composite boundary keys, not merely foreign-key counts.
SELECT (
         SELECT count(*)
           FROM information_schema.key_column_usage AS k
           JOIN information_schema.table_constraints AS t
             ON t.constraint_name = k.constraint_name
            AND t.constraint_schema = k.constraint_schema
          WHERE t.table_schema = 'mhelix_gcp_testwired'
            AND t.table_name = 'mhelix_recall_result_items'
            AND t.constraint_type = 'FOREIGN KEY'
            AND t.constraint_name LIKE '%action\_receipt\_id\_operation\_fkey'
            AND ((k.ordinal_position = 1 AND k.column_name = 'run_id') OR
                 (k.ordinal_position = 2 AND k.column_name = 'action_receipt_id') OR
                 (k.ordinal_position = 3 AND k.column_name = 'operation'))
       ) = 3 AS recall_receipt_key_is_exactly_run_receipt_operation,
       (
         SELECT count(*)
           FROM information_schema.key_column_usage AS k
           JOIN information_schema.table_constraints AS t
             ON t.constraint_name = k.constraint_name
            AND t.constraint_schema = k.constraint_schema
          WHERE t.table_schema = 'mhelix_gcp_testwired'
            AND t.table_name = 'mhelix_recall_result_items'
            AND t.constraint_type = 'FOREIGN KEY'
            AND t.constraint_name LIKE
                  '%projection\_generation\_id\_memory\_summary\_id\_fkey'
            AND ((k.ordinal_position = 1 AND k.column_name = 'run_id') OR
                 (k.ordinal_position = 2 AND k.column_name = 'projection_generation_id') OR
                 (k.ordinal_position = 3 AND k.column_name = 'memory_summary_id'))
       ) = 3 AS recall_embedding_key_is_exactly_run_projection_summary,
       (
         SELECT count(*)
           FROM [SHOW CREATE TABLE
                 mhelix_gcp_testwired.mhelix_recall_result_items]
          WHERE create_statement LIKE
            '%FOREIGN KEY (run_id, action_receipt_id, operation) REFERENCES mhelix_gcp_testwired.mhelix_action_receipts(run_id, action_receipt_id, operation)%'
       ) = 1 AS recall_receipt_foreign_key_definition_is_exact,
       (
         SELECT count(*)
           FROM [SHOW CREATE TABLE
                 mhelix_gcp_testwired.mhelix_runtime_capabilities]
          WHERE create_statement LIKE '%CHECK (NOT public_mutations_enabled)%'
       ) = 1 AS mutation_claim_guard_definition_is_exact,
       (
         SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'mhelix_gcp_testwired'
            AND table_name = 'mhelix_action_receipts'
            AND column_name = 'transport_request_id'
            AND is_nullable = 'YES'
       ) = 1 AS transport_identifier_column_nullable;

-- Preflight requires all new runtime tables to be empty. Capability activation
-- is a separate later operation with its own verifier.
SELECT (SELECT count(*)
          FROM mhelix_gcp_testwired.mhelix_runtime_capabilities) = 0
         AS runtime_capabilities_empty,
       (SELECT count(*)
          FROM mhelix_gcp_testwired.mhelix_run_active_projections) = 0
         AS run_active_projections_empty,
       (SELECT count(*)
          FROM mhelix_gcp_testwired.mhelix_memory_summary_embeddings) = 0
         AS memory_summary_embeddings_empty,
       (SELECT count(*)
          FROM mhelix_gcp_testwired.mhelix_recall_result_items) = 0
         AS recall_result_items_empty;

-- Two-way direct table-grant comparison against the destination statement
-- catalog: 25 exact entries, including four guarded lifecycle UPDATEs.
WITH expected_grant (table_name, privilege_type) AS (
  VALUES
    ('mhelix_environment_markers', 'SELECT'),
    ('mhelix_runtime_capabilities', 'SELECT'),
    ('mhelix_case_namespaces', 'SELECT'),
    ('mhelix_runs', 'SELECT'),
    ('mhelix_runs', 'INSERT'),
    ('mhelix_memory_sessions', 'SELECT'),
    ('mhelix_memory_sessions', 'INSERT'),
    ('mhelix_memory_sessions', 'UPDATE'),
    ('mhelix_memory_events', 'SELECT'),
    ('mhelix_memory_events', 'INSERT'),
    ('mhelix_memory_summaries', 'SELECT'),
    ('mhelix_memory_summaries', 'INSERT'),
    ('mhelix_memory_summary_embeddings', 'SELECT'),
    ('mhelix_memory_summary_embeddings', 'INSERT'),
    ('mhelix_projection_generations', 'SELECT'),
    ('mhelix_projection_generations', 'INSERT'),
    ('mhelix_projection_generations', 'UPDATE'),
    ('mhelix_run_active_projections', 'SELECT'),
    ('mhelix_run_active_projections', 'INSERT'),
    ('mhelix_run_active_projections', 'UPDATE'),
    ('mhelix_action_receipts', 'SELECT'),
    ('mhelix_action_receipts', 'INSERT'),
    ('mhelix_action_receipts', 'UPDATE'),
    ('mhelix_recall_result_items', 'SELECT'),
    ('mhelix_recall_result_items', 'INSERT')
),
actual_grant AS (
  SELECT table_name, privilege_type, is_grantable
    FROM information_schema.table_privileges
   WHERE table_schema = 'mhelix_gcp_testwired'
     AND grantee = 'mhelix_gcp_runtime'
)
SELECT (SELECT count(*) FROM actual_grant) = 25 AS runtime_grant_count_is_exact,
       (SELECT count(*) FROM (
          SELECT table_name, privilege_type FROM expected_grant
          EXCEPT
          SELECT table_name, privilege_type FROM actual_grant
        ) AS missing_grant) = 0 AS no_expected_grant_is_missing,
       (SELECT count(*) FROM (
          SELECT table_name, privilege_type FROM actual_grant
          EXCEPT
          SELECT table_name, privilege_type FROM expected_grant
        ) AS extra_grant) = 0 AS no_unexpected_grant_present,
       (SELECT count(*) FROM actual_grant
         WHERE is_grantable = 'YES') = 0 AS no_grant_is_grantable,
       (SELECT count(*) FROM actual_grant
         WHERE privilege_type IN ('DELETE', 'TRUNCATE')) = 0
         AS runtime_can_never_destroy_rows,
       (SELECT count(*) FROM actual_grant
         WHERE privilege_type = 'UPDATE'
           AND table_name NOT IN (
             'mhelix_memory_sessions',
             'mhelix_projection_generations',
             'mhelix_run_active_projections',
             'mhelix_action_receipts'
           )) = 0 AS update_is_limited_to_four_transitions,
       (SELECT count(*) FROM information_schema.table_privileges
         WHERE table_schema = 'mhelix_gcp_testwired'
           AND grantee = 'mhelix_gcp_runtime'
           AND table_name = 'mhelix_schema_migrations') = 0
         AS runtime_has_no_migration_ledger_privilege;

-- Effective database/schema privileges, including implicit public inheritance.
SELECT (
         SELECT count(*) FROM [SHOW GRANTS ON DATABASE mhelix_gcp_testwired]
          WHERE grantee = 'mhelix_gcp_runtime'
            AND privilege_type = 'CONNECT' AND NOT is_grantable
       ) = 1 AS runtime_has_database_connect_not_grantable,
       (
         SELECT count(*) FROM [SHOW GRANTS ON DATABASE mhelix_gcp_testwired]
          WHERE grantee = 'mhelix_gcp_runtime'
            AND privilege_type <> 'CONNECT'
       ) = 0 AS runtime_has_no_other_database_privilege,
       (
         SELECT count(*) FROM [SHOW GRANTS ON SCHEMA mhelix_gcp_testwired]
          WHERE grantee = 'mhelix_gcp_runtime'
            AND privilege_type = 'USAGE' AND NOT is_grantable
       ) = 1 AS runtime_has_schema_usage_not_grantable,
       (
         SELECT count(*) FROM [SHOW GRANTS ON SCHEMA mhelix_gcp_testwired]
          WHERE grantee = 'mhelix_gcp_runtime'
            AND privilege_type <> 'USAGE'
       ) = 0 AS runtime_has_no_other_schema_privilege,
       (
         SELECT count(*) FROM [SHOW GRANTS ON DATABASE mhelix_gcp_testwired]
          WHERE grantee = 'public' AND privilege_type <> 'CONNECT'
       ) = 0 AS public_has_no_extra_database_privilege,
       (
         SELECT count(*) FROM [SHOW GRANTS ON SCHEMA mhelix_gcp_testwired]
          WHERE grantee = 'public'
       ) = 0 AS public_has_no_schema_privilege,
       (
         SELECT count(*) FROM information_schema.table_privileges
          WHERE table_schema = 'mhelix_gcp_testwired'
            AND grantee = 'public'
       ) = 0 AS public_has_no_table_privilege;

-- System privileges, role options, memberships, and ownership can bypass table
-- grants, so each is checked explicitly.
SELECT (
         SELECT count(*) FROM [SHOW SYSTEM GRANTS]
          WHERE grantee IN ('mhelix_gcp_runtime', 'public')
       ) = 0 AS runtime_and_public_hold_no_system_privilege,
       (
         SELECT count(*) FROM [SHOW ROLES]
          WHERE username = 'mhelix_gcp_runtime' AND options <> '{}'
       ) = 0 AS runtime_has_no_role_options,
       (
         SELECT count(*) FROM [SHOW ROLES]
          WHERE username = 'mhelix_gcp_runtime' AND member_of <> '{}'
       ) = 0 AS runtime_belongs_to_no_role,
       (
         SELECT count(*) FROM [SHOW TABLES FROM mhelix_gcp_testwired]
          WHERE owner = 'mhelix_gcp_runtime'
       ) = 0 AS runtime_owns_no_table,
       (
         SELECT count(*) FROM [SHOW TABLES FROM mhelix_gcp_testwired]
          WHERE owner <> 'mhelix_gcp_migrator'
       ) = 0 AS every_table_owned_by_migrator,
       (
         SELECT count(*)
           FROM [SHOW GRANTS ON ROLE FOR mhelix_gcp_runtime]
       ) = 0 AS runtime_holds_no_role_membership;
