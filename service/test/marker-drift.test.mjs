// SPDX-License-Identifier: Apache-2.0
// Drift guard: the manifest's migrationSha256 must match the migration file
// on disk, byte for byte. If this fails, someone edited one without the
// other — fix the manifest (and re-run scripts/apply-marker.mjs), never the test.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HELIXCTW_GCP_ENVIRONMENT_MARKER_MANIFEST } from "../src/environment-marker.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("manifest migrationSha256 matches the migration file on disk", async () => {
  const manifest = HELIXCTW_GCP_ENVIRONMENT_MARKER_MANIFEST;
  const migrationSql = await readFile(
    join(repositoryRoot, manifest.sourceFileName),
    "utf8",
  );
  const actual = createHash("sha256").update(migrationSql, "utf8").digest("hex");
  assert.equal(actual, manifest.migrationSha256);
});

test("manifest statementCount matches the migration file on disk", async () => {
  const manifest = HELIXCTW_GCP_ENVIRONMENT_MARKER_MANIFEST;
  const migrationSql = await readFile(
    join(repositoryRoot, manifest.sourceFileName),
    "utf8",
  );
  const statements = migrationSql
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  assert.equal(statements.length, manifest.statementCount);
  assert.match(statements[0], /^CREATE SCHEMA IF NOT EXISTS helixctw_gcp$/);
  assert.match(statements[1], /^CREATE TABLE IF NOT EXISTS helixctw_gcp\.environment_markers/);
});
