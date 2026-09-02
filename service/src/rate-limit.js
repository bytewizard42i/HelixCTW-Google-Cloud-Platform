// SPDX-License-Identifier: Apache-2.0
// Cost-protection rate limiting — bounded memory, per-instance.
//
// Purpose: an unauthenticated demo API must not let one nefarious script run
// up the bill (GCS write operations, database rows, log volume). This limiter
// bounds the damage: legitimate judges click through a journey at human speed
// and never notice it; a flood gets clean 429s that cost almost nothing.
//
// Design notes:
// - Sliding one-minute window per client IP plus a global window, and a
//   coarse per-day global ceiling. All counters live in memory: with at most
//   three Cloud Run instances, the true ceiling is at most three times these
//   numbers — still tiny in cost terms.
// - The client IP comes from the first entry of X-Forwarded-For, which on
//   Cloud Run is appended by Google's front end. It is used only as a
//   rate-limit bucket key in memory — never stored, never logged.
// - Memory is bounded: the per-IP map is pruned each sweep and hard-capped;
//   when the cap is hit we fail toward protection (treat as limited).

const WINDOW_MILLISECONDS = 60_000;
const MAX_TRACKED_CLIENTS = 10_000;

export function createRateLimiter({
  perClientPerMinute = 30,
  globalPerMinute = 240,
  globalPerDay = 20_000,
  now = () => Date.now(),
} = {}) {
  const perClient = new Map(); // ip -> [timestamps within window]
  let globalWindow = [];
  let dayKey = "";
  let dayCount = 0;

  function prune(timestamps, cutoff) {
    while (timestamps.length > 0 && timestamps[0] <= cutoff) timestamps.shift();
    return timestamps;
  }

  return Object.freeze({
    /** Returns true when the request is allowed; false when rate-limited. */
    allow(clientIp) {
      const at = now();
      const cutoff = at - WINDOW_MILLISECONDS;

      const currentDayKey = new Date(at).toISOString().slice(0, 10);
      if (currentDayKey !== dayKey) {
        dayKey = currentDayKey;
        dayCount = 0;
      }
      if (dayCount >= globalPerDay) return false;

      globalWindow = prune(globalWindow, cutoff);
      if (globalWindow.length >= globalPerMinute) return false;

      const key = typeof clientIp === "string" && clientIp.length > 0 ? clientIp : "unknown";
      let timestamps = perClient.get(key);
      if (!timestamps) {
        if (perClient.size >= MAX_TRACKED_CLIENTS) {
          // Sweep expired buckets before refusing outright.
          for (const [existingKey, existing] of perClient) {
            if (prune(existing, cutoff).length === 0) perClient.delete(existingKey);
          }
          if (perClient.size >= MAX_TRACKED_CLIENTS) return false;
        }
        timestamps = [];
        perClient.set(key, timestamps);
      }
      prune(timestamps, cutoff);
      if (timestamps.length >= perClientPerMinute) return false;

      timestamps.push(at);
      globalWindow.push(at);
      dayCount += 1;
      return true;
    },
  });
}

/**
 * The client address as Cloud Run saw it. Google's front end APPENDS the true
 * client IP to X-Forwarded-For, so the LAST entry is authoritative; earlier
 * entries are client-supplied and could be forged to dodge per-client limits.
 */
export function clientAddressOf(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const entries = forwarded.split(",");
    return entries[entries.length - 1].trim().slice(0, 64);
  }
  return request.socket?.remoteAddress ?? "unknown";
}
