# HelixCTW GCP Infrastructure (Terraform)

Reusable IaC for running the **HelixCTW** data plane on Google Cloud Platform.

> **STATUS: STARTER SCAFFOLD — not yet applied.** Nothing here has been
> `terraform apply`-ed. Review, wire up providers/backends, and run
> `terraform plan` before any real use.

See [`../../docs/GCP_TERRAFORM.md`](../../docs/GCP_TERRAFORM.md) for the full
service mapping, rationale, and workflow.

## Layout

```
infra/terraform/
  modules/
    helixctw-gcp/          # per-app: Cloud Run svc + GCS bucket + SA + secret
  environments/
    dev/                   # instantiates the module for the hackathon demo
```

## The idea

A small, reusable module (`helixctw-gcp`) makes every app integrate
**identically** on GCP instead of each repo hand-rolling its own Cloud Run
service, bucket, service account, and secret handling. One module, instantiated
once per app, gives us:

- consistent least-privilege access (per-app service account + explicit IAM)
- consistent secret delivery (Secret Manager)
- a single declarative place listing which app may touch which class of data

## What is (and isn't) in Terraform

- **In**: Cloud Run service, GCS bucket, Secret Manager secret, service account
  + IAM bindings, enabled project APIs.
- **Out (on purpose)**: schema migrations, Midnight contracts, ZK circuits,
  on-chain state.
