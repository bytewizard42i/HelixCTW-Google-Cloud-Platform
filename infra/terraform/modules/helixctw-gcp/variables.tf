# Inputs for the helixctw-gcp module. Values are supplied by the calling
# environment (environments/dev). Only database_url is sensitive.

variable "project_id" {
  description = "GCP project ID (helixctw-gcp-testwired)"
  type        = string
}

variable "region" {
  description = "GCP region. us-east1 sits closest to the didz-testwired CockroachDB cluster (AWS us-east-1)."
  type        = string
  default     = "us-east1"
}

variable "container_image" {
  description = "Full Artifact Registry image reference for the compliance service"
  type        = string
}

variable "environment" {
  description = "Environment label reported by the service (e.g. testwired-dev)"
  type        = string
  default     = "testwired-dev"
}

variable "midnight_network_id" {
  description = "Midnight network the service reports (informational)"
  type        = string
  default     = "testnet-02"
}

variable "allowed_origins" {
  description = "Browser origins allowed by CORS (the frontend hosts)"
  type        = list(string)
  default     = []
}

variable "release_commit" {
  description = "40-hex git commit the deployed image was built from. The judge API reports it as releaseCommit; the browser refuses mutations unless health and status agree on it."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.release_commit))
    error_message = "release_commit must be a 40-character lowercase git commit hash."
  }
}

variable "database_url" {
  description = "CockroachDB connection URL for the didz-testwired cluster. Provide via TF_VAR_database_url — NEVER commit it."
  type        = string
  sensitive   = true
  ephemeral   = true # write-only: excluded from plan/state files
}
