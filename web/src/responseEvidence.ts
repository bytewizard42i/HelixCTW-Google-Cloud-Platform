import {
  DENIED_PROTECTED_FIELDS,
  MORROW_SCENARIO,
  RELEASE_COMMIT_PATTERN_SOURCE,
  RESPONSE_IDENTIFIER_PATTERN_SOURCE,
  RESPONSE_SCHEMA_VERSION,
  type ProviderId,
} from "./api/testwired-contracts";
import type {
  ApiResponseEnvelope,
  JudgeActionId,
  JudgeMutationResponse,
} from "./api/types";

const MAX_PUBLIC_REASON_LENGTH = 500;
const MAX_REQUESTED_PROTECTED_FIELDS = 32;
const RESPONSE_IDENTIFIER_PATTERN = new RegExp(
  RESPONSE_IDENTIFIER_PATTERN_SOURCE,
  "u",
);
const TESTWIRED_BUILD_STAGE = "TESTWIRED";
const LIVE_TESTWIRED_EVIDENCE = "LIVE_TESTWIRED";
const RELEASE_COMMIT_PATTERN = new RegExp(RELEASE_COMMIT_PATTERN_SOURCE, "u");
const REQUIRED_SCENARIO_ID = MORROW_SCENARIO.scenarioId;
const REQUIRED_OBJECT_ID = MORROW_SCENARIO.resource;
const REQUIRED_PREDICATE = MORROW_SCENARIO.permittedPredicate;
const DENIED_PROTECTED_FIELD_ALLOWLIST = new Set<string>(
  DENIED_PROTECTED_FIELDS,
);

type UnknownRecord = Record<string, unknown>;

interface ExactKeySchema {
  readonly allowedKeys: ReadonlySet<string>;
  readonly requiredKeys: readonly string[];
}

interface ValidatedSession {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly closedAt?: string;
}

interface ValidatedAction {
  readonly context: VerifiedRunContext;
  readonly result: UnknownRecord;
  readonly receiptId: string;
}

const MUTATION_BASE_KEYS = [
  "schemaVersion",
  "ok",
  "requestId",
  "buildStage",
  "deploymentEvidence",
  "releaseCommit",
  "protectedFieldsReturned",
] as const;

function exactKeySchema(
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): ExactKeySchema {
  return {
    allowedKeys: new Set([...requiredKeys, ...optionalKeys]),
    requiredKeys,
  };
}

const START_RUN_KEYS = exactKeySchema(
  [...MUTATION_BASE_KEYS, "runId", "scenarioId", "session"],
  ["receiptId"],
);
const CLOSE_SESSION_KEYS = exactKeySchema([
  ...MUTATION_BASE_KEYS,
  "runId",
  "session",
  "canonicalMemoryIds",
  "receiptId",
]);
const RECALL_KEYS = exactKeySchema([
  ...MUTATION_BASE_KEYS,
  "runId",
  "session",
  "query",
  "matches",
  "receiptId",
]);
const ACTION_KEYS = exactKeySchema([
  ...MUTATION_BASE_KEYS,
  "runId",
  "action",
  "result",
  "receiptId",
]);
const OPEN_SESSION_KEYS = exactKeySchema([
  "sessionId",
  "ordinal",
  "state",
  "createdAt",
]);
const CLOSED_SESSION_KEYS = exactKeySchema([
  "sessionId",
  "ordinal",
  "state",
  "createdAt",
  "closedAt",
]);
const RECALL_MATCH_KEYS = exactKeySchema(
  [
    "memoryId",
    "sourceSessionId",
    "objectId",
    "permittedPredicate",
    "projectionGenerationId",
  ],
  ["semanticDistance"],
);
const VERIFIED_PREDICATE_KEYS = exactKeySchema([
  "kind",
  "predicate",
  "value",
  "sourceTextDisclosed",
  "canonicalMemoryId",
  "evidenceCommitment",
  "projectionGenerationId",
  "midnightReceiptId",
]);
const DISCLOSURE_DENIAL_KEYS = exactKeySchema([
  "kind",
  "reason",
  "requestedProtectedFields",
]);
const PROJECTION_REBUILD_KEYS = exactKeySchema([
  "kind",
  "previousGenerationId",
  "activeGenerationId",
  "canonicalSourceCount",
  "commitmentVerified",
  "evidenceCommitment",
]);

export interface VerifiedPredicateEvidence {
  readonly canonicalMemoryId: string;
  readonly evidenceCommitment: string;
  readonly projectionGenerationId: string;
  readonly predicate: typeof REQUIRED_PREDICATE;
  readonly value: true;
  readonly midnightReceiptId: string;
  readonly receiptId: string;
}

export interface VerifiedRebuildEvidence {
  readonly previousGenerationId: string;
  readonly activeGenerationId: string;
  readonly canonicalSourceCount: number;
  readonly evidenceCommitment: string;
  readonly receiptId: string;
}

export interface RecalledMemoryGenerationEvidence {
  readonly canonicalMemoryId: string;
  readonly projectionGenerationId: string;
}

export type VerifiedCheckpointName =
  | "OPEN_SESSION_A"
  | "CLOSE_SESSION_A"
  | "RECALL_SESSION_B"
  | "INITIAL_PREDICATE"
  | "DISCLOSURE_DENIAL"
  | "PROJECTION_REBUILD"
  | "POST_REBUILD_CONTINUITY";

export interface VerifiedCheckpointReceiptEvidence {
  readonly checkpoint: VerifiedCheckpointName;
  readonly receiptId: string;
  readonly runId: string;
  readonly scenarioId: typeof REQUIRED_SCENARIO_ID;
  readonly releaseCommit: string;
  readonly expectedAction?: JudgeActionId;
  readonly expectedProviderReceiptIdsByProvider: Readonly<Partial<Record<ProviderId, string>>>;
  readonly expectedProviderRequestIdsByProvider: Readonly<Partial<Record<ProviderId, string>>>;
}

/**
 * Evidence accumulated across the ordered judge flow. Later checkpoints compare
 * against this history instead of trusting a new receipt in isolation.
 */
export interface VerifiedRunContext {
  readonly runId: string;
  readonly releaseCommit: string;
  readonly sessionId: string;
  readonly sessionAId: string;
  readonly sessionACreatedAt: string;
  readonly sessionAClosedAt?: string;
  readonly sessionBId?: string;
  readonly sessionBCreatedAt?: string;
  readonly receiptId?: string;
  readonly checkpointReceipts: readonly VerifiedCheckpointReceiptEvidence[];
  readonly canonicalMemoryIds: readonly string[];
  readonly recalledMemoryIds: readonly string[];
  readonly recalledMemoryGenerations: readonly RecalledMemoryGenerationEvidence[];
  readonly initialPredicate?: VerifiedPredicateEvidence;
  readonly rebuild?: VerifiedRebuildEvidence;
}

export type CheckpointEvidenceDecision =
  | { readonly valid: true; readonly context: VerifiedRunContext }
  | { readonly valid: false; readonly message: string };

function rejected(message: string): CheckpointEvidenceDecision {
  return { valid: false, message };
}

function accepted(context: VerifiedRunContext): CheckpointEvidenceDecision {
  return { valid: true, context };
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: UnknownRecord, schema: ExactKeySchema): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.every(
      (key) => typeof key === "string" && schema.allowedKeys.has(key),
    ) &&
    schema.requiredKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

export function isBoundedResponseIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    RESPONSE_IDENTIFIER_PATTERN.test(value)
  );
}

function isBoundedPublicText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function optionalIdentifier(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return isBoundedResponseIdentifier(value) ? value : null;
}

function identifierArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    return null;
  }
  if (!value.every(isBoundedResponseIdentifier)) return null;
  const identifiers = value as string[];
  return new Set(identifiers).size === identifiers.length ? identifiers : null;
}

function validatedMutationBody(
  response: ApiResponseEnvelope<JudgeMutationResponse>,
  liveReleaseCommit: string | undefined,
): UnknownRecord | null {
  const body: unknown = response.data;
  if (
    !isRecord(body) ||
    body.schemaVersion !== RESPONSE_SCHEMA_VERSION ||
    body.ok !== true ||
    !isBoundedResponseIdentifier(body.requestId) ||
    body.buildStage !== TESTWIRED_BUILD_STAGE ||
    body.deploymentEvidence !== LIVE_TESTWIRED_EVIDENCE ||
    body.protectedFieldsReturned !== 0 ||
    !RELEASE_COMMIT_PATTERN.test(liveReleaseCommit ?? "") ||
    !RELEASE_COMMIT_PATTERN.test(String(body.releaseCommit)) ||
    body.releaseCommit !== liveReleaseCommit ||
    !isBoundedResponseIdentifier(response.headerRequestId) ||
    response.headerRequestId !== body.requestId ||
    !isBoundedResponseIdentifier(response.requestId) ||
    response.requestId !== body.requestId
  ) {
    return null;
  }
  return body;
}

function validatedSession(
  value: unknown,
  expectedOrdinal: "A" | "B",
  expectedState: "OPEN" | "CLOSED",
  expectedSessionId?: string,
): ValidatedSession | null {
  if (!isRecord(value)) return null;
  const expectedKeys =
    expectedState === "OPEN" ? OPEN_SESSION_KEYS : CLOSED_SESSION_KEYS;
  if (
    !hasExactKeys(value, expectedKeys) ||
    !isBoundedResponseIdentifier(value.sessionId) ||
    value.ordinal !== expectedOrdinal ||
    value.state !== expectedState ||
    !isIsoTimestamp(value.createdAt) ||
    (expectedSessionId !== undefined && value.sessionId !== expectedSessionId)
  ) {
    return null;
  }
  if (expectedState === "OPEN") {
    return { sessionId: value.sessionId, createdAt: value.createdAt };
  }
  if (
    !isIsoTimestamp(value.closedAt) ||
    Date.parse(value.closedAt) < Date.parse(value.createdAt)
  ) {
    return null;
  }
  return {
    sessionId: value.sessionId,
    createdAt: value.createdAt,
    closedAt: value.closedAt,
  };
}

function matchingRunId(body: UnknownRecord, context: VerifiedRunContext): boolean {
  return isBoundedResponseIdentifier(body.runId) && body.runId === context.runId;
}

function responseReceiptId(
  body: UnknownRecord,
  required: boolean,
): string | undefined | null {
  const receiptId = optionalIdentifier(body.receiptId);
  if (receiptId === null || (required && receiptId === undefined)) return null;
  return receiptId;
}

function receiptIdentifierIsUnused(
  context: VerifiedRunContext,
  receiptId: string,
): boolean {
  return !context.checkpointReceipts.some(
    (checkpointReceipt) =>
      checkpointReceipt.receiptId === receiptId ||
      Object.values(
        checkpointReceipt.expectedProviderReceiptIdsByProvider,
      ).includes(receiptId) ||
      Object.values(
        checkpointReceipt.expectedProviderRequestIdsByProvider,
      ).includes(receiptId),
  );
}

function checkpointReceiptIdentifiersAreUnique(
  context: VerifiedRunContext,
  receiptId: string,
  expectedProviderReceiptIdsByProvider: Readonly<
    Partial<Record<ProviderId, string>>
  >,
  expectedProviderRequestIdsByProvider: Readonly<
    Partial<Record<ProviderId, string>>
  >,
): boolean {
  const candidateReceiptIds = [
    receiptId,
    ...Object.values(expectedProviderReceiptIdsByProvider),
    ...Object.values(expectedProviderRequestIdsByProvider),
  ];
  return (
    candidateReceiptIds.every(isBoundedResponseIdentifier) &&
    new Set(candidateReceiptIds).size === candidateReceiptIds.length &&
    candidateReceiptIds.every((candidate) =>
      receiptIdentifierIsUnused(context, candidate),
    )
  );
}

function appendCheckpointReceipt(
  context: VerifiedRunContext,
  receiptId: string,
  checkpoint: VerifiedCheckpointName,
  expectedProviderReceiptIdsByProvider: Readonly<Partial<Record<ProviderId, string>>> = {},
  expectedProviderRequestIdsByProvider: Readonly<Partial<Record<ProviderId, string>>> = {},
  expectedAction?: JudgeActionId,
): VerifiedRunContext {
  const common = {
    checkpoint,
    receiptId,
    runId: context.runId,
    scenarioId: REQUIRED_SCENARIO_ID,
    releaseCommit: context.releaseCommit,
    expectedProviderReceiptIdsByProvider,
    expectedProviderRequestIdsByProvider,
  } as const;
  const checkpointReceipt: VerifiedCheckpointReceiptEvidence =
    expectedAction === undefined ? common : { ...common, expectedAction };
  return {
    ...context,
    receiptId,
    checkpointReceipts: [...context.checkpointReceipts, checkpointReceipt],
  };
}

function validateStartRun(body: UnknownRecord): CheckpointEvidenceDecision {
  const session = validatedSession(body.session, "A", "OPEN");
  const receiptId = responseReceiptId(body, false);
  if (
    !hasExactKeys(body, START_RUN_KEYS) ||
    !isBoundedResponseIdentifier(body.runId) ||
    body.scenarioId !== REQUIRED_SCENARIO_ID ||
    !session ||
    receiptId === null
  ) {
    return rejected(
      "Checkpoint 1 requires only the canonical fields, the Morrow scenario, a safe run ID, and a nested open Session A descriptor.",
    );
  }
  const context: VerifiedRunContext = {
    runId: body.runId,
    releaseCommit: body.releaseCommit as string,
    sessionId: session.sessionId,
    sessionAId: session.sessionId,
    sessionACreatedAt: session.createdAt,
    receiptId,
    checkpointReceipts: [],
    canonicalMemoryIds: [],
    recalledMemoryIds: [],
    recalledMemoryGenerations: [],
  };
  const expectedProviderRequestIds = { gcp: body.requestId as string };
  if (
    receiptId !== undefined &&
    !checkpointReceiptIdentifiersAreUnique(
      context,
      receiptId,
      {},
      expectedProviderRequestIds,
    )
  ) {
    return rejected(
      "Checkpoint 1 receipt and provider request identifiers must be distinct.",
    );
  }
  return accepted(
    receiptId === undefined
      ? context
      : appendCheckpointReceipt(
          context,
          receiptId,
          "OPEN_SESSION_A",
          {},
          expectedProviderRequestIds,
        ),
  );
}

function validateCloseSession(
  body: UnknownRecord,
  context: VerifiedRunContext | null,
): CheckpointEvidenceDecision {
  if (!context || !matchingRunId(body, context)) {
    return rejected("Checkpoint 2 must close the verified run from Session A.");
  }
  const session = validatedSession(body.session, "A", "CLOSED", context.sessionAId);
  const canonicalMemoryIds = identifierArray(body.canonicalMemoryIds);
  const receiptId = responseReceiptId(body, true);
  if (
    !hasExactKeys(body, CLOSE_SESSION_KEYS) ||
    !session ||
    session.createdAt !== context.sessionACreatedAt ||
    !canonicalMemoryIds ||
    !receiptId ||
    !checkpointReceiptIdentifiersAreUnique(
      context,
      receiptId,
      {},
      { gcp: body.requestId as string },
    )
  ) {
    return rejected(
      "Checkpoint 2 requires the same chronological Session A, canonical memory, and a new close receipt.",
    );
  }
  return accepted(
    appendCheckpointReceipt(
      {
        ...context,
        sessionId: session.sessionId,
        sessionAClosedAt: session.closedAt,
        canonicalMemoryIds,
      },
      receiptId,
      "CLOSE_SESSION_A",
      {},
      { gcp: body.requestId as string },
    ),
  );
}

function validateRecall(
  body: UnknownRecord,
  context: VerifiedRunContext | null,
): CheckpointEvidenceDecision {
  if (
    !context ||
    context.canonicalMemoryIds.length === 0 ||
    !context.sessionAClosedAt ||
    !matchingRunId(body, context)
  ) {
    return rejected("Checkpoint 3 requires a closed Session A with canonical memory.");
  }
  const session = validatedSession(body.session, "B", "OPEN");
  const receiptId = responseReceiptId(body, true);
  if (
    !hasExactKeys(body, RECALL_KEYS) ||
    !session ||
    session.sessionId === context.sessionAId ||
    Date.parse(session.createdAt) <= Date.parse(context.sessionAClosedAt) ||
    !isBoundedPublicText(body.query, MAX_PUBLIC_REASON_LENGTH) ||
    !receiptId ||
    !checkpointReceiptIdentifiersAreUnique(
      context,
      receiptId,
      {},
      { gcp: body.requestId as string },
    ) ||
    !Array.isArray(body.matches) ||
    body.matches.length === 0 ||
    body.matches.length > 64
  ) {
    return rejected(
      "Checkpoint 3 requires a later, distinct Session B, canonical matches, and a new recall receipt.",
    );
  }

  const recalledMemoryGenerations: RecalledMemoryGenerationEvidence[] = [];
  const seenMemoryIds = new Set<string>();
  for (const match of body.matches) {
    if (
      !isRecord(match) ||
      !hasExactKeys(match, RECALL_MATCH_KEYS) ||
      !isBoundedResponseIdentifier(match.memoryId) ||
      match.sourceSessionId !== context.sessionAId ||
      match.objectId !== REQUIRED_OBJECT_ID ||
      match.permittedPredicate !== REQUIRED_PREDICATE ||
      !context.canonicalMemoryIds.includes(match.memoryId) ||
      !isBoundedResponseIdentifier(match.projectionGenerationId) ||
      seenMemoryIds.has(match.memoryId) ||
      (match.semanticDistance !== undefined &&
        (typeof match.semanticDistance !== "number" ||
          !Number.isFinite(match.semanticDistance) ||
          match.semanticDistance < 0))
    ) {
      return rejected(
        "Checkpoint 3 matches must uniquely bind Session A canonical memory to the exact Morrow predicate and a projection generation.",
      );
    }
    seenMemoryIds.add(match.memoryId);
    recalledMemoryGenerations.push({
      canonicalMemoryId: match.memoryId,
      projectionGenerationId: match.projectionGenerationId,
    });
  }

  return accepted(
    appendCheckpointReceipt(
      {
        ...context,
        sessionId: session.sessionId,
        sessionBId: session.sessionId,
        sessionBCreatedAt: session.createdAt,
        recalledMemoryIds: recalledMemoryGenerations.map(
          (lineage) => lineage.canonicalMemoryId,
        ),
        recalledMemoryGenerations,
      },
      receiptId,
      "RECALL_SESSION_B",
      {},
      { gcp: body.requestId as string },
    ),
  );
}

function validatedActionBase(
  body: UnknownRecord,
  context: VerifiedRunContext | null,
  expectedAction: JudgeActionId,
): ValidatedAction | null {
  if (
    !context ||
    !hasExactKeys(body, ACTION_KEYS) ||
    !matchingRunId(body, context) ||
    body.action !== expectedAction ||
    !isRecord(body.result)
  ) {
    return null;
  }
  const receiptId = responseReceiptId(body, true);
  return receiptId && receiptIdentifierIsUnused(context, receiptId)
    ? { context, result: body.result, receiptId }
    : null;
}

function predicateEvidence(
  result: UnknownRecord,
  receiptId: string,
): VerifiedPredicateEvidence | null {
  if (
    !hasExactKeys(result, VERIFIED_PREDICATE_KEYS) ||
    result.kind !== "VERIFIED_PREDICATE" ||
    result.predicate !== REQUIRED_PREDICATE ||
    result.value !== true ||
    result.sourceTextDisclosed !== false ||
    !isBoundedResponseIdentifier(result.canonicalMemoryId) ||
    !isBoundedResponseIdentifier(result.evidenceCommitment) ||
    !isBoundedResponseIdentifier(result.projectionGenerationId) ||
    !isBoundedResponseIdentifier(result.midnightReceiptId)
  ) {
    return null;
  }
  return {
    canonicalMemoryId: result.canonicalMemoryId,
    evidenceCommitment: result.evidenceCommitment,
    projectionGenerationId: result.projectionGenerationId,
    predicate: REQUIRED_PREDICATE,
    value: true,
    midnightReceiptId: result.midnightReceiptId,
    receiptId,
  };
}

function validateInitialPredicate(
  body: UnknownRecord,
  context: VerifiedRunContext | null,
): CheckpointEvidenceDecision {
  const action = validatedActionBase(body, context, "verify_unencumbered");
  if (!action) {
    return rejected("Checkpoint 4 requires a new receipt-bound verify action.");
  }
  const predicate = predicateEvidence(action.result, action.receiptId);
  const recallLineage = predicate
    ? action.context.recalledMemoryGenerations.find(
        (lineage) => lineage.canonicalMemoryId === predicate.canonicalMemoryId,
      )
    : undefined;
  if (
    !predicate ||
    !recallLineage ||
    recallLineage.projectionGenerationId !== predicate.projectionGenerationId ||
    !checkpointReceiptIdentifiersAreUnique(
      action.context,
      action.receiptId,
      { midnight: predicate.midnightReceiptId },
      { gcp: body.requestId as string },
    )
  ) {
    return rejected(
      "Checkpoint 4 must bind its predicate generation to the recalled canonical memory lineage.",
    );
  }
  return accepted(
    appendCheckpointReceipt(
      { ...action.context, initialPredicate: predicate },
      action.receiptId,
      "INITIAL_PREDICATE",
      { midnight: predicate.midnightReceiptId },
      { gcp: body.requestId as string },
      "verify_unencumbered",
    ),
  );
}

function validateDeniedDisclosure(
  body: UnknownRecord,
  context: VerifiedRunContext | null,
): CheckpointEvidenceDecision {
  const action = validatedActionBase(body, context, "attempt_protected_disclosure");
  if (
    !action ||
    !action.context.initialPredicate ||
    !checkpointReceiptIdentifiersAreUnique(
      action.context,
      action.receiptId,
      {},
      { gcp: body.requestId as string },
    )
  ) {
    return rejected("Checkpoint 5 requires the verified predicate and a new denial receipt.");
  }
  const requestedFields = action.result.requestedProtectedFields;
  if (
    !hasExactKeys(action.result, DISCLOSURE_DENIAL_KEYS) ||
    action.result.kind !== "DISCLOSURE_DENIED" ||
    !isBoundedPublicText(action.result.reason, MAX_PUBLIC_REASON_LENGTH) ||
    !Array.isArray(requestedFields) ||
    requestedFields.length === 0 ||
    requestedFields.length > MAX_REQUESTED_PROTECTED_FIELDS ||
    !requestedFields.every(
      (field) =>
        typeof field === "string" &&
        DENIED_PROTECTED_FIELD_ALLOWLIST.has(field),
    ) ||
    new Set(requestedFields).size !== requestedFields.length
  ) {
    return rejected(
      "Checkpoint 5 requires a unique allowlisted protected-field denial and zero disclosed fields.",
    );
  }
  return accepted(
    appendCheckpointReceipt(
      action.context,
      action.receiptId,
      "DISCLOSURE_DENIAL",
      {},
      { gcp: body.requestId as string },
      "attempt_protected_disclosure",
    ),
  );
}

function validateRebuild(
  body: UnknownRecord,
  context: VerifiedRunContext | null,
): CheckpointEvidenceDecision {
  const action = validatedActionBase(body, context, "rebuild_recall_projection");
  const initialPredicate = action?.context.initialPredicate;
  if (
    !action ||
    !initialPredicate ||
    !checkpointReceiptIdentifiersAreUnique(
      action.context,
      action.receiptId,
      {},
      { gcp: body.requestId as string },
    )
  ) {
    return rejected("Checkpoint 6 requires initial predicate lineage and a new rebuild receipt.");
  }
  const canonicalSourceCount = action.result.canonicalSourceCount;
  if (
    !hasExactKeys(action.result, PROJECTION_REBUILD_KEYS) ||
    action.result.kind !== "PROJECTION_REBUILT" ||
    action.result.previousGenerationId !== initialPredicate.projectionGenerationId ||
    !isBoundedResponseIdentifier(action.result.activeGenerationId) ||
    action.result.activeGenerationId === initialPredicate.projectionGenerationId ||
    canonicalSourceCount !== action.context.canonicalMemoryIds.length ||
    !Number.isSafeInteger(canonicalSourceCount) ||
    action.result.commitmentVerified !== true ||
    action.result.evidenceCommitment !== initialPredicate.evidenceCommitment
  ) {
    return rejected(
      "Checkpoint 6 must preserve the exact commitment and canonical source set while activating a new generation.",
    );
  }
  const rebuild: VerifiedRebuildEvidence = {
    previousGenerationId: initialPredicate.projectionGenerationId,
    activeGenerationId: action.result.activeGenerationId,
    canonicalSourceCount,
    evidenceCommitment: initialPredicate.evidenceCommitment,
    receiptId: action.receiptId,
  };
  return accepted(
    appendCheckpointReceipt(
      { ...action.context, rebuild },
      action.receiptId,
      "PROJECTION_REBUILD",
      {},
      { gcp: body.requestId as string },
      "rebuild_recall_projection",
    ),
  );
}

function validateContinuity(
  body: UnknownRecord,
  context: VerifiedRunContext | null,
): CheckpointEvidenceDecision {
  const action = validatedActionBase(body, context, "verify_unencumbered");
  const initialPredicate = action?.context.initialPredicate;
  const rebuild = action?.context.rebuild;
  if (!action || !initialPredicate || !rebuild) {
    return rejected("Checkpoint 7 requires both predicate and rebuild lineage.");
  }
  const currentPredicate = predicateEvidence(action.result, action.receiptId);
  if (
    !currentPredicate ||
    !checkpointReceiptIdentifiersAreUnique(
      action.context,
      action.receiptId,
      { midnight: currentPredicate.midnightReceiptId },
      { gcp: body.requestId as string },
    ) ||
    currentPredicate.canonicalMemoryId !== initialPredicate.canonicalMemoryId ||
    currentPredicate.evidenceCommitment !== rebuild.evidenceCommitment ||
    currentPredicate.projectionGenerationId !== rebuild.activeGenerationId ||
    currentPredicate.predicate !== initialPredicate.predicate ||
    currentPredicate.value !== initialPredicate.value
  ) {
    return rejected(
      "Checkpoint 7 must preserve canonical memory, commitment, predicate, and value on the rebuilt generation.",
    );
  }
  return accepted(
    appendCheckpointReceipt(
      action.context,
      action.receiptId,
      "POST_REBUILD_CONTINUITY",
      { midnight: currentPredicate.midnightReceiptId },
      { gcp: body.requestId as string },
      "verify_unencumbered",
    ),
  );
}

/**
 * Validates the exact canonical response required by one ordered checkpoint.
 * No checkpoint can advance from `ok: true` plus a generic receipt alone.
 */
export function validateCheckpointResponseEvidence(
  stepIndex: number,
  response: ApiResponseEnvelope<JudgeMutationResponse>,
  previousContext: VerifiedRunContext | null = null,
  liveReleaseCommit?: string,
): CheckpointEvidenceDecision {
  const body = validatedMutationBody(response, liveReleaseCommit);
  if (!body) {
    return rejected(
      "The response failed the canonical schema, matching request ID, LIVE_TESTWIRED evidence, or zero-protected-field invariant.",
    );
  }
  if (
    previousContext &&
    body.releaseCommit !== previousContext.releaseCommit
  ) {
    return rejected(
      "The response release does not match the release captured when this guided run began.",
    );
  }
  if (stepIndex === 0) return validateStartRun(body);
  if (stepIndex === 1) return validateCloseSession(body, previousContext);
  if (stepIndex === 2) return validateRecall(body, previousContext);
  if (stepIndex === 3) return validateInitialPredicate(body, previousContext);
  if (stepIndex === 4) return validateDeniedDisclosure(body, previousContext);
  if (stepIndex === 5) return validateRebuild(body, previousContext);
  if (stepIndex === 6) return validateContinuity(body, previousContext);
  return rejected("This checkpoint has no public mutation response contract.");
}

/** Compatibility wrapper for callers that only need the accumulated context. */
export function responseHasRequiredEvidence(
  stepIndex: number,
  response: ApiResponseEnvelope<JudgeMutationResponse>,
  previousContext: VerifiedRunContext | null = null,
  liveReleaseCommit?: string,
): VerifiedRunContext | null {
  const decision = validateCheckpointResponseEvidence(
    stepIndex,
    response,
    previousContext,
    liveReleaseCommit,
  );
  return decision.valid ? decision.context : null;
}
