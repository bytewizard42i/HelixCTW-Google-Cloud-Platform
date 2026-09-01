// SPDX-License-Identifier: Apache-2.0
// Guarded operator wrapper for rotate_vector_memory_capability.sql.
//
// This is never called by bootstrap or deployment. `--check` is read-only.
// `--apply` deletes exactly one obsolete capability marker and inserts exactly
// one replacement in the same transaction; any unexpected row count rolls the
// transaction back. It does not touch runs, sessions, memories, projections,
// receipts, users, grants, or schema objects.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromService = createRequire(join(repositoryRoot, "service/package.json"));
const pg = requireFromService("pg");
const mode = process.argv[2];
const oldRelease = process.env.HELIXCTW_GCP_OLD_RELEASE_COMMIT ?? "";
const newRelease = process.env.HELIXCTW_GCP_NEW_RELEASE_COMMIT ?? "";
const adminUrl = process.env.HELIXCTW_GCP_ADMIN_DB_URL ?? "";

if (!new Set(["--check", "--apply"]).has(mode)) {
  throw new Error("Choose exactly one mode: --check or --apply.");
}
if (
  !/^[0-9a-f]{40}$/.test(oldRelease) ||
  !/^[0-9a-f]{40}$/.test(newRelease) ||
  oldRelease === newRelease
) {
  throw new Error("Old and new releases must be distinct 40-character commits.");
}

let targetUrl;
try {
  targetUrl = new URL(adminUrl);
} catch {
  throw new Error("HELIXCTW_GCP_ADMIN_DB_URL is invalid.");
}
if (
  !targetUrl.hostname.endsWith(".cockroachlabs.cloud") ||
  decodeURIComponent(targetUrl.username) !== "didz_gateway" ||
  targetUrl.pathname !== "/helix_testtown"
) {
  throw new Error("The admin URL does not identify the reviewed didz-testwired operator.");
}
targetUrl.pathname = "/mhelix_gcp_testwired";

const client = new pg.Client({
  connectionString: targetUrl.toString(),
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 2_000,
  statement_timeout: 10_000,
  query_timeout: 12_000,
  application_name: "helixctw-gcp-capability-rotation",
});
await client.connect();

async function readCapabilitySummary() {
  const result = await client.query(
    `SELECT release_commit,
            capability_id,
            capability_state,
            capability_version,
            public_mutations_enabled,
            octet_length(evidence_commitment) = 32 AS commitment_is_32_bytes
       FROM mhelix_gcp_testwired.mhelix_runtime_capabilities
      WHERE capability_id = 'vector_memory_recall'
      ORDER BY release_commit`,
  );
  return result.rows;
}

try {
  const identity = await client.query("SELECT current_user");
  if (identity.rows[0]?.current_user !== "didz_gateway") {
    throw new Error("The authenticated operator is not didz_gateway.");
  }
  const before = await readCapabilitySummary();
  console.log(JSON.stringify({ mode, oldRelease, newRelease, before }, null, 2));
  if (
    before.length !== 1 ||
    before[0].release_commit !== oldRelease ||
    before[0].capability_state !== "SOURCE_ONLY" ||
    Number(before[0].capability_version) !== 1 ||
    before[0].public_mutations_enabled !== false ||
    before[0].commitment_is_32_bytes !== true
  ) {
    throw new Error("The current capability row is not the exact reviewed old release.");
  }
  if (mode === "--check") process.exitCode = 0;
  else {
    const source = await readFile(
      join(repositoryRoot, "database/memory/rotate_vector_memory_capability.sql"),
      "utf8",
    );
    const statements = source
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    if (statements.length !== 2) {
      throw new Error("The reviewed rotation source must contain exactly two statements.");
    }

    await client.query("SET ROLE mhelix_gcp_migrator");
    await client.query("BEGIN");
    try {
      const deleted = await client.query(statements[0], [oldRelease]);
      const inserted = await client.query(statements[1], [oldRelease, newRelease]);
      if (deleted.rowCount !== 1 || inserted.rowCount !== 1) {
        throw new Error("Rotation did not delete and insert exactly one row.");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.query("RESET ROLE");
    }

    const after = await readCapabilitySummary();
    if (
      after.length !== 1 ||
      after[0].release_commit !== newRelease ||
      after[0].commitment_is_32_bytes !== true
    ) {
      throw new Error("Post-rotation readback does not contain exactly the new release.");
    }
    console.log(JSON.stringify({ rotated: true, after }, null, 2));
  }
} finally {
  await client.end();
}
