# HelixCTW — Google Cloud Platform Edition

> **HelixCTW is not a chain. It is the weave.**
> This repository is the **Google Cloud Platform (GCP)** infrastructure variation
> of the HelixCTW privacy-preserving data plane. It is a sibling to the
> [AWS edition](https://github.com/bytewizard42i/HelixCTW) and the
> [Cloudflare edition](https://github.com/bytewizard42i/HelixCTW-Cloudflare),
> proving the same protocol runs identically across three clouds with zero
> vendor lock-in.

**DIDzM role**: Data-layer engine (cloud infrastructure variation)
**Status**: Infrastructure scaffold — not yet applied, not audited, not production deployed

---

## Why a Google Cloud Version

Google Cloud is an **existing Midnight Network partner**, which makes GCP a
natural third target for the HelixCTW protocol. Standing up a GCP edition:

- **Strengthens the portability story** — "the same protocol on three clouds" is
  a far more convincing proof of zero vendor lock-in than two.
- **Showcases a partner cloud** — aligns HelixCTW with the Midnight ecosystem's
  own infrastructure relationships.
- **Serves the hackathon + accelerator narrative** — a clean, reproducible GCP
  variation for the CockroachDB hackathon and the Draper University accelerator.

This serves **IOG's purpose**: the same principles that make blockchains
trustworthy — determinism, reproducibility, and openness — applied to the cloud
infrastructure beneath the weave. Every GCP resource is declared as code, in
Terraform, committed to git, and applied through a plan-and-apply workflow.

## The Frontend Lives Elsewhere

There is **one** HelixCTW frontend, and it lives in
[`HelixCTW-Cloudflare/frontend-demoland`](https://github.com/bytewizard42i/HelixCTW-Cloudflare).
It is backend-aware: a visitor picks Cloudflare, AWS, or GCP on the "Choose your
backend" landing page, and the same React app renders that cloud's labels, build
sequence, and endpoints. **This repository does not contain UI** — it is the GCP
infrastructure (Terraform) that the GCP edition points at.

## GCP Service Mapping

The HelixCTW layers map onto Google Cloud primitives as follows:

| HelixCTW layer | AWS | Cloudflare | **Google Cloud** |
|---|---|---|---|
| Edge / compute | Lambda | Workers | **Cloud Run** (containers) / Cloud Functions |
| Object storage | S3 | R2 | **Cloud Storage (GCS)** |
| Secrets | Secrets Manager | Workers Secrets | **Secret Manager** |
| Hot index | CockroachDB | CockroachDB | **CockroachDB** (unchanged) |
| Cold truth | Filecoin | Filecoin | **Filecoin** (unchanged) |
| Trust plane | Midnight | Midnight | **Midnight** (unchanged) |
| AI inference | Bedrock | Anthropic API | **Vertex AI** / Anthropic API |

CockroachDB, Filecoin, and Midnight are identical across all three clouds — only
the edge compute, object storage, secrets, and (optionally) the inference
provider change.

## Repository Map

| Path | What It Is |
|---|---|
| [`infra/terraform/`](infra/terraform/) | GCP Terraform: Cloud Run, GCS, Secret Manager, IAM |
| [`docs/GCP_TERRAFORM.md`](docs/GCP_TERRAFORM.md) | How the GCP edition is provisioned, service-by-service |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Pointer to the canonical HelixCTW architecture |

## Companion Repositories

- [`HelixCTW`](https://github.com/bytewizard42i/HelixCTW) — AWS edition + canonical architecture docs
- [`HelixCTW-Cloudflare`](https://github.com/bytewizard42i/HelixCTW-Cloudflare) — Cloudflare edition + the shared frontend

---

## Author

**John M. Santi** — @realjohnny5i on X, @johnny5i on Discord
Midnight Network Ambassador · Creator of the DIDzM ecosystem

---

*HelixCTW GCP edition established July 14, 2026. A Midnight-partner cloud
variation of the HelixCTW protocol.*
