# Fable review — HelixCTW Google Cloud edition (2026-09-02)

A zoom-out after Stage B shipped. Fixed items are marked; the rest are
documented so they are not forgotten.

## Fixed in this pass (release v10)

1. **Rate-limit bypass via forged `X-Forwarded-For`.** We keyed per-client
   limits on the *first* XFF entry, which a client can forge. Cloud Run
   *appends* the true address, so the *last* entry is authoritative. Fixed;
   global ceilings always bounded the bill regardless.
2. **Meeting-room problem.** Ten judges on one conference Wi-Fi share an IP;
   at 30 POST/min per client the tenth person would see 429s mid-demo.
   Raised per-client to 90/min (global 300/min, 20k/day still bound cost).

## Not yet done — worth knowing

3. **Custom domain.** The judge console lives at `*.vercel.app`. For Google,
   `gcp.helixctw.com` (one CNAME + Vercel domain add + CORS allowlist entry
   in Terraform) reads as a product, not a preview.
4. **Vercel Hobby terms** prohibit commercial use. A demo shown to a
   prospective partner is a gray zone; a Pro seat removes the question.
5. **Diagnostics correlation.** Visit and failure snapshots are independent.
   A random per-page-load token (in memory only, never persisted) would let
   us pair "this browser visited" with "this browser failed at step N".
6. **Budget alert recipients.** The $25 budget emails *billing admins*
   only. Add a Cloud Monitoring notification channel if others should know.
7. **Rate limits are per instance.** With max 3 instances the true ceiling
   is 3×. Acceptable for a demo; a Memorystore/Redis counter would make it
   exact if this ever becomes multi-tenant.
8. **Release rotation ceremony.** Every service change needs build + one-row
   capability rotation + Terraform apply (~5 minutes, deliberate). A
   `scripts/release.sh` wrapping those three steps with the preflight check
   would make the discipline cheaper without weakening it.
9. **Close-session latency (~4.5 s)** is the single largest UX cost. Worth
   profiling: it is one serializable transaction writing summaries,
   embeddings, and a projection; batching inserts may halve it.
10. **Log-based alert on 429 spikes** would turn "someone is hammering us"
    from a forensic finding into a real-time notification.

## Things that are already right (do not "fix")

- Terraform state is in a GCS backend (not local-only).
- No pay-per-call APIs at runtime; narration and embeddings are static.
- 30-day lifecycle covers receipts *and* diagnostics.
- Least-privilege runtime DB role (25-grant matrix), write-only bucket role.
- Midnight stays `SOURCE_ONLY` on screen and in narration.
