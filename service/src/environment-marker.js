// SPDX-License-Identifier: Apache-2.0
// Pattern reused with attribution from MidnightHelixCTW/apps/api/src/environment-marker.js
// (same author, Apache-2.0). New manifest values for the GCP edition.

import { createHash } from "node:crypto";

/**
 * The single handwritten machine-readable authority for the HelixCTW GCP
 * edition's TestWired environment marker. The database row on the
 * didz-testwired cluster is a projection of this manifest; it must never
 * become an alternate source of truth.
 */
export const HELIXCTW_GCP_ENVIRONMENT_MARKER_MANIFEST = Object.freeze({
  domainSeparator: "helixctw-gcp/environment-marker/v1",
  markerId: "helixctw-gcp-testwired-environment",
  buildStage: "TESTWIRED",
  markerVersion: 1,
  migrationId: "001_gcp_environment_marker",
  sourceFileName: "database/migrations/001_gcp_environment_marker.sql",
  // sha256 of the migration file; scripts/derive-marker.mjs recomputes and
  // verifies this value. Update it whenever the migration file changes.
  migrationSha256:
    "23003de5b457cbd6c41a65a851acbb48950d10357475dcf679f8feb40dfb898f",
  statementCount: 2,
});

export const HELIXCTW_GCP_ENVIRONMENT_MARKER_ID =
  HELIXCTW_GCP_ENVIRONMENT_MARKER_MANIFEST.markerId;
export const HELIXCTW_GCP_ENVIRONMENT_MARKER_BUILD_STAGE =
  HELIXCTW_GCP_ENVIRONMENT_MARKER_MANIFEST.buildStage;
export const HELIXCTW_GCP_ENVIRONMENT_MARKER_VERSION =
  HELIXCTW_GCP_ENVIRONMENT_MARKER_MANIFEST.markerVersion;

/**
 * Serialize the canonical eight-line UTF-8 preimage. LF separates fields.
 * No trailing LF, CR, BOM, space, or tab.
 */
export function serializeEnvironmentMarkerPreimage() {
  const manifest = HELIXCTW_GCP_ENVIRONMENT_MARKER_MANIFEST;

  return [
    manifest.domainSeparator,
    `marker_id=${manifest.markerId}`,
    `build_stage=${manifest.buildStage}`,
    `marker_version=${manifest.markerVersion}`,
    `migration_id=${manifest.migrationId}`,
    `source_file_name=${manifest.sourceFileName}`,
    `migration_sha256=${manifest.migrationSha256}`,
    `statement_count=${manifest.statementCount}`,
  ].join("\n");
}

export function createEnvironmentMarkerPreimageBytes() {
  return Buffer.from(serializeEnvironmentMarkerPreimage(), "utf8");
}

/**
 * Derive the public SHA-256 commitment from the canonical bytes. Detects
 * configuration drift; not a secret, signature, or proof of execution.
 */
export function deriveEnvironmentMarkerCommitmentHex() {
  return createHash("sha256")
    .update(createEnvironmentMarkerPreimageBytes())
    .digest("hex");
}

export const HELIXCTW_GCP_ENVIRONMENT_MARKER_COMMITMENT_HEX =
  deriveEnvironmentMarkerCommitmentHex();
