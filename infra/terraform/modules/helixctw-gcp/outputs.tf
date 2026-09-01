# Outputs surface the values the frontend and smoke tests need.

output "service_url" {
  description = "The live Cloud Run URL (https://....run.app)"
  value       = google_cloud_run_v2_service.compliance.uri
}

output "receipts_bucket" {
  description = "GCS bucket holding audit receipts"
  value       = google_storage_bucket.receipts.name
}

output "service_account_email" {
  description = "The service's least-privilege identity"
  value       = google_service_account.service.email
}

output "artifact_repository" {
  description = "Artifact Registry repo for container images"
  value       = google_artifact_registry_repository.images.repository_id
}
