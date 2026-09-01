// SPDX-License-Identifier: Apache-2.0
// Contract tests: the GCP compliance module must answer identically to the
// Cloudflare Worker for the same inputs.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateComplianceInput,
  runComplianceCheck,
} from "../src/compliance.js";
import {
  HELIXCTW_GCP_ENVIRONMENT_MARKER_MANIFEST,
  deriveEnvironmentMarkerCommitmentHex,
} from "../src/environment-marker.js";

const VALID_COMMITMENT = "a".repeat(64);
const CONTEXT = { environment: "testwired-test", midnightNetwork: "testnet-02" };

function validInput(overrides = {}) {
  return {
    requesterId: VALID_COMMITMENT,
    resourceClass: "property-deed",
    purposeCode: "query",
    jurisdiction: "US-NJ",
    ...overrides,
  };
}

test("rejects a missing requesterId", () => {
  const error = validateComplianceInput(validInput({ requesterId: "" }));
  assert.match(error, /Missing required field: requesterId/);
});

test("rejects a requesterId that is not a 32-byte hex commitment", () => {
  const error = validateComplianceInput(validInput({ requesterId: "raw-name" }));
  assert.match(error, /64 hex characters/);
});

test("rejects an unknown purposeCode", () => {
  const error = validateComplianceInput(validInput({ purposeCode: "surveillance" }));
  assert.match(error, /purposeCode must be/);
});

test("accepts a valid request", () => {
  assert.equal(validateComplianceInput(validInput()), null);
});

test("passes a clean request with low risk", () => {
  const receipt = runComplianceCheck(validInput(), CONTEXT);
  assert.equal(receipt.result, "pass");
  assert.equal(receipt.riskLevel, "low");
  assert.equal(receipt.trustScore, 0.9);
  assert.equal(receipt.environment, "testwired-test");
});

test("disclosure purpose lowers the trust score to 0.8", () => {
  const receipt = runComplianceCheck(validInput({ purposeCode: "disclosure" }), CONTEXT);
  assert.equal(receipt.result, "pass");
  assert.equal(receipt.trustScore, 0.8);
});

test("unknown jurisdiction fails high-risk", () => {
  const receipt = runComplianceCheck(validInput({ jurisdiction: "" }), CONTEXT);
  assert.equal(receipt.result, "fail");
  assert.equal(receipt.riskLevel, "high");
  assert.equal(receipt.jurisdiction, "UNKNOWN");
});

test("explicit deny fails with zero trust", () => {
  const receipt = runComplianceCheck(validInput({ decision: "deny" }), CONTEXT);
  assert.equal(receipt.result, "fail");
  assert.equal(receipt.trustScore, 0);
});

test("outstanding verifications yield pending", () => {
  const receipt = runComplianceCheck(
    validInput({ requiredVerifications: ["kyc-tier-2"] }),
    CONTEXT,
  );
  assert.equal(receipt.result, "pending");
  assert.deepEqual(receipt.requiredVerifications, ["kyc-tier-2"]);
});

test("receipt never echoes fields beyond the reviewed shape", () => {
  const receipt = runComplianceCheck(
    validInput({ rawName: "John Santi", ssn: "000-00-0000" }),
    CONTEXT,
  );
  assert.equal("rawName" in receipt, false);
  assert.equal("ssn" in receipt, false);
});

test("marker commitment derives deterministically from the manifest", () => {
  assert.match(deriveEnvironmentMarkerCommitmentHex(), /^[0-9a-f]{64}$/);
  assert.equal(HELIXCTW_GCP_ENVIRONMENT_MARKER_MANIFEST.buildStage, "TESTWIRED");
});
