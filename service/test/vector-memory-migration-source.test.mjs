// SPDX-License-Identifier: Apache-2.0
// Adapted from MidnightHelixCTW/apps/api/test/vector-memory-migration-source.test.mjs
// (same author, Apache-2.0) for the HelixCTW GCP Stage B database sources.
//
// These tests inspect committed source only. They do not connect to CockroachDB,
// apply a migration, issue a grant, activate a capability, or prove live use.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MEMORY_ROOT = new URL("../../database/memory/", import.meta.url);
const SCHEMA = "mhelix_gcp_testwired";
const RUNTIME_ROLE = "mhelix_gcp_runtime";
const MARKER_ID = "helixctw-gcp-testwired-environment";
const FORBIDDEN_FROZEN_IDENTIFIER = ["helixchain", "hackathon"].join("-");

const urls = Object.freeze({
  core: new URL("001_testwired_memory_core.sql", MEMORY_ROOT),
  markerActivation: new URL("001_testwired_marker_activation.sql", MEMORY_ROOT),
  vector: new URL("002_testwired_vector_memory.sql", MEMORY_ROOT),
  vectorActivation: new URL(
    "002_testwired_vector_memory_activation.sql",
    MEMORY_ROOT,
  ),
  grants: new URL("002_testwired_vector_memory_grants.sql", MEMORY_ROOT),
  caseNamespace: new URL("003_testwired_case_namespace.sql", MEMORY_ROOT),
  markerVerification: new URL("verify_marker_activation.sql", MEMORY_ROOT),
  vectorVerification: new URL(
    "verify_vector_memory_activation.sql",
    MEMORY_ROOT,
  ),
  capabilityActivation: new URL(
    "activate_vector_memory_capability.sql",
    MEMORY_ROOT,
  ),
  capabilityVerification: new URL(
    "verify_vector_memory_capability.sql",
    MEMORY_ROOT,
  ),
  capabilityRotation: new URL(
    "rotate_vector_memory_capability.sql",
    MEMORY_ROOT,
  ),
});

function stripSqlComments(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function stripSqlStrings(sql) {
  return sql.replace(/'(?:''|[^'])*'/g, "''");
}

function statements(sql) {
  return stripSqlComments(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function digest(source) {
  return createHash("sha256").update(source).digest("hex");
}

async function read(url) {
  return readFile(url, "utf8");
}

function collectMigrationViolations(rawSql) {
  const executable = stripSqlComments(rawSql);
  const violations = [];

  for (const [, target] of [
    ...executable.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\S+)/g),
    ...executable.matchAll(
      /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+\S+\s+ON\s+(\S+)/g,
    ),
    ...executable.matchAll(/ALTER TABLE\s+(\S+)/g),
    ...executable.matchAll(/REFERENCES\s+([A-Za-z0-9_.]+)/g),
  ]) {
    if (!target.startsWith(`${SCHEMA}.`)) {
      violations.push(`unqualified-object:${target}`);
    }
  }

  for (const forbidden of [
    "DROP",
    "TRUNCATE",
    "DELETE",
    "UPDATE",
    "RENAME",
    "GRANT",
    "REVOKE",
    "UPSERT",
  ]) {
    if (new RegExp(`\\b${forbidden}\\b`, "i").test(executable)) {
      violations.push(`destructive-or-privileged:${forbidden}`);
    }
  }
  if (/\bON\s+CONFLICT\b|\bSET\s+CLUSTER\s+SETTING\b|\bALTER\s+COLUMN\b/i.test(executable)) {
    violations.push("unsafe-migration-clause");
  }
  return violations;
}

const EXPECTED_GRANTS = new Set([
  "mhelix_environment_markers:SELECT",
  "mhelix_runtime_capabilities:SELECT",
  "mhelix_case_namespaces:SELECT",
  "mhelix_runs:SELECT",
  "mhelix_runs:INSERT",
  "mhelix_memory_sessions:SELECT",
  "mhelix_memory_sessions:INSERT",
  "mhelix_memory_sessions:UPDATE",
  "mhelix_memory_events:SELECT",
  "mhelix_memory_events:INSERT",
  "mhelix_memory_summaries:SELECT",
  "mhelix_memory_summaries:INSERT",
  "mhelix_memory_summary_embeddings:SELECT",
  "mhelix_memory_summary_embeddings:INSERT",
  "mhelix_projection_generations:SELECT",
  "mhelix_projection_generations:INSERT",
  "mhelix_projection_generations:UPDATE",
  "mhelix_run_active_projections:SELECT",
  "mhelix_run_active_projections:INSERT",
  "mhelix_run_active_projections:UPDATE",
  "mhelix_action_receipts:SELECT",
  "mhelix_action_receipts:INSERT",
  "mhelix_action_receipts:UPDATE",
  "mhelix_recall_result_items:SELECT",
  "mhelix_recall_result_items:INSERT",
]);

function collectGrantViolations(rawSql) {
  const executable = stripSqlComments(rawSql);
  const violations = [];
  const observed = new Set();

  for (const [pattern, label] of [
    [/ALL PRIVILEGES|GRANT ALL\b/i, "all-privileges"],
    [/ALL TABLES IN SCHEMA/i, "all-tables"],
    [/WITH GRANT OPTION|WITH ADMIN OPTION/i, "grantable"],
    [/\b(REVOKE|DELETE|TRUNCATE|DROP|ALTER)\b/i, "destructive"],
    [/\bBEGIN\b|\bCOMMIT\b/i, "transaction-wrapped"],
  ]) {
    if (pattern.test(executable)) violations.push(label);
  }

  let hasConnect = false;
  let hasUsage = false;
  for (const statement of statements(rawSql)) {
    const flat = statement.replace(/\s+/g, " ");
    if (flat === `GRANT CONNECT ON DATABASE ${SCHEMA} TO ${RUNTIME_ROLE}`) {
      hasConnect = true;
      continue;
    }
    if (flat === `GRANT USAGE ON SCHEMA ${SCHEMA} TO ${RUNTIME_ROLE}`) {
      hasUsage = true;
      continue;
    }
    const match = flat.match(/^GRANT (.+?) ON TABLE (\S+) TO (\S+)$/);
    if (!match) {
      violations.push("unparsable-grant");
      continue;
    }
    const [, privilegeList, qualifiedTable, grantee] = match;
    if (!qualifiedTable.startsWith(`${SCHEMA}.`) || grantee !== RUNTIME_ROLE) {
      violations.push("wrong-target-or-grantee");
    }
    const table = qualifiedTable.split(".")[1];
    for (const privilege of privilegeList.split(",").map((item) => item.trim())) {
      const entry = `${table}:${privilege}`;
      observed.add(entry);
      if (!EXPECTED_GRANTS.has(entry)) violations.push(`extra:${entry}`);
    }
  }
  if (!hasConnect) violations.push("missing-connect");
  if (!hasUsage) violations.push("missing-usage");
  for (const expected of EXPECTED_GRANTS) {
    if (!observed.has(expected)) violations.push(`missing:${expected}`);
  }
  return violations;
}

function collectReadbackViolations(rawSql) {
  const executable = stripSqlComments(rawSql);
  const withoutStrings = stripSqlStrings(executable);
  const violations = [];
  if (/\b(INSERT|UPSERT|DELETE|TRUNCATE|DROP|ALTER|GRANT|REVOKE)\b/i.test(withoutStrings)) {
    violations.push("not-read-only");
  }
  if (/coalesce\s*\((?:[^()]|\([^()]*\))*,\s*true\s*\)/i.test(executable)) {
    violations.push("vacuous-true");
  }
  if (/SELECT\s+\*/i.test(executable)) violations.push("select-star");
  return violations;
}

test("all Stage B SQL sources are attributed, GCP-scoped, and source-only", async () => {
  for (const url of Object.values(urls)) {
    const source = await read(url);
    assert.match(source, /SPDX-License-Identifier: Apache-2\.0/);
    assert.match(source, /Adapted from MidnightHelixCTW\//);
    assert.match(source, /SOURCE_ONLY/);
    assert.doesNotMatch(source, new RegExp(FORBIDDEN_FROZEN_IDENTIFIER, "i"));
    assert.doesNotMatch(source, /\bmhelix_testwired\b/);
  }
});

test("both migrations remain qualified, additive, and non-destructive", async () => {
  const core = await read(urls.core);
  const vector = await read(urls.vector);
  assert.deepEqual(collectMigrationViolations(core), []);
  assert.deepEqual(collectMigrationViolations(vector), []);
  assert.match(core, /^CREATE SCHEMA IF NOT EXISTS mhelix_gcp_testwired;$/m);
  assert.match(vector, /embedding\s+VECTOR\(8\)\s+NOT NULL/);
  assert.match(vector, /embedding_dimensions\s*=\s*8/);
  assert.match(
    vector.replace(/\s+/g, " "),
    /VECTOR INDEX vec_mhelix_summary_embeddings_run_projection \( run_id, projection_generation_id, embedding vector_cosine_ops \)/,
  );
  assert.match(
    vector.replace(/\s+/g, " "),
    /FOREIGN KEY \(run_id, action_receipt_id, operation\) REFERENCES mhelix_gcp_testwired\.mhelix_action_receipts \(run_id, action_receipt_id, operation\)/,
  );
  assert.match(vector, /CHECK \(NOT public_mutations_enabled\)/);
});

test("migration ledger constants match exact bytes and statement counts", async () => {
  for (const [migrationKey, activationKey, expectedCount] of [
    ["core", "markerActivation", 16],
    ["vector", "vectorActivation", 7],
  ]) {
    const migration = await read(urls[migrationKey]);
    const activation = await read(urls[activationKey]);
    const checksum = digest(migration);
    assert.equal(statements(migration).length, expectedCount);
    assert.match(activation, new RegExp(`'${checksum}'`));
    assert.match(stripSqlComments(activation), new RegExp(`\\b${expectedCount}\\b`));
    assert.match(stripSqlComments(activation), /^BEGIN;$/m);
    assert.match(stripSqlComments(activation), /^COMMIT;$/m);
    assert.doesNotMatch(stripSqlComments(activation), /UPSERT|ON CONFLICT/i);
  }

  const vectorChecksum = digest(await read(urls.vector));
  for (const key of [
    "vectorVerification",
    "capabilityActivation",
    "capabilityVerification",
  ]) {
    assert.match(await read(urls[key]), new RegExp(`'${vectorChecksum}'`));
  }
});

test("canonical GCP marker and parameterized case source fail closed", async () => {
  for (const key of [
    "markerActivation",
    "markerVerification",
    "caseNamespace",
    "capabilityActivation",
    "capabilityVerification",
  ]) {
    assert.match(await read(urls[key]), new RegExp(MARKER_ID));
  }
  const markerActivation = stripSqlComments(await read(urls.markerActivation));
  assert.match(markerActivation, /digest\(/);
  assert.doesNotMatch(markerActivation, /decode\(\s*'[0-9a-f]{64}'/i);

  const caseSource = stripSqlComments(await read(urls.caseNamespace));
  assert.match(caseSource, /\$1 ~ '\^\[0-9a-f\]\{40\}\$'/);
  assert.doesNotMatch(caseSource, /\$2|\b[0-9a-f]{40}\b/);
  assert.match(caseSource, /SELECT count\(\*\)[\s\S]*mhelix_environment_markers/);
  assert.match(caseSource, /SELECT count\(\*\)[\s\S]*mhelix_case_namespaces/);
});

test("grant packet is the exact destination catalog matrix", async () => {
  assert.deepEqual(collectGrantViolations(await read(urls.grants)), []);
});

test("schema and marker readbacks are read-only and fail closed", async () => {
  const markerVerifier = await read(urls.markerVerification);
  const vectorVerifier = await read(urls.vectorVerification);
  assert.deepEqual(collectReadbackViolations(markerVerifier), []);
  assert.deepEqual(collectReadbackViolations(vectorVerifier), []);
  for (const required of [
    "current_database() = 'mhelix_gcp_testwired'",
    "crdb_sql_type = 'VECTOR(8)'",
    "vector_cosine_ops",
    "seq_in_index",
    "key_column_usage",
    "ordinal_position",
    "EXCEPT",
    "is_grantable",
    "grantee = 'public'",
    "SHOW SYSTEM GRANTS",
    "SHOW ROLES",
    "SHOW GRANTS ON ROLE FOR mhelix_gcp_runtime",
    "owner <> 'mhelix_gcp_migrator'",
    "runtime_grant_count_is_exact",
    "= 25 AS runtime_grant_count_is_exact",
  ]) {
    assert.ok(vectorVerifier.includes(required), `missing verifier guard: ${required}`);
  }
});

test("capability activation and post-readback remain derived and release-bound", async () => {
  const activation = stripSqlComments(await read(urls.capabilityActivation));
  const verification = await read(urls.capabilityVerification);
  assert.equal((activation.match(/INSERT INTO/g) ?? []).length, 1);
  assert.match(activation, /digest\(/);
  assert.match(activation, /\$1 ~ '\^\[0-9a-f\]\{40\}\$'/);
  assert.doesNotMatch(activation, /\$2|UPSERT|ON CONFLICT|\b[0-9a-f]{40}\b/);
  assert.match(activation, /'SOURCE_ONLY'/);
  assert.match(activation, /public_mutations_enabled/);
  assert.deepEqual(collectReadbackViolations(verification), []);
  assert.match(verification, /release_commit = \$1/);
  assert.match(verification, /release_commit <> \$1/);
  assert.match(verification, /public_mutations_enabled = false/);
  assert.match(verification, /digest\(/);
});

test("capability rotation is isolated to one guarded marker replacement", async () => {
  const rotation = stripSqlComments(await read(urls.capabilityRotation));
  const parsedStatements = statements(rotation);
  assert.equal(parsedStatements.length, 2);
  assert.match(parsedStatements[0], /^DELETE FROM mhelix_gcp_testwired\.mhelix_runtime_capabilities/);
  assert.match(parsedStatements[1], /^INSERT INTO mhelix_gcp_testwired\.mhelix_runtime_capabilities/);
  assert.match(rotation, /release_commit = \$1/);
  assert.match(rotation, /\$2 <> \$1/);
  assert.match(rotation, /release_commit=' \|\| \$2/);
  assert.doesNotMatch(
    rotation,
    /(?:DELETE FROM|INSERT INTO)\s+mhelix_gcp_testwired\.mhelix_(?:runs|memory|action_receipts|recall)/,
  );
  assert.doesNotMatch(rotation, /\b(?:DROP|TRUNCATE|ALTER|UPDATE)\b/);
});

test("negative variants prove the source guards reject regressions", async () => {
  const vector = await read(urls.vector);
  assert.ok(
    collectMigrationViolations(
      `${vector}\nDROP TABLE ${SCHEMA}.mhelix_recall_result_items;`,
    ).includes("destructive-or-privileged:DROP"),
  );
  assert.doesNotMatch(vector, /VECTOR\(1536\)/);
  assert.doesNotMatch(vector, /vector_l2_ops|vector_ip_ops/);

  const grants = await read(urls.grants);
  assert.ok(
    collectGrantViolations(`${grants}\nGRANT SELECT ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${RUNTIME_ROLE};`).includes("all-tables"),
  );
  assert.ok(
    collectGrantViolations(
      grants.replace(
        "GRANT SELECT, INSERT ON TABLE mhelix_gcp_testwired.mhelix_runs",
        "GRANT SELECT, INSERT, UPDATE ON TABLE mhelix_gcp_testwired.mhelix_runs",
      ),
    ).includes("extra:mhelix_runs:UPDATE"),
  );

  const verifier = await read(urls.vectorVerification);
  assert.ok(
    collectReadbackViolations(`${verifier}\nDELETE FROM ${SCHEMA}.mhelix_runs;`).includes("not-read-only"),
  );
  assert.ok(
    collectReadbackViolations(
      `${verifier}\nSELECT coalesce(bool_and(true), true);`,
    ).includes("vacuous-true"),
  );
});
