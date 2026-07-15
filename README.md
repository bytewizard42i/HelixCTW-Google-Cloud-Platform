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

---

## The DIDzM Premise

The world's digital verification system is on its head. You must submit large
amounts of personal information to prove a single thing — something that is
really just a yes-or-no question:

> *Does this person meet this minimum (or maximum) requirement?*

Midnight flips this by answering **only the necessary question** with
mathematical certainty of truthfulness for the asker:

- Are you old enough?
- Are you a non-felon?
- Do you have an XYZ degree?
- Do you have a valid driver's license?
- Do you live within X miles of the job you are applying for?
- Do you have allergies?
- Do you have medical insurance?
- Do you qualify for this loan?
- Do you have a reputation for XYZ?
- Do you rightfully own this asset?
- Do you have the authority to open this door?

Every question above is a **yes or no**. Today, answering any one of them
requires surrendering your full identity, your documents, your history, and your
privacy to a stranger who will store it in a database that will eventually be
breached. DIDzM answers each with a zero-knowledge proof — mathematically
certain, cryptographically verifiable, and revealing **nothing** beyond the
answer itself. HelixCTW is the **data layer** that makes those proofs fast to
query, agent-accessible, and globally available — without ever exposing the
underlying raw data.

## Repository Map

| Path | What It Is |
|---|---|
| [`infra/terraform/`](infra/terraform/) | GCP Terraform: Cloud Run, GCS, Secret Manager, IAM |
| [`docs/GCP_TERRAFORM.md`](docs/GCP_TERRAFORM.md) | How the GCP edition is provisioned, service-by-service |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Pointer to the canonical HelixCTW architecture |
| [MULTI_CLOUD_DISTRIBUTION.md](https://github.com/bytewizard42i/HelixCTW/blob/main/docs/MULTI_CLOUD_DISTRIBUTION.md) | The RAID-array-of-clouds model: load balancing + erasure coding across AWS/GCP/Cloudflare (canonical, in the AWS repo) |

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
