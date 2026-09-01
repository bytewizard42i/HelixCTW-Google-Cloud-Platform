import { describe, expect, it } from "vitest";
import type {
  ApiResponseEnvelope,
  JudgeMutationResponse,
} from "./api/types";
import {
  isBoundedResponseIdentifier,
  validateCheckpointResponseEvidence as validateCheckpointResponseEvidenceRuntime,
  type VerifiedRunContext,
} from "./responseEvidence";

const REQUEST_ID = "request-open-001";
const CLOSE_REQUEST_ID = "request-close-001";
const RECALL_REQUEST_ID = "request-recall-001";
const INITIAL_PREDICATE_REQUEST_ID = "request-predicate-001";
const DENIAL_REQUEST_ID = "request-denial-001";
const REBUILD_REQUEST_ID = "request-rebuild-001";
const CONTINUITY_REQUEST_ID = "request-continuity-001";
const RELEASE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const CREATED_AT = "2026-08-14T12:00:00.000Z";
const CLOSED_AT = "2026-08-14T12:01:00.000Z";
const SESSION_B_CREATED_AT = "2026-08-14T12:02:00.000Z";
const RUN_ID = "run-test-001";
const SESSION_A_ID = "session-a-test-001";
const SESSION_B_ID = "session-b-test-001";
const MEMORY_ID = "memory-test-001";
const INITIAL_GENERATION_ID = "projection-test-001";
const REBUILT_GENERATION_ID = "projection-test-002";
const EVIDENCE_COMMITMENT = "sha256:abcdef1234567890";

const responseBase = {
  schemaVersion: "mhelixctw/api/v1",
  ok: true,
  requestId: REQUEST_ID,
  buildStage: "TESTWIRED",
  deploymentEvidence: "LIVE_TESTWIRED",
  releaseCommit: RELEASE_COMMIT,
  protectedFieldsReturned: 0,
} as const;

const createRunResponse = {
  ...responseBase,
  runId: RUN_ID,
  scenarioId: "morrow-farmhouse-testwired-v1",
  session: {
    sessionId: SESSION_A_ID,
    ordinal: "A",
    state: "OPEN",
    createdAt: CREATED_AT,
  },
};

const closeSessionResponse = {
  ...responseBase,
  requestId: CLOSE_REQUEST_ID,
  runId: RUN_ID,
  session: {
    sessionId: SESSION_A_ID,
    ordinal: "A",
    state: "CLOSED",
    createdAt: CREATED_AT,
    closedAt: CLOSED_AT,
  },
  canonicalMemoryIds: [MEMORY_ID],
  receiptId: "receipt-close-001",
};

const recallResponse = {
  ...responseBase,
  requestId: RECALL_REQUEST_ID,
  runId: RUN_ID,
  session: {
    sessionId: SESSION_B_ID,
    ordinal: "B",
    state: "OPEN",
    createdAt: SESSION_B_CREATED_AT,
  },
  query: "Where were we, and what am I allowed to ask?",
  matches: [
    {
      memoryId: MEMORY_ID,
      sourceSessionId: SESSION_A_ID,
      objectId: "rwaz:testtown:property:morrow-family-farmhouse",
      permittedPredicate: "property.is_unencumbered",
      semanticDistance: 0.08,
      projectionGenerationId: INITIAL_GENERATION_ID,
    },
  ],
  receiptId: "receipt-recall-001",
};

const initialPredicateResponse = {
  ...responseBase,
  requestId: INITIAL_PREDICATE_REQUEST_ID,
  runId: RUN_ID,
  action: "verify_unencumbered",
  receiptId: "receipt-verify-001",
  result: {
    kind: "VERIFIED_PREDICATE",
    predicate: "property.is_unencumbered",
    value: true,
    sourceTextDisclosed: false,
    canonicalMemoryId: MEMORY_ID,
    evidenceCommitment: EVIDENCE_COMMITMENT,
    projectionGenerationId: INITIAL_GENERATION_ID,
    midnightReceiptId: "midnight-receipt-001",
  },
};

const deniedDisclosureResponse = {
  ...responseBase,
  requestId: DENIAL_REQUEST_ID,
  runId: RUN_ID,
  action: "attempt_protected_disclosure",
  receiptId: "receipt-denial-001",
  result: {
    kind: "DISCLOSURE_DENIED",
    reason: "The synthetic grant permits only the one-bit predicate.",
    requestedProtectedFields: ["deed.full_text", "owner.birth_date"],
  },
};

const rebuildResponse = {
  ...responseBase,
  requestId: REBUILD_REQUEST_ID,
  runId: RUN_ID,
  action: "rebuild_recall_projection",
  receiptId: "receipt-rebuild-001",
  result: {
    kind: "PROJECTION_REBUILT",
    previousGenerationId: INITIAL_GENERATION_ID,
    activeGenerationId: REBUILT_GENERATION_ID,
    canonicalSourceCount: 1,
    commitmentVerified: true,
    evidenceCommitment: EVIDENCE_COMMITMENT,
  },
};

const continuityResponse = {
  ...responseBase,
  requestId: CONTINUITY_REQUEST_ID,
  runId: RUN_ID,
  action: "verify_unencumbered",
  receiptId: "receipt-verify-002",
  result: {
    kind: "VERIFIED_PREDICATE",
    predicate: "property.is_unencumbered",
    value: true,
    sourceTextDisclosed: false,
    canonicalMemoryId: MEMORY_ID,
    evidenceCommitment: EVIDENCE_COMMITMENT,
    projectionGenerationId: REBUILT_GENERATION_ID,
    midnightReceiptId: "midnight-receipt-002",
  },
};

const canonicalPayloads = [
  createRunResponse,
  closeSessionResponse,
  recallResponse,
  initialPredicateResponse,
  deniedDisclosureResponse,
  rebuildResponse,
  continuityResponse,
];

function envelope(payload: unknown): ApiResponseEnvelope<JudgeMutationResponse> {
  const payloadRequestId =
    payload &&
    typeof payload === "object" &&
    typeof (payload as Record<string, unknown>).requestId === "string"
      ? ((payload as Record<string, unknown>).requestId as string)
      : REQUEST_ID;
  return {
    data: payload as JudgeMutationResponse,
    httpStatus: 200,
    headerRequestId: payloadRequestId,
    requestId: payloadRequestId,
    receivedAt: "2026-08-14T12:05:00.000Z",
  };
}

function validateCheckpointResponseEvidence(
  stepIndex: number,
  response: ApiResponseEnvelope<JudgeMutationResponse>,
  previousContext: VerifiedRunContext | null = null,
  liveReleaseCommit: string | undefined = RELEASE_COMMIT,
) {
  return validateCheckpointResponseEvidenceRuntime(
    stepIndex,
    response,
    previousContext,
    liveReleaseCommit,
  );
}

function acceptedContext(
  stepIndex: number,
  payload: unknown,
  previousContext: VerifiedRunContext | null,
): VerifiedRunContext {
  const decision = validateCheckpointResponseEvidence(
    stepIndex,
    envelope(payload),
    previousContext,
  );
  if (!decision.valid) throw new Error(decision.message);
  return decision.context;
}

function contextThroughStep(lastStepIndex: number): VerifiedRunContext {
  let context: VerifiedRunContext | null = null;
  for (let stepIndex = 0; stepIndex <= lastStepIndex; stepIndex += 1) {
    context = acceptedContext(stepIndex, canonicalPayloads[stepIndex], context);
  }
  if (!context) throw new Error("At least one checkpoint is required.");
  return context;
}

describe("isBoundedResponseIdentifier", () => {
  it("accepts only the safe ASCII response-identifier grammar", () => {
    expect(isBoundedResponseIdentifier("a")).toBe(true);
    expect(isBoundedResponseIdentifier("run:test-123_alpha.beta")).toBe(true);
    expect(isBoundedResponseIdentifier(`a${"b".repeat(127)}`)).toBe(true);
  });

  it.each([
    "",
    " leading",
    "trailing ",
    "internal space",
    "line\nbreak",
    "slash/value",
    "back\\slash",
    "unicode-π",
    "#fragment",
    "-leading-punctuation",
    `a${"b".repeat(128)}`,
  ])("rejects unsafe identifier %j", (candidate) => {
    expect(isBoundedResponseIdentifier(candidate)).toBe(false);
  });
});

describe("validateCheckpointResponseEvidence", () => {
  it("accepts the complete canonical evidence chain", () => {
    const context = contextThroughStep(6);

    expect(context).toMatchObject({
      runId: RUN_ID,
      releaseCommit: RELEASE_COMMIT,
      sessionAId: SESSION_A_ID,
      sessionACreatedAt: CREATED_AT,
      sessionAClosedAt: CLOSED_AT,
      sessionBId: SESSION_B_ID,
      sessionBCreatedAt: SESSION_B_CREATED_AT,
      canonicalMemoryIds: [MEMORY_ID],
      recalledMemoryIds: [MEMORY_ID],
      recalledMemoryGenerations: [
        {
          canonicalMemoryId: MEMORY_ID,
          projectionGenerationId: INITIAL_GENERATION_ID,
        },
      ],
      receiptId: "receipt-verify-002",
    });
    expect(context.checkpointReceipts).toHaveLength(6);
    expect(context.checkpointReceipts[2]).toMatchObject({
      checkpoint: "INITIAL_PREDICATE",
      expectedAction: "verify_unencumbered",
      releaseCommit: RELEASE_COMMIT,
      expectedProviderReceiptIdsByProvider: {
        midnight: "midnight-receipt-001",
      },
      expectedProviderRequestIdsByProvider: {
        gcp: INITIAL_PREDICATE_REQUEST_ID,
      },
    });
    expect(context.rebuild).toMatchObject({
      previousGenerationId: INITIAL_GENERATION_ID,
      activeGenerationId: REBUILT_GENERATION_ID,
      canonicalSourceCount: 1,
      evidenceCommitment: EVIDENCE_COMMITMENT,
    });
  });

  it("requires LIVE_TESTWIRED deployment evidence for every mutation", () => {
    for (const deploymentEvidence of [
      "VERIFIED_LOCAL",
      "MOCK",
      "SOURCE_ONLY",
      "PLANNED",
    ]) {
      expect(
        validateCheckpointResponseEvidence(
          0,
          envelope({ ...createRunResponse, deploymentEvidence }),
        ),
      ).toMatchObject({ valid: false });
    }
  });

  it("requires every mutation to match one exact live release commit", () => {
    expect(
      validateCheckpointResponseEvidenceRuntime(
        0,
        envelope(createRunResponse),
        null,
        undefined,
      ),
    ).toMatchObject({ valid: false });

    for (const releaseCommit of [
      "",
      "not-a-commit",
      RELEASE_COMMIT.toUpperCase(),
      `1${RELEASE_COMMIT.slice(1)}`,
    ]) {
      expect(
        validateCheckpointResponseEvidence(
          0,
          envelope({ ...createRunResponse, releaseCommit }),
        ),
      ).toMatchObject({ valid: false });
    }

    const context = contextThroughStep(0);
    const otherReleaseCommit = `1${RELEASE_COMMIT.slice(1)}`;
    expect(
      validateCheckpointResponseEvidence(
        1,
        envelope({ ...closeSessionResponse, releaseCommit: otherReleaseCommit }),
        context,
        otherReleaseCommit,
      ),
    ).toMatchObject({ valid: false });
  });

  it("rejects unknown top-level and nested response fields", () => {
    const topLevelExtra = { ...createRunResponse, unexpected: true };
    const sessionExtra = {
      ...createRunResponse,
      session: { ...createRunResponse.session, unexpected: true },
    };
    const recallContext = contextThroughStep(1);
    const matchExtra = {
      ...recallResponse,
      matches: [{ ...recallResponse.matches[0], unexpected: true }],
    };
    const predicateContext = contextThroughStep(2);
    const resultExtra = {
      ...initialPredicateResponse,
      result: { ...initialPredicateResponse.result, unexpected: true },
    };

    expect(validateCheckpointResponseEvidence(0, envelope(topLevelExtra)))
      .toMatchObject({ valid: false });
    expect(validateCheckpointResponseEvidence(0, envelope(sessionExtra)))
      .toMatchObject({ valid: false });
    expect(
      validateCheckpointResponseEvidence(2, envelope(matchExtra), recallContext),
    ).toMatchObject({ valid: false });
    expect(
      validateCheckpointResponseEvidence(
        3,
        envelope(resultExtra),
        predicateContext,
      ),
    ).toMatchObject({ valid: false });
  });

  it("requires new close and recall receipts without stale inheritance", () => {
    const startWithReceipt = {
      ...createRunResponse,
      receiptId: "receipt-open-001",
    };
    const startContext = acceptedContext(0, startWithReceipt, null);
    const missingCloseReceipt = { ...closeSessionResponse } as Record<string, unknown>;
    delete missingCloseReceipt.receiptId;
    const staleCloseReceipt = {
      ...closeSessionResponse,
      receiptId: "receipt-open-001",
    };

    expect(
      validateCheckpointResponseEvidence(
        1,
        envelope(missingCloseReceipt),
        startContext,
      ),
    ).toMatchObject({ valid: false });
    expect(
      validateCheckpointResponseEvidence(
        1,
        envelope(staleCloseReceipt),
        startContext,
      ),
    ).toMatchObject({ valid: false });

    const closeContext = contextThroughStep(1);
    const missingRecallReceipt = { ...recallResponse } as Record<string, unknown>;
    delete missingRecallReceipt.receiptId;
    const staleRecallReceipt = {
      ...recallResponse,
      receiptId: closeSessionResponse.receiptId,
    };
    expect(
      validateCheckpointResponseEvidence(
        2,
        envelope(missingRecallReceipt),
        closeContext,
      ),
    ).toMatchObject({ valid: false });
    expect(
      validateCheckpointResponseEvidence(
        2,
        envelope(staleRecallReceipt),
        closeContext,
      ),
    ).toMatchObject({ valid: false });
  });

  it("preserves and enforces Session A and Session B chronology", () => {
    const startContext = contextThroughStep(0);
    const changedCreation = {
      ...closeSessionResponse,
      session: {
        ...closeSessionResponse.session,
        createdAt: "2026-08-14T11:59:00.000Z",
      },
    };
    expect(
      validateCheckpointResponseEvidence(
        1,
        envelope(changedCreation),
        startContext,
      ),
    ).toMatchObject({ valid: false });

    const closeContext = contextThroughStep(1);
    for (const createdAt of [CREATED_AT, CLOSED_AT]) {
      const nonLaterSessionB = {
        ...recallResponse,
        session: { ...recallResponse.session, createdAt },
      };
      expect(
        validateCheckpointResponseEvidence(
          2,
          envelope(nonLaterSessionB),
          closeContext,
        ),
      ).toMatchObject({ valid: false });
    }
  });

  it("requires unique recall lineage and binds the first predicate generation", () => {
    const closeContext = contextThroughStep(1);
    const missingGeneration = {
      ...recallResponse,
      matches: [
        {
          memoryId: MEMORY_ID,
          sourceSessionId: SESSION_A_ID,
          objectId: "rwaz:testtown:property:morrow-family-farmhouse",
          permittedPredicate: "property.is_unencumbered",
          semanticDistance: 0.08,
        },
      ],
    };
    const duplicateMatch = {
      ...recallResponse,
      matches: [recallResponse.matches[0], recallResponse.matches[0]],
    };
    expect(
      validateCheckpointResponseEvidence(
        2,
        envelope(missingGeneration),
        closeContext,
      ),
    ).toMatchObject({ valid: false });
    expect(
      validateCheckpointResponseEvidence(
        2,
        envelope(duplicateMatch),
        closeContext,
      ),
    ).toMatchObject({ valid: false });

    const recallContext = contextThroughStep(2);
    const mismatchedGeneration = {
      ...initialPredicateResponse,
      result: {
        ...initialPredicateResponse.result,
        projectionGenerationId: "projection-not-recalled-001",
      },
    };
    expect(
      validateCheckpointResponseEvidence(
        3,
        envelope(mismatchedGeneration),
        recallContext,
      ),
    ).toMatchObject({ valid: false });
  });

  it("accepts only unique protected fields from the fixed allowlist", () => {
    const context = contextThroughStep(3);
    for (const requestedProtectedFields of [
      ["deed.full_text", "deed.full_text"],
      ["server.internal_secret"],
      [],
    ]) {
      const malformedDenial = {
        ...deniedDisclosureResponse,
        result: {
          ...deniedDisclosureResponse.result,
          requestedProtectedFields,
        },
      };
      expect(
        validateCheckpointResponseEvidence(
          4,
          envelope(malformedDenial),
          context,
        ),
      ).toMatchObject({ valid: false });
    }
  });

  it("binds rebuild commitment and source count to canonical history", () => {
    const context = contextThroughStep(4);
    for (const resultOverride of [
      { previousGenerationId: "projection-wrong-001" },
      { activeGenerationId: INITIAL_GENERATION_ID },
      { canonicalSourceCount: 0 },
      { canonicalSourceCount: 2 },
      { commitmentVerified: false },
      { evidenceCommitment: "sha256:different" },
    ]) {
      const malformedRebuild = {
        ...rebuildResponse,
        result: { ...rebuildResponse.result, ...resultOverride },
      };
      expect(
        validateCheckpointResponseEvidence(
          5,
          envelope(malformedRebuild),
          context,
        ),
      ).toMatchObject({ valid: false });
    }
  });

  it("does not reuse any prior checkpoint receipt for an action", () => {
    const context = contextThroughStep(3);
    const reusedReceipt = {
      ...deniedDisclosureResponse,
      receiptId: closeSessionResponse.receiptId,
    };
    expect(
      validateCheckpointResponseEvidence(
        4,
        envelope(reusedReceipt),
        context,
      ),
    ).toMatchObject({ valid: false });
  });

  it("rejects a predicate provider receipt that equals its operation receipt", () => {
    const context = contextThroughStep(2);
    const collidingPredicateReceipt = {
      ...initialPredicateResponse,
      result: {
        ...initialPredicateResponse.result,
        midnightReceiptId: initialPredicateResponse.receiptId,
      },
    };

    expect(
      validateCheckpointResponseEvidence(
        3,
        envelope(collidingPredicateReceipt),
        context,
      ),
    ).toMatchObject({ valid: false });
  });

  it("rejects provider receipt reuse anywhere in checkpoint history", () => {
    const predicateContext = contextThroughStep(3);
    for (const reusedIdentifierResponse of [
      {
        ...deniedDisclosureResponse,
        receiptId: initialPredicateResponse.result.midnightReceiptId,
      },
      {
        ...deniedDisclosureResponse,
        receiptId: INITIAL_PREDICATE_REQUEST_ID,
      },
      {
        ...deniedDisclosureResponse,
        requestId: INITIAL_PREDICATE_REQUEST_ID,
      },
    ]) {
      expect(
        validateCheckpointResponseEvidence(
          4,
          envelope(reusedIdentifierResponse),
          predicateContext,
        ),
      ).toMatchObject({ valid: false });
    }

    const rebuildContext = contextThroughStep(5);
    const providerReusesOperationReceipt = {
      ...continuityResponse,
      result: {
        ...continuityResponse.result,
        midnightReceiptId: deniedDisclosureResponse.receiptId,
      },
    };
    const providerReusesAwsRequest = {
      ...continuityResponse,
      result: {
        ...continuityResponse.result,
        midnightReceiptId: INITIAL_PREDICATE_REQUEST_ID,
      },
    };
    expect(
      validateCheckpointResponseEvidence(
        6,
        envelope(providerReusesAwsRequest),
        rebuildContext,
      ),
    ).toMatchObject({ valid: false });
    expect(
      validateCheckpointResponseEvidence(
        6,
        envelope(providerReusesOperationReceipt),
        rebuildContext,
      ),
    ).toMatchObject({ valid: false });
  });

  it("requires a fresh Midnight receipt after projection rebuild", () => {
    const context = contextThroughStep(5);
    const reusedInitialMidnightReceipt = {
      ...continuityResponse,
      result: {
        ...continuityResponse.result,
        midnightReceiptId: initialPredicateResponse.result.midnightReceiptId,
      },
    };

    expect(
      validateCheckpointResponseEvidence(
        6,
        envelope(reusedInitialMidnightReceipt),
        context,
      ),
    ).toMatchObject({ valid: false });
    expect(
      validateCheckpointResponseEvidence(
        6,
        envelope(continuityResponse),
        context,
      ),
    ).toMatchObject({
      valid: true,
      context: {
        initialPredicate: {
          midnightReceiptId: "midnight-receipt-001",
        },
        receiptId: "receipt-verify-002",
      },
    });
  });

  it("requires continuity on the rebuilt generation and preserved commitment", () => {
    const context = contextThroughStep(5);
    for (const resultOverride of [
      { canonicalMemoryId: "memory-different-001" },
      { evidenceCommitment: "sha256:different" },
      { projectionGenerationId: INITIAL_GENERATION_ID },
      { midnightReceiptId: "" },
    ]) {
      const brokenContinuity = {
        ...continuityResponse,
        result: { ...continuityResponse.result, ...resultOverride },
      };
      expect(
        validateCheckpointResponseEvidence(
          6,
          envelope(brokenContinuity),
          context,
        ),
      ).toMatchObject({ valid: false });
    }
  });

  it.each([3, 4, 5, 6])(
    "does not advance checkpoint %s on a generic receipt",
    (stepIndex) => {
      const context = contextThroughStep(stepIndex - 1);
      const genericReceipt = {
        ...responseBase,
        runId: RUN_ID,
        receiptId: `receipt-generic-${stepIndex}`,
      };
      expect(
        validateCheckpointResponseEvidence(
          stepIndex,
          envelope(genericReceipt),
          context,
        ),
      ).toMatchObject({ valid: false });
    },
  );

  it("requires exact matching raw-header, body, and display request identifiers", () => {
    const mismatchedHeader = {
      ...envelope(createRunResponse),
      headerRequestId: "request-different-001",
    };
    expect(validateCheckpointResponseEvidence(0, mismatchedHeader))
      .toMatchObject({ valid: false });
    const missingHeader = envelope(createRunResponse) as {
      headerRequestId?: string;
    } & ApiResponseEnvelope<JudgeMutationResponse>;
    delete missingHeader.headerRequestId;
    expect(validateCheckpointResponseEvidence(0, missingHeader))
      .toMatchObject({ valid: false });
    expect(
      validateCheckpointResponseEvidence(0, {
        ...envelope(createRunResponse),
        requestId: "request-different-001",
      }),
    ).toMatchObject({ valid: false });
    const missingRequestId = envelope(createRunResponse) as {
      requestId?: string;
    } & ApiResponseEnvelope<JudgeMutationResponse>;
    delete missingRequestId.requestId;
    expect(validateCheckpointResponseEvidence(0, missingRequestId))
      .toMatchObject({ valid: false });
  });
});
