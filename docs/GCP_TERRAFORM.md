# HelixCTW on Google Cloud Platform — Terraform

> **STATUS: STARTER SCAFFOLD — not yet applied.** These files describe the
> intended pattern. Nothing here has been `terraform apply`-ed. Review, wire up
> providers/backends, and run `terraform plan` before any real use.

This document explains how the **GCP edition** of HelixCTW is provisioned. It
mirrors the AWS edition's [`TERRAFORM.md`](https://github.com/bytewizard42i/HelixCTW/blob/main/docs/TERRAFORM.md)
and the Cloudflare edition's `CLOUDFLARE_TERRAFORM.md`, so the three clouds stay
conceptually aligned.

## Why Terraform

The same reasoning as every HelixCTW edition: infrastructure as code brings
**IOG's purpose** — determinism, reproducibility, openness — to the cloud. Every
GCP resource is declared in HCL, committed to git, reviewed in pull requests, and
applied through a plan-and-apply workflow. No manual console clicks, no
configuration drift, no hidden state.

## GCP Service Mapping

| HelixCTW need | GCP service | Terraform resource / provider |
|---|---|---|
| Edge compute (compliance runner, gateway) | **Cloud Run** | `google_cloud_run_v2_service` |
| Alternative compute | **Cloud Functions (2nd gen)** | `google_cloudfunctions2_function` |
| Object storage (encrypted blobs, audit receipts) | **Cloud Storage** | `google_storage_bucket` |
| Secrets (connection strings, API keys) | **Secret Manager** | `google_secret_manager_secret` + `_version` |
| Service identity / least privilege | **IAM** | `google_service_account`, `google_project_iam_member` |
| AI inference (optional) | **Vertex AI** or Anthropic API | `google_project_service` (aiplatform) |
| Hot index | **CockroachDB** (cloud-agnostic) | CockroachDB provider |

## Intended Layout

```
infra/terraform/
  modules/
    helixctw-gcp/          # per-app: Cloud Run svc + GCS bucket + SA + secret
  environments/
    dev/                   # instantiates the module for the hackathon demo
```

## What is (and isn't) in Terraform

- **In**: Cloud Run services, GCS buckets, Secret Manager secrets, service
  accounts + IAM bindings, enabled project APIs, CockroachDB app database/role.
- **Out (on purpose)**: Midnight contracts, ZK circuits, on-chain state; database
  schema migrations (run via the app's own tooling, not IaC).

## Prerequisites (when you wire this up)

- A GCP project with billing enabled
- `gcloud` authenticated (`gcloud auth application-default login`)
- The `google` and `google-beta` Terraform providers
- A remote state backend (a GCS bucket for `terraform { backend "gcs" {} }`)

## Workflow

```bash
cd infra/terraform/environments/dev
terraform init
terraform plan     # review — nothing changes without your approval
terraform apply    # provision the GCP edition
```

## Beyond one cloud — the RAID-array-of-clouds model

GCP is one of three cloud editions. The production vision is not "pick one cloud"
but **active-active across all three** — a global load balancer distributing the
stateless edge, and encrypted object storage replicated (RAID-1) or erasure-coded
(RAID-5/6) across AWS, GCP, and Cloudflare, so no single cloud is a point of
failure, capture, or trust. Terraform's multi-provider model (`aws` + `google` +
`cloudflare` in one config) is what makes this tractable, and HelixCTW's privacy
discipline (client-side encryption, commitments-not-PII, ZK identity) is what
makes it safe.

Full analysis, caveats, and repo pointers:
[`HelixCTW/docs/MULTI_CLOUD_DISTRIBUTION.md`](https://github.com/bytewizard42i/HelixCTW/blob/main/docs/MULTI_CLOUD_DISTRIBUTION.md).

## Cost Notes

- **Cloud Run** — scales to zero; you pay per request + CPU/memory while serving.
  Comparable cold-start story to Lambda, generally better than it.
- **Cloud Storage** — standard object pricing; egress applies (unlike Cloudflare
  R2's zero egress, so R2 remains cheaper for heavy-egress workloads).
- **Secret Manager** — per-secret-version + per-access pricing (negligible at
  demo scale).

---

*GCP Terraform scaffold established July 14, 2026.*
