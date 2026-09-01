// SPDX-License-Identifier: Apache-2.0
// Ported with attribution from MidnightHelixCTW/apps/api/src/constants.js
// (same author, Apache-2.0). The scenario, actions, and response schema are
// the SAME contract (`mhelixctw/api/v1`) — the contract names the protocol,
// not the cloud. Only the provider rows differ: this edition's runtime bridge
// is Google Cloud Run, and no model provider row is claimed because the
// embedding generator is a deterministic fixture (see synthetic-embedding.js).

/**
 * Canonical identifiers are intentionally centralized. The public API accepts
 * only this synthetic TestTown case, which prevents an arbitrary public
 * caller from turning the judge surface into a general data or model proxy.
 */
export const CANONICAL_SCENARIO = Object.freeze({
  scenarioId: "morrow-farmhouse-testwired-v1",
  title: "Morrow Family Farmhouse",
  question: "Is the synthetic Morrow family farmhouse unencumbered?",
  synthetic: true,
  ownerDidz: "didz:testtown:person:edgar-morrow",
  agentDidz: "didz:testtown:agent:morrow-property-assistant",
  unauthorizedAgentDidz: "didz:testtown:agent:unknown-listing-bot",
  resourceId: "rwaz:testtown:property:morrow-family-farmhouse",
  grantId: "grant:testtown:morrow-property-unencumbered:v1",
  predicate: "property.is_unencumbered",
});

export const ACTIONS = Object.freeze([
  "verify_unencumbered",
  "attempt_protected_disclosure",
  "rebuild_recall_projection",
]);

export const RESPONSE_SCHEMA_VERSION = "mhelixctw/api/v1";

/**
 * Fail-closed baseline states. The handler upgrades only the GCP (Google
 * Cloud) row after validating its deployed Cloud Run runtime, and the
 * injected read-only query executor may upgrade only the CockroachDB
 * connection-and-environment-probe row. Every other downstream provider
 * remains SOURCE_ONLY and NOT_CONNECTED until its integration records real
 * execution evidence. Mock fixture providers are never called by this
 * Stage A transport shell.
 */
export const PROVIDER_STATES = Object.freeze([
  Object.freeze({
    id: "gcp",
    // Human-facing alias. The machine identifier is `gcp` because this IS a
    // different runtime from the AWS edition; the browser copy keys on it.
    label: "Helix Runtime Bridge (Google Cloud Run)",
    targetMode: "LIVE_TESTWIRED",
    evidence: "SOURCE_ONLY",
    connection: "NOT_CONNECTED",
  }),
  Object.freeze({
    id: "cockroachdb",
    label: "CockroachDB Cloud connection and TestWired environment probe",
    targetMode: "LIVE_TESTWIRED",
    evidence: "SOURCE_ONLY",
    connection: "NOT_CONNECTED",
  }),
  Object.freeze({
    id: "midnight",
    label: "Midnight test network",
    targetMode: "LIVE_TESTWIRED",
    evidence: "SOURCE_ONLY",
    connection: "NOT_CONNECTED",
  }),
  Object.freeze({
    id: "managed-mcp",
    label: "CockroachDB Cloud Managed MCP Server (read-only agent inspection)",
    targetMode: "LIVE_TESTWIRED",
    // The AWS edition earned CONNECTED evidence for its cluster. This GCP
    // edition has not yet recorded MCP inspection evidence against the
    // didz-testwired cluster, so the row stays fail-closed until it does.
    evidence: "SOURCE_ONLY",
    connection: "NOT_CONNECTED",
  }),
  Object.freeze({
    id: "didz",
    label: "DIDz synthetic identity fixture",
    targetMode: "MOCK",
    evidence: "SOURCE_ONLY",
    connection: "NOT_CONNECTED",
  }),
  Object.freeze({
    id: "agenticdid",
    label: "AgenticDID synthetic authority fixture",
    targetMode: "MOCK",
    evidence: "SOURCE_ONLY",
    connection: "NOT_CONNECTED",
  }),
  Object.freeze({
    id: "rwaz",
    label: "RWAz synthetic property fixture",
    targetMode: "MOCK",
    evidence: "SOURCE_ONLY",
    connection: "NOT_CONNECTED",
  }),
]);

export const ALLOWED_AGENT_IDENTIFIERS = Object.freeze([
  CANONICAL_SCENARIO.agentDidz,
  CANONICAL_SCENARIO.unauthorizedAgentDidz,
]);
