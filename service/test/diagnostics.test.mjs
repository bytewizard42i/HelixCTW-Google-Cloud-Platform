// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeDiagnostic } from "../src/diagnostics.js";

test("accepts a bounded visit snapshot and stamps id and time", () => {
  const record = sanitizeDiagnostic({
    kind: "visit",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    screen: "390x844@3",
    capabilities: "randomUUID:true dialog:true speech:true audio:true touch:true",
  });
  assert.ok(record);
  assert.equal(record.kind, "visit");
  assert.match(record.diagnosticId, /^[0-9a-f-]{36}$/);
  assert.match(record.receivedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(record.screen, "390x844@3");
});

test("accepts a failure snapshot with step and message", () => {
  const record = sanitizeDiagnostic({
    kind: "failure",
    step: "End the conversation",
    message: "Failed closed: the response did not include matching evidence.",
    release: "ebd1822c2f2d97489a3325f4eb45dc89b2694a79",
    userAgent: "Mozilla/5.0 Edg/128.0",
  });
  assert.ok(record);
  assert.equal(record.step, "End the conversation");
});

test("rejects unknown kinds and non-objects", () => {
  assert.equal(sanitizeDiagnostic({ kind: "tracking" }), null);
  assert.equal(sanitizeDiagnostic(null), null);
  assert.equal(sanitizeDiagnostic([]), null);
  assert.equal(sanitizeDiagnostic("visit"), null);
});

test("drops unknown fields and oversized or control-character values", () => {
  const record = sanitizeDiagnostic({
    kind: "visit",
    cookie: "session=abc",
    ipAddress: "203.0.113.9",
    userAgent: "x".repeat(500),
    screen: "bad\u0000value",
  });
  assert.ok(record);
  assert.equal("cookie" in record, false);
  assert.equal("ipAddress" in record, false);
  assert.equal("userAgent" in record, false);
  assert.equal("screen" in record, false);
});
