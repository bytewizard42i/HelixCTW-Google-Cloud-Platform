import {
  IMPLEMENTATION_STAGES,
  JUDGE_ACTIONS,
  MORROW_SCENARIO,
  OUTPUT_EVIDENCE_LABELS,
  PROVIDER_IDS,
  RELEASE_COMMIT_PATTERN_SOURCE,
  RESPONSE_IDENTIFIER_PATTERN_SOURCE,
  RESPONSE_SCHEMA_VERSION,
  type JudgeReceiptOperation,
  type ProviderId,
} from "./api/testwired-contracts";
import type {
  ApiResponseEnvelope,
  JudgeMutationResponse,
  JsonPrimitive,
  ReceiptResponse,
} from "./api/types";
import type {
  VerifiedCheckpointName,
  VerifiedCheckpointReceiptEvidence,
} from "./responseEvidence";

type UnknownRecord = Record<string, unknown>;

interface ExactKeySchema {
  readonly allowedKeys: ReadonlySet<string>;
  readonly requiredKeys: readonly string[];
}

export type EvidenceDisplayFieldId =
  | "apiRequestId"
  | "buildStage"
  | "deploymentEvidence"
  | "releaseCommit"
  | "runId"
  | "scenarioId"
  | "receiptOperation"
  | "receiptCreatedAt"
  | "sessionId"
  | "canonicalMemoryId"
  | "semanticDistance"
  | "evidenceCommitment"
  | "midnightReceiptId"
  | "projectionGenerationId"
  | "receiptId"
  | "protectedFieldsReturned"
  | "managedMcpReceiptId";

export type EvidenceDisplayFields = Readonly<
  Partial<Record<EvidenceDisplayFieldId, JsonPrimitive>>
>;

export interface ReceiptEvidenceExpectation {
  readonly checkpointReceipt: VerifiedCheckpointReceiptEvidence;
  readonly liveReleaseCommit: string | undefined;
}

export type ReceiptEvidenceDecision =
  | {
      readonly valid: true;
      readonly fields: EvidenceDisplayFields;
    }
  | {
      readonly valid: false;
      readonly message: string;
    };

const RESPONSE_IDENTIFIER_PATTERN = new RegExp(
  RESPONSE_IDENTIFIER_PATTERN_SOURCE,
  "u",
);
const RELEASE_COMMIT_PATTERN = new RegExp(RELEASE_COMMIT_PATTERN_SOURCE, "u");
const PROVIDER_ID_SET = new Set<string>(PROVIDER_IDS);
const MOCK_ONLY_PROVIDER_IDS = new Set<ProviderId>([
  "didz",
  "agenticdid",
  "rwaz",
]);
const IMPLEMENTATION_STAGE_SET = new Set<string>(IMPLEMENTATION_STAGES);
const OUTPUT_EVIDENCE_LABEL_SET = new Set<string>(OUTPUT_EVIDENCE_LABELS);
const JUDGE_ACTION_SET = new Set<string>(JUDGE_ACTIONS);

const CHECKPOINT_RECEIPT_OPERATIONS: Readonly<
  Record<VerifiedCheckpointName, JudgeReceiptOperation>
> = {
  OPEN_SESSION_A: "create_run",
  CLOSE_SESSION_A: "close_session",
  RECALL_SESSION_B: "recall",
  INITIAL_PREDICATE: "verify_unencumbered",
  DISCLOSURE_DENIAL: "attempt_protected_disclosure",
  PROJECTION_REBUILD: "rebuild_recall_projection",
  POST_REBUILD_CONTINUITY: "verify_unencumbered",
};

function exactKeySchema(
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): ExactKeySchema {
  return {
    allowedKeys: new Set([...requiredKeys, ...optionalKeys]),
    requiredKeys,
  };
}

const RECEIPT_RESPONSE_KEYS = exactKeySchema([
  "schemaVersion",
  "ok",
  "requestId",
  "receipt",
]);
const JUDGE_RECEIPT_KEYS = exactKeySchema(
  [
    "receiptId",
    "runId",
    "scenarioId",
    "operation",
    "buildStage",
    "deploymentEvidence",
    "releaseCommit",
    "createdAt",
    "providers",
    "protectedFieldsReturned",
  ],
  ["action"],
);
const PROVIDER_RECEIPT_KEYS = exactKeySchema(
  ["provider", "evidence"],
  ["receiptId", "requestId", "evidenceLabel"],
);

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

function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && RESPONSE_IDENTIFIER_PATTERN.test(value);
}

function isUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validOptionalIdentifier(
  value: UnknownRecord,
  key: "receiptId" | "requestId",
): boolean {
  return !hasOwn(value, key) || isBoundedIdentifier(value[key]);
}

interface ValidatedProviderReceipt {
  readonly provider: ProviderId;
  readonly receiptId?: string;
  readonly requestId?: string;
}

function validateProviderReceipts(
  value: unknown,
  expectedReceiptIdsByProvider: Readonly<
    Partial<Record<ProviderId, string>>
  >,
  expectedRequestIdsByProvider: Readonly<
    Partial<Record<ProviderId, string>>
  >,
  operationReceiptId: string,
  envelopeRequestId: string,
): ReadonlyMap<ProviderId, ValidatedProviderReceipt> | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > PROVIDER_IDS.length ||
    !isRecord(expectedReceiptIdsByProvider) ||
    !isRecord(expectedRequestIdsByProvider)
  ) {
    return null;
  }

  const expectedReceiptEntries = Object.entries(expectedReceiptIdsByProvider);
  const expectedRequestEntries = Object.entries(expectedRequestIdsByProvider);
  const expectedIdentifiers = new Set<string>();
  for (const [provider, identifier] of [
    ...expectedReceiptEntries,
    ...expectedRequestEntries,
  ]) {
    if (
      !PROVIDER_ID_SET.has(provider) ||
      !isBoundedIdentifier(identifier) ||
      expectedIdentifiers.has(identifier)
    ) {
      return null;
    }
    expectedIdentifiers.add(identifier);
  }

  const providers = new Map<ProviderId, ValidatedProviderReceipt>();
  const seenProviderIdentifiers = new Set<string>();
  const forbiddenProviderIdentifiers = new Set([
    operationReceiptId,
    envelopeRequestId,
  ]);
  let hasGenuineLiveReference = false;
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, PROVIDER_RECEIPT_KEYS) ||
      !PROVIDER_ID_SET.has(String(candidate.provider)) ||
      !IMPLEMENTATION_STAGE_SET.has(String(candidate.evidence)) ||
      !validOptionalIdentifier(candidate, "receiptId") ||
      !validOptionalIdentifier(candidate, "requestId")
    ) {
      return null;
    }

    const provider = candidate.provider as ProviderId;
    if (providers.has(provider)) {
      return null;
    }

    const evidenceLabel = candidate.evidenceLabel;
    if (
      hasOwn(candidate, "evidenceLabel") &&
      (!OUTPUT_EVIDENCE_LABEL_SET.has(String(evidenceLabel)) ||
        evidenceLabel === "REALDEAL")
    ) {
      return null;
    }
    if (
      evidenceLabel === "REALDEAL_TEST" &&
      (candidate.evidence !== "LIVE_TESTWIRED" ||
        (!isBoundedIdentifier(candidate.receiptId) &&
          !isBoundedIdentifier(candidate.requestId)))
    ) {
      return null;
    }
    if (
      (evidenceLabel === "MOCK" && candidate.evidence !== "MOCK") ||
      (candidate.evidence === "MOCK" &&
        evidenceLabel !== undefined &&
        evidenceLabel !== "MOCK") ||
      (MOCK_ONLY_PROVIDER_IDS.has(provider) &&
        (candidate.evidence !== "MOCK" || evidenceLabel !== "MOCK"))
    ) {
      return null;
    }
    if (
      candidate.evidence === "LIVE_TESTWIRED" &&
      candidate.evidenceLabel === "REALDEAL_TEST" &&
      (isBoundedIdentifier(candidate.receiptId) ||
        isBoundedIdentifier(candidate.requestId))
    ) {
      hasGenuineLiveReference = true;
    }

    const providerReceiptId = isBoundedIdentifier(candidate.receiptId)
      ? candidate.receiptId
      : undefined;
    const providerRequestId = isBoundedIdentifier(candidate.requestId)
      ? candidate.requestId
      : undefined;
    const providerIdentifiers = [providerReceiptId, providerRequestId].filter(
      (identifier): identifier is string => identifier !== undefined,
    );
    if (
      new Set(providerIdentifiers).size !== providerIdentifiers.length ||
      providerIdentifiers.some(
        (identifier) =>
          forbiddenProviderIdentifiers.has(identifier) ||
          seenProviderIdentifiers.has(identifier),
      )
    ) {
      return null;
    }
    providerIdentifiers.forEach((identifier) =>
      seenProviderIdentifiers.add(identifier),
    );

    providers.set(provider, {
      provider,
      ...(providerReceiptId === undefined ? {} : { receiptId: providerReceiptId }),
      ...(providerRequestId === undefined ? {} : { requestId: providerRequestId }),
    });
  }

  if (!hasGenuineLiveReference) {
    return null;
  }

  for (const [expectedProvider, expectedReceiptId] of expectedReceiptEntries) {
    const expectedReference = providers.get(expectedProvider as ProviderId);
    if (expectedReference?.receiptId !== expectedReceiptId) {
      return null;
    }
    const rawReference = value.find(
      (candidate) =>
        isRecord(candidate) && candidate.provider === expectedProvider,
    );
    if (
      !isRecord(rawReference) ||
      rawReference.evidence !== "LIVE_TESTWIRED" ||
      rawReference.evidenceLabel !== "REALDEAL_TEST"
    ) {
      return null;
    }
  }

  for (const [expectedProvider, expectedRequestId] of expectedRequestEntries) {
    const expectedReference = providers.get(expectedProvider as ProviderId);
    if (expectedReference?.requestId !== expectedRequestId) {
      return null;
    }
    const rawReference = value.find(
      (candidate) =>
        isRecord(candidate) && candidate.provider === expectedProvider,
    );
    if (
      !isRecord(rawReference) ||
      rawReference.evidence !== "LIVE_TESTWIRED" ||
      rawReference.evidenceLabel !== "REALDEAL_TEST"
    ) {
      return null;
    }
  }

  return providers;
}

function receiptRejected(): ReceiptEvidenceDecision {
  return {
    valid: false,
    message:
      "The retrieved receipt failed its exact checkpoint, release, request, or provider evidence contract. Nothing was displayed.",
  };
}

export function validateReceiptResponseEvidence(
  response: ApiResponseEnvelope<ReceiptResponse>,
  expectation: ReceiptEvidenceExpectation,
): ReceiptEvidenceDecision {
  const body: unknown = response.data;
  const expected = expectation.checkpointReceipt;
  const liveReleaseCommit = expectation.liveReleaseCommit;
  if (
    response.httpStatus !== 200 ||
    !isRecord(body) ||
    !hasExactKeys(body, RECEIPT_RESPONSE_KEYS) ||
    body.schemaVersion !== RESPONSE_SCHEMA_VERSION ||
    body.ok !== true ||
    !isBoundedIdentifier(body.requestId) ||
    !isBoundedIdentifier(response.headerRequestId) ||
    response.headerRequestId !== body.requestId ||
    response.requestId !== body.requestId ||
    !RELEASE_COMMIT_PATTERN.test(liveReleaseCommit ?? "") ||
    liveReleaseCommit !== expected.releaseCommit ||
    !isRecord(body.receipt)
  ) {
    return receiptRejected();
  }

  const receipt = body.receipt;
  const expectedOperation =
    CHECKPOINT_RECEIPT_OPERATIONS[expected.checkpoint];
  const receiptHasAction = hasOwn(receipt, "action");
  if (
    !hasExactKeys(receipt, JUDGE_RECEIPT_KEYS) ||
    receipt.receiptId !== expected.receiptId ||
    receipt.runId !== expected.runId ||
    receipt.scenarioId !== expected.scenarioId ||
    receipt.scenarioId !== MORROW_SCENARIO.scenarioId ||
    receipt.operation !== expectedOperation ||
    receipt.buildStage !== "TESTWIRED" ||
    receipt.deploymentEvidence !== "LIVE_TESTWIRED" ||
    receipt.releaseCommit !== liveReleaseCommit ||
    !RELEASE_COMMIT_PATTERN.test(String(receipt.releaseCommit)) ||
    !isUtcTimestamp(receipt.createdAt) ||
    receipt.protectedFieldsReturned !== 0
  ) {
    return receiptRejected();
  }

  if (expected.expectedAction === undefined) {
    if (receiptHasAction || JUDGE_ACTION_SET.has(expectedOperation)) {
      return receiptRejected();
    }
  } else if (
    !receiptHasAction ||
    receipt.action !== expected.expectedAction ||
    receipt.operation !== expected.expectedAction
  ) {
    return receiptRejected();
  }

  const providers = validateProviderReceipts(
    receipt.providers,
    expected.expectedProviderReceiptIdsByProvider,
    expected.expectedProviderRequestIdsByProvider,
    receipt.receiptId as string,
    body.requestId,
  );
  if (!providers) {
    return receiptRejected();
  }

  const fields: Partial<Record<EvidenceDisplayFieldId, JsonPrimitive>> = {
    apiRequestId: response.headerRequestId,
    buildStage: "TESTWIRED",
    deploymentEvidence: "LIVE_TESTWIRED",
    releaseCommit: receipt.releaseCommit as string,
    runId: receipt.runId as string,
    scenarioId: receipt.scenarioId as string,
    receiptOperation: receipt.operation as string,
    receiptCreatedAt: receipt.createdAt,
    receiptId: receipt.receiptId as string,
    protectedFieldsReturned: 0,
  };
  const expectedMidnightReceiptId =
    expected.expectedProviderReceiptIdsByProvider.midnight;
  if (
    expectedMidnightReceiptId !== undefined &&
    providers.get("midnight")?.receiptId === expectedMidnightReceiptId
  ) {
    fields.midnightReceiptId = expectedMidnightReceiptId;
  }

  return { valid: true, fields };
}

function addPrimitiveField(
  fields: Partial<Record<EvidenceDisplayFieldId, JsonPrimitive>>,
  field: EvidenceDisplayFieldId,
  value: unknown,
): void {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    fields[field] = value;
  }
}

/**
 * This extractor is called only after validateCheckpointResponseEvidence accepts
 * the mutation. It reads fixed canonical paths and never searches arbitrary
 * nested objects for a familiar key.
 */
export function buildValidatedMutationEvidenceFields(
  stepIndex: number,
  response: ApiResponseEnvelope<JudgeMutationResponse>,
): EvidenceDisplayFields {
  const fields: Partial<Record<EvidenceDisplayFieldId, JsonPrimitive>> = {};
  addPrimitiveField(fields, "apiRequestId", response.headerRequestId);

  const body: unknown = response.data;
  if (!isRecord(body)) {
    return fields;
  }

  addPrimitiveField(fields, "buildStage", body.buildStage);
  addPrimitiveField(fields, "deploymentEvidence", body.deploymentEvidence);
  addPrimitiveField(fields, "releaseCommit", body.releaseCommit);
  addPrimitiveField(fields, "runId", body.runId);
  addPrimitiveField(fields, "scenarioId", body.scenarioId);
  addPrimitiveField(fields, "receiptId", body.receiptId);
  addPrimitiveField(
    fields,
    "protectedFieldsReturned",
    body.protectedFieldsReturned,
  );

  if (isRecord(body.session)) {
    addPrimitiveField(fields, "sessionId", body.session.sessionId);
  }

  if (
    stepIndex === 1 &&
    Array.isArray(body.canonicalMemoryIds) &&
    body.canonicalMemoryIds.length > 0
  ) {
    addPrimitiveField(
      fields,
      "canonicalMemoryId",
      body.canonicalMemoryIds[0],
    );
  }

  if (stepIndex === 2 && Array.isArray(body.matches) && body.matches.length > 0) {
    const firstMatch = body.matches[0];
    if (isRecord(firstMatch)) {
      addPrimitiveField(fields, "canonicalMemoryId", firstMatch.memoryId);
      addPrimitiveField(fields, "semanticDistance", firstMatch.semanticDistance);
      addPrimitiveField(
        fields,
        "projectionGenerationId",
        firstMatch.projectionGenerationId,
      );
    }
  }

  if (stepIndex >= 3) {
    addPrimitiveField(fields, "receiptOperation", body.action);
  }
  if (isRecord(body.result) && (stepIndex === 3 || stepIndex === 6)) {
    addPrimitiveField(
      fields,
      "canonicalMemoryId",
      body.result.canonicalMemoryId,
    );
    addPrimitiveField(
      fields,
      "evidenceCommitment",
      body.result.evidenceCommitment,
    );
    addPrimitiveField(
      fields,
      "projectionGenerationId",
      body.result.projectionGenerationId,
    );
  }
  if (isRecord(body.result) && stepIndex === 5) {
    addPrimitiveField(
      fields,
      "evidenceCommitment",
      body.result.evidenceCommitment,
    );
    addPrimitiveField(
      fields,
      "projectionGenerationId",
      body.result.activeGenerationId,
    );
  }

  return fields;
}
