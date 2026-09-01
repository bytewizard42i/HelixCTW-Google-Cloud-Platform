# TestWired demo plan — GCP edition of the memory journey

*Approved by John on 2026-09-01 ("love this plan, document it and go").*

The goal: give the Google Cloud edition the same TestWired demo experience as
the AWS edition (`MidnightHelixCTW`, deployed at
<https://testwired.helixctw.com>), honestly, in two reviewed stages.

## Why staged

The AWS demo is ~9,600 lines across a judge API (`mhelixctw/api/v1` contract)
and a guided web app. Its own deployment playbook shipped transport first and
the memory journey second. We follow the same discipline: every stage is
deployed, verified, and pushed before the next begins, and no provider label is
ever promoted without real execution evidence (see `MidnightHelixCTW/AGENTS.md`
— the status vocabulary `LIVE_TESTWIRED` / `SOURCE_ONLY` / `MOCK` /
`NOT_CONNECTED` is binding here too).

## Stage A — TestWired site with real status (this session)

1. **API**: port the judge contract's read-only routes into this repo's Cloud
   Run service — `GET /healthz`-equivalent (`/health`; Cloud Run reserves
   `*z` paths), `GET /api/v1/status` (envelope with `schemaVersion`,
   `requestId`, provider evidence array), `GET /api/v1/judge/scenarios`.
   Provider rows, all fail-closed until proven:
   - `gcp` — "Helix Runtime Bridge (Cloud Run)" (replaces the `aws` row; the
     machine id changes because this IS a different runtime, and the web copy
     is rebranded to match).
   - `cockroachdb` — live read-only probe against `didz-testwired` (already
     `CONNECTED` with marker-commitment verification).
   - `midnight`, `didz`, `agenticdid`, `rwaz` — unchanged fixture/source-only
     rows, same honest labels as the AWS edition.
   - No `bedrock` row: embeddings in this codebase are deterministic and
     synthetic (`synthetic-embedding.js`); the GCP edition inherits that and
     never claims a model provider it does not call.
   - `memorySlice.available: false` in Stage A — the journey is not deployed
     yet and the status must say so.
2. **Web**: copy `MidnightHelixCTW/apps/web` into this repo as `web/`
   (the source repo is FROZEN for judging — read-only; the copy lives and
   evolves here). Rebrand AWS→GCP labels, point `VITE_API_BASE_URL` at the
   Cloud Run service, keep the fail-closed connection gating exactly as
   written.
3. **Deploy**: API as container `testwired-v4+` via Cloud Build + Terraform;
   web as a new Vercel project (Vercel-generated URL first;
   `testwired-gcp.helixctw.com` DNS later — never block the demo on DNS).
4. **Wire the chooser**: the Google Cloud card at helixctw.com gets an
   `externalUrl` handoff to the deployed site, exactly like the AWS card.

## Stage B — the five-route memory journey (next session)

Port `create_run`, `close_session`, `recall`, the three actions, and receipts:

- **Database**: dedicated `mhelix_gcp_testwired` database on the
  `didz-testwired` cluster (CockroachDB v26.2, `VECTOR(8)` + cosine index).
  The frozen `helixchain-hackathon` cluster is never touched.
- **SQL boundary**: port the frozen statement catalog
  (`vector-memory-statements.js`) and its guard tests verbatim — no template
  interpolation, allowlisted UPDATEs only, bound parameters everywhere.
- **Provider**: port `vector-memory-provider.js` (serializable transactions,
  retry only SQLSTATE 40001, idempotency keys hashed to 32 bytes).
- **Bootstrap + readback**: schema bootstrap with honest readback verifiers
  (prove shapes exactly; never `coalesce(<check>, true)`).
- Only then does `memorySlice.available` flip true and the journey unlock in
  the web app.

## Stage A completion record (2026-09-01)

| Item | Value |
|---|---|
| Release commit (API image `testwired-v4`) | `ca9e261ea38d4cd4d0ebe80a464057e3d15c0f63` |
| Image digest | `sha256:800b9099392e51dd272fb6682483f6d04c00e590c20022b409c5df80ad6de871` |
| Judge API base | `https://helixctw-compliance-f2dbl6kvwa-ue.a.run.app/judge` |
| Judge console | `https://helixctw-gcp-testwired.vercel.app` (Vercel project `helixctw-gcp-testwired`, root `web/`) |
| Live evidence | `gcp` REALDEAL_TEST/CONNECTED (validated Cloud Run runtime), `cockroachdb` REALDEAL_TEST/CONNECTED (marker probe), all other rows SOURCE_ONLY/NOT_CONNECTED |
| Mutations | 503 `LIVE_PROVIDERS_NOT_CONNECTED` (verified); `memorySlice.available: false` |
| helixctw.com chooser | Google Cloud card hands off via `externalUrl` |

## Stage B completion record (2026-09-01)

| Item | Value |
|---|---|
| Release commit (API image `testwired-v7`) | `ebd1822c2f2d97489a3325f4eb45dc89b2694a79` |
| Image digest | `sha256:da3ff606ddecbbf2b0fdf39edf3d7362bcb75cb91f77a8d9bb64c44310efcf30` |
| Memory database | `mhelix_gcp_testwired` on `didz-testwired`; owner `mhelix_gcp_migrator` (NOLOGIN), runtime `mhelix_gcp_runtime` (least privilege, 25-grant matrix verified by 49 boolean readbacks) |
| Capability | `vector_memory_recall` release-bound row (rotated `f95112a` → `4c84e49` → `ebd1822`, one row at all times) |
| Live journey | All seven checkpoints + supplemental receipt retrieval verified in the production browser; recall returns 2 vector matches; denial returns zero protected fields; rebuild preserves the evidence commitment |
| Receipt evidence | Fetched receipts bind the stored original GCP request (`LIVE_TESTWIRED`/`REALDEAL_TEST`); Midnight stays `SOURCE_ONLY` (deterministic fixture, never promoted) |
| Narration | Seven pre-generated `gemini-3.1-flash-tts-preview` "Charon" clips (static, -16 LUFS); Web Speech fallback |
| Tests | 73 service + 99 web, all passing |

## Decisions of record

| Decision | Choice |
|---|---|
| Scope | Staged: A = status/matrix/site, B = memory journey |
| Frontend home | `web/` in this repo, new Vercel project (frozen repo untouched) |
| Frontend URL | Vercel-generated first, `testwired-gcp.helixctw.com` later |
| Memory database | `mhelix_gcp_testwired` on `didz-testwired` (Stage B) |
| Embeddings | Deterministic synthetic (ported); no cloud model provider claimed |
| helixctw.com card | `externalUrl` handoff once Stage A site is live |
