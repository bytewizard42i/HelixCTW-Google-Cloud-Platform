// SPDX-License-Identifier: Apache-2.0
//
// Adapted from MidnightHelixCTW/apps/api/test/vector-memory-statements.test.mjs.
//
// Contract tests for the frozen SQL (Structured Query Language) catalog.
//
// These run against the statement text itself, with no database. They exist so
// that the security boundary cannot erode quietly: if someone later adds a
// statement that interpolates a value, forgets the schema qualifier, widens a
// response with `SELECT *`, or introduces a destructive verb, the build fails
// here rather than in production.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MUTATING_STATEMENT_NAMES,
  VECTOR_MEMORY_STATEMENTS,
  requireStatement,
} from "../src/vector-memory-statements.js";

const SOURCE_URL = new URL("../src/vector-memory-statements.js", import.meta.url);
const QUALIFIED_SCHEMA = "mhelix_gcp_testwired";

const statementEntries = Object.entries(VECTOR_MEMORY_STATEMENTS);

/** Strip SQL string literals so keyword scans ignore quoted data. */
function stripLiterals(sql) {
  return sql.replace(/'[^']*'/g, "''");
}

test("the catalog is frozen and non-empty", () => {
  assert.equal(Object.isFrozen(VECTOR_MEMORY_STATEMENTS), true);
  assert.ok(statementEntries.length >= 20);
  // A runtime addition must be impossible.
  assert.throws(() => {
    VECTOR_MEMORY_STATEMENTS.injected = "SELECT 1";
  }, TypeError);
});

test("every statement is static text with no interpolation", async () => {
  const source = await readFile(SOURCE_URL, "utf8");
  // Template placeholders and concatenation are how SQL injection enters a
  // codebase. Neither may appear in a statement definition.
  const statementBlock = source.slice(
    source.indexOf("const SELECT_CASE_NAMESPACE_BY_SCENARIO"),
    source.indexOf("export const VECTOR_MEMORY_STATEMENTS"),
  );
  assert.ok(statementBlock.length > 0);
  assert.doesNotMatch(statementBlock, /\$\{/, "template interpolation in SQL");
  assert.doesNotMatch(statementBlock, /`\s*\+|\+\s*`/, "string concatenation in SQL");
  assert.doesNotMatch(statementBlock, /\bconcat\s*\(/i, "runtime SQL concatenation");
});

test("every statement is schema-qualified", () => {
  for (const [name, sql] of statementEntries) {
    const tableReferences = [
      ...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([A-Za-z0-9_.]+)/gi),
    ].map((match) => match[1]);
    assert.ok(tableReferences.length > 0, `${name} references no table`);
    for (const reference of tableReferences) {
      assert.ok(
        reference.startsWith(`${QUALIFIED_SCHEMA}.`),
        `${name} has unqualified reference ${reference}`,
      );
    }
  }
});

test("every parameter is a positional placeholder numbered without gaps", () => {
  for (const [name, sql] of statementEntries) {
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) =>
      Number(match[1]),
    );
    if (placeholders.length === 0) {
      continue;
    }
    const distinct = [...new Set(placeholders)].sort((a, b) => a - b);
    assert.deepEqual(
      distinct,
      Array.from({ length: distinct.length }, (_, index) => index + 1),
      `${name} has non-contiguous placeholders: ${distinct.join(",")}`,
    );
  }
});

test("no statement is destructive or privilege-changing", () => {
  for (const [name, sql] of statementEntries) {
    const executable = stripLiterals(sql);
    for (const forbidden of [
      "DELETE",
      "TRUNCATE",
      "DROP",
      "ALTER",
      "CREATE",
      "GRANT",
      "REVOKE",
      "UPSERT",
    ]) {
      assert.doesNotMatch(
        executable,
        new RegExp(`\\b${forbidden}\\b`, "i"),
        `${name} contains ${forbidden}`,
      );
    }
    assert.doesNotMatch(executable, /\bON\s+CONFLICT\b/i, `${name} hides conflicts`);
  }
});

test("no statement uses SELECT star", () => {
  for (const [name, sql] of statementEntries) {
    assert.doesNotMatch(sql, /SELECT\s+\*/i, `${name} uses SELECT *`);
  }
});

test("only the four reviewed lifecycle transitions may update", () => {
  // Reviewed extension (rebuild feature): `updateRunActiveProjection` was
  // added as the fourth transition because the PRIMARY KEY on `run_id` in
  // mhelix_run_active_projections deliberately permits ONE binding per run,
  // so the rebuild drill must repoint the existing row rather than insert a
  // second one. Its guards are the previous generation identifier (optimistic
  // concurrency) plus an EXISTS check that the new generation is 'ACTIVE'.
  const updating = statementEntries
    .filter(([, sql]) => /^\s*UPDATE\s/im.test(stripLiterals(sql)))
    .map(([name]) => name)
    .sort();
  assert.deepEqual(updating, [
    "updateActionReceiptSettled",
    "updateProjectionVerified",
    "updateRunActiveProjection",
    "updateSessionClosed",
  ]);
  // Every update must be narrowed by a WHERE clause and a state precondition,
  // so a transition cannot be applied twice or to the wrong row. 'ACTIVE'
  // joined the vocabulary with the fourth transition: it is the state the
  // repoint requires of the incoming generation.
  for (const name of updating) {
    const sql = VECTOR_MEMORY_STATEMENTS[name];
    assert.match(sql, /\bWHERE\b/i, `${name} has no WHERE clause`);
    assert.match(sql, /=\s*'(OPEN|BUILDING|RESERVED|ACTIVE)'/, `${name} lacks a state guard`);
  }
});

test("the mutating list matches the statements that actually mutate", () => {
  const actualMutating = statementEntries
    .filter(([, sql]) => /^\s*(INSERT|UPDATE)\s/im.test(stripLiterals(sql)))
    .map(([name]) => name)
    .sort();
  assert.deepEqual(actualMutating, [...MUTATING_STATEMENT_NAMES].sort());
});

test("the stored vector and its commitment are never returned", () => {
  for (const [name, sql] of statementEntries) {
    if (!/^\s*SELECT/i.test(sql.trim())) {
      continue;
    }
    // A bare `embedding` or `embedding_commitment` in a select list would leak
    // stored vector material. The recall query may compute a distance FROM the
    // embedding, which is a scalar, not the vector itself.
    const selectList = sql.slice(0, sql.search(/\bFROM\b/i));
    assert.doesNotMatch(
      selectList,
      /(^|[\s,.])embedding\s*(,|$)/im,
      `${name} returns the stored vector`,
    );
    assert.doesNotMatch(
      selectList,
      /embedding_commitment/i,
      `${name} returns the embedding commitment`,
    );
  }
});

test("the recall query constrains both index prefixes and is bounded to two", () => {
  const recall = VECTOR_MEMORY_STATEMENTS.recallTopTwoByCosineDistance;
  // A vector index is only usable when every prefix column is constrained to an
  // exact value.
  assert.match(recall, /embeddings\.run_id = \$1/);
  assert.match(recall, /embeddings\.projection_generation_id = \$2/);
  assert.match(recall, /ORDER BY embeddings\.embedding <=> \$3::VECTOR/);
  assert.match(recall, /LIMIT 2\s*$/);
  // Cosine distance, matching the declared vector_cosine_ops operator class.
  assert.doesNotMatch(recall, /<->|<#>/, "wrong distance operator");
});

test("the explain statement mirrors the recall shape and stays read-only", () => {
  const explain = VECTOR_MEMORY_STATEMENTS.explainRecallTopTwo;
  assert.match(explain, /^\s*EXPLAIN/);
  assert.match(explain, /run_id = \$1/);
  assert.match(explain, /projection_generation_id = \$2/);
  assert.match(explain, /<=>/);
  assert.match(explain, /LIMIT 2\s*$/);
});

test("receipts reserve before settling and bind the transport request", () => {
  const reserve = VECTOR_MEMORY_STATEMENTS.insertActionReceiptReserved;
  assert.match(reserve, /'RESERVED'/);
  assert.match(reserve, /transport_request_id/);
  // Settlement may only move a reserved receipt forward.
  const settle = VECTOR_MEMORY_STATEMENTS.updateActionReceiptSettled;
  assert.match(settle, /receipt_state = 'RESERVED'/);
});

test("recall evidence rows are pinned to the recall operation", () => {
  const insert = VECTOR_MEMORY_STATEMENTS.insertRecallResultItem;
  // The operation literal is fixed in the statement, so a caller can never
  // attach recall evidence to a denial receipt.
  assert.match(insert, /VALUES \(\$1, \$2, 'recall'/);
});

test("statement lookup fails closed on an unknown name", () => {
  assert.equal(
    requireStatement("selectRuntimeCapability"),
    VECTOR_MEMORY_STATEMENTS.selectRuntimeCapability,
  );
  for (const bad of ["", "nope", "toString", "__proto__", "constructor", 7, null]) {
    assert.throws(() => requireStatement(bad), TypeError, `accepted ${String(bad)}`);
  }
});
