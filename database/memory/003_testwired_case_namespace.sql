-- SPDX-License-Identifier: Apache-2.0
-- Adapted from MidnightHelixCTW/database/activation/003_testwired_case_namespace.sql
-- (same author, Apache-2.0) for the HelixCTW GCP Stage B database.
-- SOURCE_ONLY; this parameterized plain INSERT derives its commitment and
-- inserts nothing unless exactly the canonical GCP marker and a well-formed
-- release commit are present. Zero inserted rows is a fail-closed review event.

BEGIN;

INSERT INTO mhelix_gcp_testwired.mhelix_case_namespaces
  (marker_id, scenario_id, fixture_commitment, synthetic, release_commit)
SELECT marker.marker_id,
       'morrow-farmhouse-testwired-v1',
       digest(
         'mhelixctw/testtown-case/v1' || chr(10) ||
         'scenario=morrow-farmhouse-testwired-v1' || chr(10) ||
         'release=' || $1,
         'sha256'
       ),
       true,
       $1
  FROM mhelix_gcp_testwired.mhelix_environment_markers AS marker
 WHERE marker.marker_id = 'helixctw-gcp-testwired-environment'
   AND marker.build_stage = 'TESTWIRED'
   AND $1 ~ '^[0-9a-f]{40}$'
   AND (SELECT count(*)
          FROM mhelix_gcp_testwired.mhelix_environment_markers) = 1
   AND (SELECT count(*)
          FROM mhelix_gcp_testwired.mhelix_case_namespaces
         WHERE scenario_id = 'morrow-farmhouse-testwired-v1') = 0;

COMMIT;
