// SPDX-License-Identifier: Apache-2.0
// apply-marker.mjs — one-time setup for the GCP edition's environment marker
// on the didz-testwired cluster (database helix_testtown).
//
// What it does, in order:
//   1. Verifies the migration file on disk hashes to exactly the SHA-256
//      recorded in the manifest (drift check — fail loudly, apply nothing).
//   2. Applies database/migrations/001_gcp_environment_marker.sql
//      (CREATE SCHEMA + CREATE TABLE, both IF NOT EXISTS — idempotent).
//   3. Upserts the single canonical marker row, deriving the commitment from
//      the manifest at runtime (the commitment is never a literal in git).
//   4. Reads the row back and prints a sanitized verification (booleans and
//      ids only — no connection details).
//
// Usage:
//   HELIXCTW_GCP_DB_URL="postgresql://..." node scripts/apply-marker.mjs
//
// The URL comes from /home/js/PixyPi/.mcp-credentials/cockroachdb/didz-testwired.md
// (HELIX_TESTTOWN_DB_URL). NEVER pass it as a command-line argument — argv
// leaks into shell history and process lists; environment variables don't.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  HELIXCTW_GCP_ENVIRONMENT_MARKER_MANIFEST,
  HELIXCTW_GCP_ENVIRONMENT_MARKER_COMMITMENT_HEX,
} from "../service/src/environment-marker.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = HELIXCTW_GCP_ENVIRONMENT_MARKER_MANIFEST;

const databaseUrl = process.env.HELIXCTW_GCP_DB_URL;
if (!databaseUrl) {
  console.error(
    "HELIXCTW_GCP_DB_URL is not set. Export the didz-testwired connection URL first.",
  );
  process.exit(1);
}

// --- 1. drift check ---------------------------------------------------------
const migrationPath = join(repositoryRoot, manifest.sourceFileName);
const migrationSql = await readFile(migrationPath, "utf8");
const actualSha256 = createHash("sha256").update(migrationSql, "utf8").digest("hex");
if (actualSha256 !== manifest.migrationSha256) {
  console.error("Migration file SHA-256 does not match the manifest. Refusing to apply.");
  console.error(`  manifest: ${manifest.migrationSha256}`);
  console.error(`  on disk:  ${actualSha256}`);
  process.exit(1);
}

const statements = migrationSql
  .split(";")
  .map((statement) => statement.replace(/^--.*$/gm, "").trim())
  .filter((statement) => statement.length > 0);
if (statements.length !== manifest.statementCount) {
  console.error(
    `Migration contains ${statements.length} statements; manifest says ${manifest.statementCount}. Refusing to apply.`,
  );
  process.exit(1);
}

// --- 2 + 3 + 4. apply, upsert, read back ------------------------------------
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
  application_name: "helixctw-gcp-apply-marker",
});

await client.connect();
try {
  for (const statement of statements) {
    await client.query(statement);
  }
  console.log("Migration applied (idempotent).");

  await client.query(
    `UPSERT INTO helixctw_gcp.environment_markers
       (marker_id, build_stage, marker_version, marker_commitment)
     VALUES ($1, $2, $3, decode($4, 'hex'))`,
    [
      manifest.markerId,
      manifest.buildStage,
      manifest.markerVersion,
      HELIXCTW_GCP_ENVIRONMENT_MARKER_COMMITMENT_HEX,
    ],
  );
  console.log("Canonical marker row upserted.");

  const readback = await client.query(
    `SELECT marker_id,
            build_stage,
            marker_version,
            encode(marker_commitment, 'hex') = $2 AS commitment_matches,
            evidence_receipt_id::STRING AS evidence_receipt_id,
            (SELECT count(*) FROM helixctw_gcp.environment_markers) AS total_rows
       FROM helixctw_gcp.environment_markers
      WHERE marker_id = $1`,
    [manifest.markerId, HELIXCTW_GCP_ENVIRONMENT_MARKER_COMMITMENT_HEX],
  );

  console.log("Sanitized readback:");
  console.log(JSON.stringify(readback.rows, null, 2));
} finally {
  await client.end();
}
