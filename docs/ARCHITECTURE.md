# HelixCTW Architecture — GCP Edition

The canonical HelixCTW architecture (five strands, three planes, data flows,
trust model, the reconstructibility discipline) is documented once, in the AWS
edition:

- **Canonical architecture**: [`bytewizard42i/HelixCTW/docs/ARCHITECTURE.md`](https://github.com/bytewizard42i/HelixCTW/blob/main/docs/ARCHITECTURE.md)

This repository does **not** redefine the architecture. It only describes how the
architecture is realized on **Google Cloud Platform**. The trust plane
(Midnight), identity plane (DIDzM), hot index (CockroachDB), and cold truth
(Filecoin) are cloud-agnostic and identical across the AWS, Cloudflare, and GCP
editions.

## What changes on GCP

Only the infrastructure *beneath* the weave changes. See
[`GCP_TERRAFORM.md`](GCP_TERRAFORM.md) for the service-by-service mapping and
Terraform layout:

- **Edge / compute** — Cloud Run (or Cloud Functions) instead of Lambda / Workers
- **Object storage** — Cloud Storage (GCS) instead of S3 / R2
- **Secrets** — Secret Manager instead of AWS Secrets Manager / Workers Secrets
- **AI inference** — Vertex AI or the direct Anthropic API

## What does NOT change

Terraform provisions and manages **cloud infrastructure only**. It does not
affect, and must never be confused with:

- Midnight smart contracts / Compact circuits
- ZK proof generation or verification
- On-chain state, commitments, or settlement

These live on the Midnight Network and are identical regardless of which cloud
hosts the edge and storage layers.
