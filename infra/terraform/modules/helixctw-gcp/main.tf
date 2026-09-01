# =============================================================================
# HelixCTW GCP module — one complete edition: Cloud Run + GCS + Secret Manager
#
# LEARNING NOTES (John):
# - A Terraform MODULE is a reusable bundle of resources with variables in and
#   outputs out — like a function. environments/dev/main.tf "calls" it.
# - Each `resource` block declares ONE cloud object. Terraform compares the
#   declared state against reality and shows the difference at `plan` time.
# - Nothing here contains a secret. The database URL arrives as a *variable*
#   at apply time and lands only inside Secret Manager.
# =============================================================================

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0"
    }
  }
}

# --- Enable the project APIs we use ------------------------------------------
# GCP projects start with most APIs off; each must be switched on once.
# for_each turns the set into one google_project_service resource per API.
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",              # Cloud Run
    "storage.googleapis.com",          # Cloud Storage (GCS)
    "secretmanager.googleapis.com",    # Secret Manager
    "artifactregistry.googleapis.com", # container image registry
    "cloudbuild.googleapis.com",       # Cloud Build (builds containers in GCP)
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false # leave APIs on even if this module is destroyed
}

# --- Artifact Registry: where the container image lives -----------------------
resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = "helixctw"
  description   = "HelixCTW GCP edition container images"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

# --- Service account: the service's own least-privilege identity --------------
# Cloud Run runs *as* this account. It gets exactly two permissions below:
# write objects into the receipts bucket, and read the one database secret.
resource "google_service_account" "service" {
  project      = var.project_id
  account_id   = "helixctw-compliance"
  display_name = "HelixCTW compliance service (Cloud Run)"
}

# --- GCS bucket: audit receipts (the R2/S3 counterpart) -----------------------
resource "google_storage_bucket" "receipts" {
  project  = var.project_id
  name     = "${var.project_id}-audit-receipts"
  location = var.region

  # Uniform access = IAM only, no per-object ACL surprises.
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Same 30-day expiry as the R2 and S3 editions.
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.apis]
}

# objectCreator = can write new objects, cannot read, list, or delete.
# Write-only is exactly right for an audit trail.
resource "google_storage_bucket_iam_member" "service_writes_receipts" {
  bucket = google_storage_bucket.receipts.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.service.email}"
}

# --- Secret Manager: the CockroachDB connection URL ---------------------------
resource "google_secret_manager_secret" "database_url" {
  project   = var.project_id
  secret_id = "helixctw-gcp-db-url"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret                 = google_secret_manager_secret.database_url.id
  secret_data_wo         = var.database_url # write-only: never stored in TF state
  secret_data_wo_version = 1
}

resource "google_secret_manager_secret_iam_member" "service_reads_db_url" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service.email}"
}

# The Stage B memory journey uses a separate least-privilege database identity.
# Keeping it in a separate secret prevents the broad migration credential from
# ever entering the Cloud Run runtime.
resource "google_secret_manager_secret" "vector_database_url" {
  project   = var.project_id
  secret_id = "helixctw-gcp-vector-db-url"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "vector_database_url" {
  secret                 = google_secret_manager_secret.vector_database_url.id
  secret_data_wo         = var.vector_database_url # write-only: never stored in TF state
  secret_data_wo_version = 1
}

resource "google_secret_manager_secret_iam_member" "service_reads_vector_db_url" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.vector_database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service.email}"
}

# --- Cloud Run: the compliance service ----------------------------------------
resource "google_cloud_run_v2_service" "compliance" {
  project  = var.project_id
  location = var.region
  name     = "helixctw-compliance"
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.service.email

    scaling {
      min_instance_count = 0 # scale to zero: costs nothing while idle
      max_instance_count = 3 # demo-scale ceiling
    }

    containers {
      image = var.container_image

      env {
        name  = "HELIXCTW_ENVIRONMENT"
        value = var.environment
      }
      env {
        name  = "MIDNIGHT_NETWORK_ID"
        value = var.midnight_network_id
      }
      env {
        name  = "HELIXCTW_RECEIPTS_BUCKET"
        value = google_storage_bucket.receipts.name
      }
      env {
        name  = "HELIXCTW_ALLOWED_ORIGINS"
        value = join(",", var.allowed_origins)
      }
      # Consumed by the ported judge API (/judge): the release the image was
      # built from, and the region for Cloud Run runtime validation.
      env {
        name  = "HELIXCTW_RELEASE_COMMIT"
        value = var.release_commit
      }
      env {
        name  = "HELIXCTW_GCP_REGION"
        value = var.region
      }
      # The secret is mounted as an env var straight from Secret Manager —
      # it never passes through Terraform state or the container image.
      env {
        name = "HELIXCTW_GCP_DB_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "HELIXCTW_GCP_VECTOR_DB_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.vector_database_url.secret_id
            version = "latest"
          }
        }
      }

      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_iam_member.service_reads_db_url,
    google_secret_manager_secret_version.vector_database_url,
    google_secret_manager_secret_iam_member.service_reads_vector_db_url,
  ]
}

# --- Public access: anyone may invoke (it's a public TestWired API) -----------
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.compliance.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
