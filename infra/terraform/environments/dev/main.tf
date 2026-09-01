# =============================================================================
# HelixCTW GCP edition — dev/TestWired environment
#
# LEARNING NOTES (John):
# - This file "calls" the helixctw-gcp module with real values.
# - `backend "gcs"` stores terraform.tfstate in a GCS bucket instead of on
#   this laptop, so any machine (or sister) can plan/apply consistently.
#   The state bucket is created once, by hand, BEFORE `terraform init`:
#     gsutil mb -p helixctw-gcp-testwired -l us-east1 gs://helixctw-gcp-testwired-tfstate
# - The database URL is never written here. Export it just-in-time:
#     export TF_VAR_database_url="postgresql://..."   (from the secrets folder)
#
# Workflow:
#   terraform init
#   terraform plan    # review with John before anything changes
#   terraform apply
# =============================================================================

terraform {
  required_version = ">= 1.6.0"

  backend "gcs" {
    bucket = "helixctw-gcp-testwired-tfstate"
    prefix = "env/dev"
  }
}

provider "google" {
  project = "helixctw-gcp-testwired"
  region  = "us-east1"
}

module "helixctw" {
  source = "../../modules/helixctw-gcp"

  project_id          = "helixctw-gcp-testwired"
  region              = "us-east1"
  environment         = "testwired-dev"
  container_image     = var.container_image
  database_url        = var.database_url
  vector_database_url = var.vector_database_url
  release_commit      = var.release_commit

  # Browser origins that may call this API: the shared frontend (Cloudflare
  # Pages at helixctw.com) plus localhost for development.
  allowed_origins = [
    "https://helixctw.com",
    "https://www.helixctw.com",
    "https://helixctw-gcp-testwired.vercel.app",
    "https://helixctw-gcp-testwired-enterpisezk-labs-projects.vercel.app",
    "http://localhost:5173",
    "http://localhost:5178",
  ]
}

variable "container_image" {
  description = "Image to deploy, e.g. us-east1-docker.pkg.dev/helixctw-gcp-testwired/helixctw/compliance:TAG"
  type        = string
}

variable "release_commit" {
  description = "Git commit the deployed container was built from, e.g. $(git rev-parse HEAD)"
  type        = string
}

variable "database_url" {
  description = "didz-testwired read-only probe URL (TF_VAR_database_url; never commit)"
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "vector_database_url" {
  description = "Dedicated Stage B runtime URL (TF_VAR_vector_database_url; never commit)"
  type        = string
  sensitive   = true
  ephemeral   = true
}

output "service_url" {
  value = module.helixctw.service_url
}

output "receipts_bucket" {
  value = module.helixctw.receipts_bucket
}
