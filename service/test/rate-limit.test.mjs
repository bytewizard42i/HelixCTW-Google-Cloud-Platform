// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";

import { clientAddressOf, createRateLimiter } from "../src/rate-limit.js";

function limiterAt(options) {
  let currentTime = 1_000_000;
  const limiter = createRateLimiter({ ...options, now: () => currentTime });
  return { limiter, advance: (ms) => (currentTime += ms) };
}

test("allows a full journey and blocks a per-client flood", () => {
  const { limiter } = limiterAt({ perClientPerMinute: 30 });
  for (let i = 0; i < 30; i += 1) assert.equal(limiter.allow("1.2.3.4"), true);
  assert.equal(limiter.allow("1.2.3.4"), false, "31st request in a minute is refused");
  assert.equal(limiter.allow("5.6.7.8"), true, "other clients are unaffected");
});

test("per-client window slides: capacity returns after a minute", () => {
  const { limiter, advance } = limiterAt({ perClientPerMinute: 5 });
  for (let i = 0; i < 5; i += 1) assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  advance(61_000);
  assert.equal(limiter.allow("a"), true);
});

test("global per-minute ceiling holds across many clients", () => {
  const { limiter } = limiterAt({ perClientPerMinute: 1_000, globalPerMinute: 40 });
  let allowed = 0;
  for (let i = 0; i < 100; i += 1) {
    if (limiter.allow(`client-${i}`)) allowed += 1;
  }
  assert.equal(allowed, 40);
});

test("global per-day ceiling holds and resets on a new day", () => {
  const { limiter, advance } = limiterAt({
    perClientPerMinute: 1_000,
    globalPerMinute: 1_000,
    globalPerDay: 50,
  });
  let allowed = 0;
  for (let i = 0; i < 60; i += 1) {
    if (limiter.allow(`client-${i % 7}`)) allowed += 1;
    advance(1_500); // spread requests so the minute window never binds
  }
  assert.equal(allowed, 50);
  advance(24 * 60 * 60 * 1_000);
  assert.equal(limiter.allow("fresh"), true, "a new day restores capacity");
});

test("clientAddressOf prefers the first X-Forwarded-For entry", () => {
  assert.equal(
    clientAddressOf({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, socket: {} }),
    "203.0.113.9",
  );
  assert.equal(
    clientAddressOf({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }),
    "127.0.0.1",
  );
});
