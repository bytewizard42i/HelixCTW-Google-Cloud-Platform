# TestWire Plan — HelixCTW Google Cloud Edition (handoff to Sol5.6)

> Written by Penny, 2026-09-01, after a deep dive across the HelixCTW repos.
> Goal: a **live, honest, TestWired** GCP backend that Charles Hoskinson can
> mention in his Google meeting — "the same HelixCTW protocol, live on Google
> Cloud, a Midnight partner, third leg of the RAID-of-clouds."

## Decisions already made with John (2026-09-01)

| Decision | Answer |
|---|---|
| GCP project | **New project.** Display name: `helixctw-google-cloud-testwired`. Project ID: `helixctw-gcp-testwired` (IDs are capped at 30 chars; the full name is 31). |
| CockroachDB probe in v1 | **Yes** — read-only probe against the **didz-testwired** cluster. The `helixchain-hackathon` cluster is **FROZEN until judging clears — never touch it.** |
| Domain | **Custom domain `api-gcp.helixctw.com`** (Cloudflare DNS + Cloud Run domain mapping). Fall back to the raw `*.run.app` URL if DNS drags; don't block the demo on it. |
| Secrets folder | Create `/home/js/GoogleCloud-secrets-folder/` (WSL side, mirrors `Cloudflare-secrets-folder` etc.). Penny created it with a README. **Never commit anything from it.** |

## State of the world (verified 2026-09-01)

- **This repo is an empty scaffold.** `infra/terraform/modules/helixctw-gcp/` and
  `environments/dev/` contain only `.gitkeep`. Docs describe the intent:
  `docs/GCP_TERRAFORM.md`.
- **The frontend** lives at `HelixCTW-Cloudflare/frontend-demoland` (deployed at
  helixctw.com). Its GCP card exists but `apiBase: ''` — see
  `src/config.ts` (BACKENDS.gcp) and `src/BackendGate.tsx` (BUILD_STEPS.gcp,
  currently pure theatre with setTimeout).
- **The API contract to port** is the Cloudflare compliance Worker:
  `HelixCTW-Cloudflare/infra/terraform/environments/cloudflare/worker.js` (~170
  lines). Contract:
  - `GET /` → `{ ok, service, environment, midnightNetwork }` status JSON
  - `POST /` (application/json) → compliance check:
    - required: `requesterId` (32-byte commitment, 64 hex), `resourceClass`, `purposeCode` (one of transfer|disclosure|query|compliance)
    - optional: `objectId` (64 hex), `jurisdiction`, `decision` (allow|deny|pending), `requiredVerifications[]`
    - deterministic `evaluateCompliance` → pass/fail/pending + riskLevel + trustScore
    - writes an audit receipt to object storage at `compliance/YYYY-MM-DD/<auditId>.json`
    - responds `{ ok, compliance: receipt, auditStored, persistenceNote }`
- **Heads-up:** `api.helixctw.com` (the Cloudflare Worker) currently returns
  **522** — origin down. Not our job here, but worth telling John; the GCP
  edition may end up the *only* live non-AWS backend.
- **Local tooling:** `gcloud` SDK 546 at `/home/js/google-cloud-sdk/bin/gcloud`
  — **not authenticated, no project set**. Terraform at `/home/js/.local/bin/terraform`.
  Docker Desktop via Windows (see MidnightHelixCTW/AGENTS.md for its quirks).
- **Secrets (paths only — never print or commit values):**
  - CockroachDB: `/home/js/PixyPi/.mcp-credentials/cockroachdb/didz-testwired.md`
    (active, OK to use) and `helixchain-hackathon.md` (**FROZEN — do not use**).
  - New GCP artifacts (service-account keys if any, project notes) go in
    `/home/js/GoogleCloud-secrets-folder/`.

## Post-plan rulings from John
- 2026-09-01: Account of record is recorded in `/home/js/GoogleCloud-secrets-folder/README.md`
  (johnmsanti@gmail.com; project `helixctw-gcp-testwired` created, billing linked).
  Always record account/billing choices there for later sessions.
- 2026-09-01: Once the marker table is live, feel free to use the **TestTown
  repo** (TestTownDIDz) to aggregate synthetic test data into the
  `helix_testtown` database — it already holds the seeded TestTown corpus
  (20 citizens, 4 assets, 35 doc-index rows).

## Phases

### Phase 0 — John (interactive, can't be automated)
1. `gcloud auth login` and `gcloud auth application-default login`
2. Create project: `gcloud projects create helixctw-gcp-testwired --name="helixctw-google-cloud-testwired"`
3. Attach billing (console or `gcloud billing projects link`)
4. `gcloud config set project helixctw-gcp-testwired`

Narrate each command for John (learning-first workflow rule) — he's watching.

### Phase 1 — The service (`apps/` or `service/` in this repo)

**Reuse ruling (John, 2026-09-01): do not reinvent the AWS edition's wheels.**
Copy from `MidnightHelixCTW/apps/api/src/` (Apache-2.0, add attribution notes):
- `cockroachdb-provider.js` — read-only environment-marker probe; driver-agnostic,
  fail-closed, leaks no connection details. Reuse nearly verbatim.
- `cockroach-query-executor.js` — bounded pg pool that only permits the canonical
  probe statement; reviewed timeouts + CA validation. Reuse nearly verbatim.
- `environment-marker.js` — marker manifest pattern. Mint a NEW manifest for this
  edition (`helixctw-gcp/environment-marker/v1`, buildStage TESTWIRED) — do not
  reuse the mhelix marker values.
- `handler.js` — reuse as a *pattern* only (status vocabulary, `providers` block,
  fail-closed 503 `LIVE_PROVIDERS_NOT_CONNECTED`, CORS allowlist checked before
  route logic, `/healthz` + `/api/v1/status` routes).

**Marker table:** the AWS probe reads the FROZEN hackathon cluster — we don't.
Write a small migration creating an equivalent environment-marker table + one
canonical row on the **didz-testwired** cluster (active for experiments), and
point the probe there. Same proof discipline: the readback is the evidence.

**Not applicable to GCP:** the Lambda packaging traps in MidnightHelixCTW's
AGENTS.md (workspace-excluding Makefile) — the container ships node_modules.
Vector memory is out of scope for GCP v1.

- Small **self-contained** Node app (Express or plain http), containerized.
  Port of worker.js semantics, plus:
  - `GET /api/v1/status` — TestWired status probe: reports service identity,
    edition `gcp`, GCS binding state, and a **read-only** CockroachDB probe
    (bounded SELECT of an environment marker — mirror the AWS edition's honest
    `REALDEAL_TEST` / `CONNECTED` pattern from MidnightHelixCTW).
  - Receipts to **GCS** via `@google-cloud/storage` (ADC on Cloud Run — no key files).
  - CRDB connection string from **Secret Manager**, injected as a secret env var
    by Terraform. Fail closed: if the secret or DB is unreachable, status says
    `NOT_CONNECTED`; never fake it.
- Use TestWired vocabulary honestly (see MidnightHelixCTW/AGENTS.md "Status
  vocabulary"): real transport, synthetic data only, no PII, commitments not
  identities.

### Phase 2 — Terraform (fill the scaffold)
`infra/terraform/modules/helixctw-gcp/`:
- `google_cloud_run_v2_service` (public ingress, min instances 0)
- `google_storage_bucket` — audit receipts, 30-day lifecycle delete rule
  (mirrors the R2/S3 editions), uniform bucket-level access
- `google_secret_manager_secret` + version for the CRDB connection string
  (value supplied via variable at apply time — **never in HCL/git**)
- `google_service_account` + least-privilege bindings:
  `roles/storage.objectCreator` on the bucket, `roles/secretmanager.secretAccessor`
  on the one secret
- `google_project_service` for run, storage, secretmanager, artifactregistry
- `google_artifact_registry_repository` for the container image

`environments/dev/`: instantiates the module; `backend "gcs"` remote state in a
dedicated state bucket (create it first, outside TF state).

Follow the AWS/Cloudflare editions' Terraform style (verbose learning comments
are welcome in infra per John's rules — this is not audit-frozen code).

### Phase 3 — Build + deploy + evidence
1. `docker build` → push to Artifact Registry (or `gcloud builds submit`)
2. `terraform init/plan/apply` in `environments/dev` (plan reviewed with John)
3. Smoke: `curl` the status endpoint + one POST compliance check; capture the
   JSON as evidence in `docs/` (sanitized)

### Phase 4 — Wire the frontend (HelixCTW-Cloudflare repo)
1. `src/config.ts`: set `BACKENDS.gcp.apiBase` to the live URL
2. `src/BackendGate.tsx`: make the GCP spin-up sequence perform a **real**
   `GET /api/v1/status` fetch — show real connect result, fail closed with an
   honest error if down (no theatre for a live edition)
3. Redeploy the frontend; then Cloud Run domain mapping + Cloudflare DNS CNAME
   for `api-gcp.helixctw.com` (proxied off / DNS-only at first — Cloud Run
   manages its own TLS cert and needs to see the hostname)

### Phase 5 — Docs + cleanup
- Flip this repo's README status line from "Infrastructure scaffold" to the
  honest new state (e.g. "TestWired: Cloud Run + GCS live, CockroachDB probe
  CONNECTED") with evidence pointers
- Update the multi-cloud table in `HelixCTW/docs/MULTI_CLOUD_DISTRIBUTION.md`
- "Clean up" per John's global rules: commit + push each touched repo
  (HelixCTW-Google-Cloud-Platform, HelixCTW-Cloudflare, monolith gitlinks)

## Guardrails
- **Never** touch the `helixchain-hackathon` cluster or MidnightHelixCTW's
  deployed stack — frozen for judging.
- **Never** commit secrets; connection strings live only in Secret Manager and
  `/home/js/GoogleCloud-secrets-folder/`.
- Honest status labels only — a green build is not a deployment, a deployment
  is not a DB connection. Evidence = curl readbacks, recorded after the fact.
- Plain `git push` only; no force-push, no history rewrites.
- Narrate terminal commands for John (learning-first rule).

## The soundbite this buys
> "HelixCTW — the privacy-preserving data plane of the DIDzM ecosystem on
> Midnight — now runs live on Google Cloud: Cloud Run + Cloud Storage + Secret
> Manager, declared entirely in Terraform, sharing one CockroachDB data layer
> with its AWS and Cloudflare siblings. Same protocol, three clouds, zero
> vendor lock-in — on a Midnight partner's infrastructure."
