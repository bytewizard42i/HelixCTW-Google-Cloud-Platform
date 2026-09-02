// SPDX-License-Identifier: Apache-2.0
// Visitor diagnostics — bounded, sanitized, fire-and-forget.
//
// The browser posts a small allowlisted snapshot (which step, what public
// failure message, browser capabilities) so real-device problems like
// "cannot get past checkpoint 2 on a phone" become debuggable. Objects land
// in the existing audit bucket under diagnostics/<date>/<uuid>.json; the
// operator pulls them locally with scripts/pull-diagnostics.mjs.
//
// Privacy rules, enforced here:
// - exact key allowlist; unknown fields are dropped, never stored;
// - every value is a bounded string (or bounded integer) — no nesting;
// - no cookies, no identifiers from other sites, no request IP is written;
// - a write failure returns stored:false and can never throw upstream.

import { randomUUID } from "node:crypto";

import { Storage } from "@google-cloud/storage";

const KIND_PATTERN = /^(visit|failure)$/;
const BOUNDED_TEXT = /^[^\u0000-\u0008\u000B-\u001F\u007F]{1,400}$/u;

const STRING_FIELDS = Object.freeze([
  "kind",
  "step",
  "message",
  "userAgent",
  "release",
  "screen",
  "connection",
  "capabilities",
]);

export function sanitizeDiagnostic(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (typeof input.kind !== "string" || !KIND_PATTERN.test(input.kind)) return null;

  const record = { diagnosticId: randomUUID(), receivedAt: new Date().toISOString() };
  for (const field of STRING_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && BOUNDED_TEXT.test(value)) {
      record[field] = value.slice(0, 400);
    }
  }
  return Object.freeze(record);
}

export function createDiagnosticsStore({ bucketName }) {
  const bucket =
    typeof bucketName === "string" && bucketName.length > 0
      ? new Storage().bucket(bucketName)
      : null;
  return Object.freeze({
    enabled: Boolean(bucket),
    async put(record) {
      if (!bucket) return false;
      try {
        const objectKey = `diagnostics/${record.receivedAt.slice(0, 10)}/${record.diagnosticId}.json`;
        await bucket
          .file(objectKey)
          .save(JSON.stringify(record), { contentType: "application/json", resumable: false });
        return true;
      } catch {
        return false; // diagnostics must never take the service down
      }
    },
  });
}
