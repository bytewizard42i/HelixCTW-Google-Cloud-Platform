// SPDX-License-Identifier: Apache-2.0

/**
 * Shared TestWired API contracts.
 *
 * Ported with attribution from
 * MidnightHelixCTW/packages/protocol-types/src/testwired-contracts.ts
 * (same author, Apache-2.0), with the GCP provider identifiers.
 *
 * Implementation stages describe what is currently connected and verified.
 * Evidence labels describe one particular output. Keeping those concepts
 * separate prevents one successful receipt from overstating the whole app.
 */

export const RESPONSE_SCHEMA_VERSION = "mhelixctw/api/v1" as const;
export const RESPONSE_IDENTIFIER_PATTERN_SOURCE =
  "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" as const;
export const RELEASE_COMMIT_PATTERN_SOURCE = "^[0-9a-f]{40}$" as const;
export const IDEMPOTENCY_HEADER = "Idempotency-Key" as const;
export const MAXIMUM_REQUEST_BODY_BYTES = 4096 as const;
export const IDEMPOTENCY_KEY_PATTERN_SOURCE =
  "^[A-Za-z0-9._:-]{16,128}$" as const;

export const IMPLEMENTATION_STAGES = [
  "LIVE_TESTWIRED",
  "VERIFIED_LOCAL",
  "MOCK",
  "SOURCE_ONLY",
  "PLANNED",
] as const;

export type ImplementationStage = (typeof IMPLEMENTATION_STAGES)[number];

/**
 * REALDEAL_TEST can label an output backed by a real test or cloud-service
 * receipt. It is deliberately not an ImplementationStage.
 */
export const OUTPUT_EVIDENCE_LABELS = [
  "MOCK",
  "REALDEAL_TEST",
  "REALDEAL",
] as const;

export type OutputEvidenceLabel = (typeof OUTPUT_EVIDENCE_LABELS)[number];

/**
 * Provider rows can expose REALDEAL_TEST only when the current response itself
 * carries the matching real test-service evidence reference.
 */
export type ProviderRuntimeEvidence = ImplementationStage | "REALDEAL_TEST";

/**
 * A privacy invariant for this judge scenario. Public responses return the
 * count, never the protected values. The count must remain zero.
 */
export type ProtectedFieldsReturned = 0;

/**
 * A release commit is accepted from the wire only after runtime validation
 * against RELEASE_COMMIT_PATTERN_SOURCE.
 */
export type ReleaseCommit = string;

export const DENIED_PROTECTED_FIELDS = [
  "deed.full_text",
  "mortgage.full_record",
  "owner.birth_date",
  "owner.private_contact_information",
] as const;

export type DeniedProtectedField =
  (typeof DENIED_PROTECTED_FIELDS)[number];

// GCP deviation from upstream: the runtime bridge is Cloud Run (`gcp`), and
// there is no model-provider row because embeddings are a deterministic
// fixture in this edition.
export const PROVIDER_IDS = [
  "gcp",
  "cockroachdb",
  "midnight",
  "managed-mcp",
  "didz",
  "agenticdid",
  "rwaz",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderMode = "LIVE_TESTWIRED" | "MOCK";
export type ProviderConnection = "CONNECTED" | "NOT_CONNECTED" | "ERROR";
export type TestWiredBuildStage = "TESTWIRED";

export interface EvidenceReference {
  readonly label: OutputEvidenceLabel;
  readonly provider: ProviderId;
  readonly receiptId?: string;
  readonly requestId?: string;
  readonly observedAt?: string;
}

/**
 * evidence is normally the provider's current machine stage. REALDEAL_TEST is
 * allowed only when this response carries the matching real cloud-service
 * evidenceReference.
 */
export interface ProviderStatus {
  readonly id: ProviderId;
  readonly label: string;
  readonly targetMode: ProviderMode;
  readonly evidence: ProviderRuntimeEvidence;
  readonly connection: ProviderConnection;
  readonly evidenceReference?: EvidenceReference;
  readonly detail?: string;
}

export interface TransportStatus {
  readonly providerId: "gcp";
  readonly scope: "GCP_CLOUD_RUN_ONLY";
  readonly evidence: ProviderRuntimeEvidence;
  readonly connection: ProviderConnection;
  readonly downstreamProvidersConnected: false;
  readonly evidenceReference?: EvidenceReference;
}

export const MORROW_SCENARIO = {
  scenarioId: "morrow-farmhouse-testwired-v1",
  title: "Morrow Family Farmhouse",
  headline: "The agent found the answer. It never saw the deed.",
  question: "Is the synthetic Morrow family farmhouse unencumbered?",
  synthetic: true,
  ownerDidz: "didz:testtown:person:edgar-morrow",
  agentDidz: "didz:testtown:agent:morrow-property-assistant",
  authorizedAgentDidz: "didz:testtown:agent:morrow-property-assistant",
  unauthorizedAgentDidz: "didz:testtown:agent:unknown-listing-bot",
  resourceId: "rwaz:testtown:property:morrow-family-farmhouse",
  resource: "rwaz:testtown:property:morrow-family-farmhouse",
  grantId: "grant:testtown:morrow-property-unencumbered:v1",
  predicate: "property.is_unencumbered",
  permittedPredicate: "property.is_unencumbered",
  prompts: {
    remember:
      "Prepare a privacy-safe title review for the Morrow family farmhouse. Remember the property identifier, the permitted question, and the evidence commitments, but do not expose deed or mortgage text.",
    recall: "Where were we, and is this property unencumbered?",
    verify: "Is this property unencumbered?",
    overreach:
      "Show me the complete deed, mortgage record, owner birth date, and private contact information.",
    verifyAfterRebuild:
      "After reconstruction, is the Morrow farmhouse still shown as unencumbered?",
  },
} as const;

export const JUDGE_ACTIONS = [
  "verify_unencumbered",
  "attempt_protected_disclosure",
  "rebuild_recall_projection",
] as const;

export type JudgeAction = (typeof JUDGE_ACTIONS)[number];
export type JudgeReceiptOperation =
  | "create_run"
  | "close_session"
  | "recall"
  | JudgeAction;
export type JudgeAgentDidz =
  | typeof MORROW_SCENARIO.authorizedAgentDidz
  | typeof MORROW_SCENARIO.unauthorizedAgentDidz;

export interface ApiResponseBase {
  readonly schemaVersion: typeof RESPONSE_SCHEMA_VERSION;
  readonly ok: boolean;
  readonly requestId: string;
}

export interface TestWiredEvidenceFields {
  readonly buildStage: TestWiredBuildStage;
  readonly deploymentEvidence: ImplementationStage;
  readonly transport: TransportStatus;
}

export interface ApiError {
  readonly code:
    | "BAD_REQUEST"
    | "IDEMPOTENCY_KEY_REQUIRED"
    | "INVALID_IDEMPOTENCY_KEY"
    | "LIVE_PROVIDERS_NOT_CONNECTED"
    | "NOT_FOUND"
    | "INTERNAL_ERROR";
  readonly message: string;
  readonly retryable: boolean;
}

export interface ErrorResponse extends ApiResponseBase {
  readonly ok: false;
  readonly error: ApiError;
  readonly providers?: readonly ProviderStatus[];
}

export type SessionState = "OPEN" | "CLOSED";

export interface SessionDescriptor {
  readonly sessionId: string;
  readonly ordinal: "A" | "B";
  readonly state: SessionState;
  readonly createdAt: string;
  readonly closedAt?: string;
}

export interface HealthResponse
  extends ApiResponseBase,
    TestWiredEvidenceFields {
  readonly service: "midnight-helixctw-api";
  readonly handler: "READY";
  readonly dependenciesConnected: boolean;
  readonly region: string;
  readonly releaseCommit: ReleaseCommit;
  readonly limits: {
    readonly maxRequestBytes: number;
    readonly maxResponseBytes: number;
  };
  readonly providers: readonly ProviderStatus[];
}

export interface StatusResponse
  extends ApiResponseBase,
    TestWiredEvidenceFields {
  readonly releaseCommit: ReleaseCommit;
  readonly currentAvailability: ProviderConnection;
  readonly writeOperations: "BLOCKED_UNTIL_CONNECTED" | "ENABLED";
  readonly readyForMutations: boolean;
  readonly actions: readonly JudgeAction[];
  readonly providers: readonly ProviderStatus[];
}

export interface JudgeScenarioSummary {
  readonly scenarioId: typeof MORROW_SCENARIO.scenarioId;
  readonly title: typeof MORROW_SCENARIO.title;
  readonly question: typeof MORROW_SCENARIO.question;
  readonly synthetic: true;
  readonly ownerDidz: typeof MORROW_SCENARIO.ownerDidz;
  readonly agentDidz: typeof MORROW_SCENARIO.agentDidz;
  readonly unauthorizedAgentDidz: typeof MORROW_SCENARIO.unauthorizedAgentDidz;
  readonly resourceId: typeof MORROW_SCENARIO.resourceId;
  readonly grantId: typeof MORROW_SCENARIO.grantId;
  readonly predicate: typeof MORROW_SCENARIO.predicate;
  readonly currentAvailability: ProviderConnection;
  readonly fixtureEvidence: ImplementationStage;
  readonly actions: readonly JudgeAction[];
  readonly requiredLiveProviders: readonly ProviderId[];
  readonly privacyBoundary: string;
}

export interface ScenariosResponse
  extends ApiResponseBase,
    TestWiredEvidenceFields {
  readonly scenarios: readonly JudgeScenarioSummary[];
  readonly providers: readonly ProviderStatus[];
}

/**
 * POST requests also require the Idempotency-Key header. It is intentionally
 * not duplicated in JSON request bodies.
 */
export interface CreateRunRequest {
  readonly scenarioId: typeof MORROW_SCENARIO.scenarioId;
  readonly agentDidz?: JudgeAgentDidz;
}

export interface CreateRunResponse extends ApiResponseBase {
  readonly runId: string;
  readonly scenarioId: typeof MORROW_SCENARIO.scenarioId;
  readonly session: SessionDescriptor;
  readonly buildStage: TestWiredBuildStage;
  readonly deploymentEvidence: "LIVE_TESTWIRED";
  readonly releaseCommit: ReleaseCommit;
  readonly receiptId?: string;
  readonly protectedFieldsReturned: ProtectedFieldsReturned;
}

export interface CloseSessionRequest {
  readonly sessionId: string;
}

export interface CloseSessionResponse extends ApiResponseBase {
  readonly runId: string;
  readonly session: SessionDescriptor & { readonly state: "CLOSED" };
  readonly canonicalMemoryIds: readonly string[];
  readonly buildStage: TestWiredBuildStage;
  readonly deploymentEvidence: "LIVE_TESTWIRED";
  readonly releaseCommit: ReleaseCommit;
  readonly receiptId: string;
  readonly protectedFieldsReturned: ProtectedFieldsReturned;
}

export interface RecallRequest {
  readonly query: string;
  readonly agentDidz?: JudgeAgentDidz;
}

export interface RecallMatch {
  readonly memoryId: string;
  readonly sourceSessionId: string;
  readonly objectId: typeof MORROW_SCENARIO.resource;
  readonly permittedPredicate: typeof MORROW_SCENARIO.permittedPredicate;
  readonly semanticDistance?: number;
  readonly projectionGenerationId: string;
}

export interface RecallResponse extends ApiResponseBase {
  readonly runId: string;
  readonly session: SessionDescriptor;
  readonly query: string;
  readonly matches: readonly RecallMatch[];
  readonly buildStage: TestWiredBuildStage;
  readonly deploymentEvidence: "LIVE_TESTWIRED";
  readonly releaseCommit: ReleaseCommit;
  readonly receiptId: string;
  readonly protectedFieldsReturned: ProtectedFieldsReturned;
}

export interface JudgeActionRequest {
  readonly action: JudgeAction;
  readonly agentDidz?: JudgeAgentDidz;
}

export interface VerifiedPredicateResult {
  readonly kind: "VERIFIED_PREDICATE";
  readonly predicate: typeof MORROW_SCENARIO.permittedPredicate;
  readonly value: boolean;
  readonly sourceTextDisclosed: false;
  /** Canonical memory row used for this predicate result. */
  readonly canonicalMemoryId: string;
  /** Stable commitment that must remain equal across a projection rebuild. */
  readonly evidenceCommitment: string;
  /** Active recall-projection generation used for this result. */
  readonly projectionGenerationId: string;
  readonly midnightReceiptId: string;
}

export interface DeniedDisclosureResult {
  readonly kind: "DISCLOSURE_DENIED";
  readonly reason: string;
  readonly requestedProtectedFields: readonly DeniedProtectedField[];
}

export interface ProjectionRebuildResult {
  readonly kind: "PROJECTION_REBUILT";
  readonly previousGenerationId: string;
  readonly activeGenerationId: string;
  readonly canonicalSourceCount: number;
  readonly commitmentVerified: boolean;
  readonly evidenceCommitment: string;
}

export type JudgeActionResult =
  | VerifiedPredicateResult
  | DeniedDisclosureResult
  | ProjectionRebuildResult;

export interface JudgeActionResponse extends ApiResponseBase {
  readonly runId: string;
  readonly action: JudgeAction;
  readonly result: JudgeActionResult;
  readonly buildStage: TestWiredBuildStage;
  readonly deploymentEvidence: "LIVE_TESTWIRED";
  readonly releaseCommit: ReleaseCommit;
  readonly receiptId: string;
  readonly protectedFieldsReturned: ProtectedFieldsReturned;
}

export interface ProviderReceiptReference {
  readonly provider: ProviderId;
  readonly evidence: ImplementationStage;
  readonly receiptId?: string;
  readonly requestId?: string;
  readonly evidenceLabel?: OutputEvidenceLabel;
}

export interface JudgeReceiptBase {
  readonly receiptId: string;
  readonly runId: string;
  readonly scenarioId: typeof MORROW_SCENARIO.scenarioId;
  readonly buildStage: TestWiredBuildStage;
  readonly deploymentEvidence: "LIVE_TESTWIRED";
  readonly releaseCommit: ReleaseCommit;
  readonly createdAt: string;
  readonly providers: readonly ProviderReceiptReference[];
  readonly protectedFieldsReturned: ProtectedFieldsReturned;
}

export type JudgeReceipt =
  | (
      JudgeReceiptBase & {
        readonly operation: "create_run" | "close_session" | "recall";
        readonly action?: never;
      }
    )
  | {
      [Action in JudgeAction]: JudgeReceiptBase & {
        readonly operation: Action;
        readonly action: Action;
      };
    }[JudgeAction];

export interface ReceiptResponse extends ApiResponseBase {
  readonly receipt: JudgeReceipt;
}
