// SPDX-License-Identifier: Apache-2.0
// Port of the HelixCTW Cloudflare compliance Worker
// (HelixCTW-Cloudflare/infra/terraform/environments/cloudflare/worker.js) to a
// pure Node module, so the GCP edition answers the identical contract.

import { randomUUID } from "node:crypto";

const HEX_32_BYTES = /^[0-9a-fA-F]{64}$/;
const ALLOWED_DECISIONS = new Set(["allow", "deny", "pending"]);
const ALLOWED_PURPOSES = new Set([
  "transfer",
  "disclosure",
  "query",
  "compliance",
]);
const HIGH_RISK_JURISDICTIONS = new Set(["UNKNOWN", "RESTRICTED"]);

function normalise(value) {
  return typeof value === "string" ? value.trim() : "";
}

function evaluateCompliance(input) {
  const jurisdiction = normalise(input.jurisdiction).toUpperCase() || "UNKNOWN";
  const requestedDecision = normalise(input.decision).toLowerCase() || "pending";
  const purposeCode = normalise(input.purposeCode).toLowerCase();
  const requiredVerifications = Array.isArray(input.requiredVerifications)
    ? input.requiredVerifications.filter((item) => typeof item === "string")
    : [];

  if (HIGH_RISK_JURISDICTIONS.has(jurisdiction)) {
    return {
      result: "fail",
      riskLevel: "high",
      trustScore: 0.1,
      reason: "Jurisdiction requires enhanced review.",
      requiredVerifications,
    };
  }

  if (requestedDecision === "deny") {
    return {
      result: "fail",
      riskLevel: "high",
      trustScore: 0,
      reason: "Request was explicitly denied by the caller.",
      requiredVerifications,
    };
  }

  if (requiredVerifications.length > 0) {
    return {
      result: "pending",
      riskLevel: "medium",
      trustScore: 0.5,
      reason: "Required verifications are outstanding.",
      requiredVerifications,
    };
  }

  return {
    result: "pass",
    riskLevel: "low",
    trustScore: purposeCode === "disclosure" ? 0.8 : 0.9,
    reason: "No blocking compliance rule matched.",
    requiredVerifications,
  };
}

/**
 * Validate a compliance-check request body. Returns an error string, or null
 * when the input is acceptable. Identical rules to the Cloudflare Worker:
 * commitments in, no raw identity ever.
 */
export function validateComplianceInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "Request body must be a JSON object.";
  }

  const required = ["requesterId", "resourceClass", "purposeCode"];
  for (const field of required) {
    if (!normalise(input[field])) {
      return `Missing required field: ${field}.`;
    }
  }

  if (!HEX_32_BYTES.test(normalise(input.requesterId))) {
    return "requesterId must be a 32-byte commitment encoded as 64 hex characters.";
  }

  if (input.objectId && !HEX_32_BYTES.test(normalise(input.objectId))) {
    return "objectId must be a 32-byte commitment encoded as 64 hex characters.";
  }

  if (!ALLOWED_PURPOSES.has(normalise(input.purposeCode).toLowerCase())) {
    return "purposeCode must be transfer, disclosure, query, or compliance.";
  }

  if (input.decision && !ALLOWED_DECISIONS.has(normalise(input.decision).toLowerCase())) {
    return "decision must be allow, deny, or pending.";
  }

  return null;
}

/**
 * Run the deterministic compliance evaluation and assemble the audit receipt.
 * The caller persists the receipt (GCS on this edition) and shapes the HTTP
 * response.
 */
export function runComplianceCheck(input, { environment, midnightNetwork }) {
  const compliance = evaluateCompliance(input);
  const checkedAt = new Date().toISOString();
  const auditId = randomUUID();

  return {
    id: auditId,
    requesterId: normalise(input.requesterId).toLowerCase(),
    objectId: input.objectId ? normalise(input.objectId).toLowerCase() : null,
    resourceClass: normalise(input.resourceClass),
    purposeCode: normalise(input.purposeCode).toLowerCase(),
    jurisdiction: normalise(input.jurisdiction).toUpperCase() || "UNKNOWN",
    decision: normalise(input.decision).toLowerCase() || "pending",
    ...compliance,
    checkedAt,
    environment,
    midnightNetwork,
  };
}
