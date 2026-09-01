import { describe, expect, it } from "vitest";
import type {
  ApiResponseEnvelope,
  JudgeMutationResponse,
  ReceiptResponse,
} from "./api/types";
import type { VerifiedCheckpointReceiptEvidence } from "./responseEvidence";
import {
  buildValidatedMutationEvidenceFields,
  validateReceiptResponseEvidence,
} from "./receiptEvidence";

const RELEASE_COMMIT = "a".repeat(40);
const REQUEST_ID = "request-receipt-001";
const OPERATION_RECEIPT_ID = "receipt-verify-001";
const MIDNIGHT_RECEIPT_ID = "midnight-receipt-001";

function initialPredicateExpectation(
  overrides: Partial<VerifiedCheckpointReceiptEvidence> = {},
): VerifiedCheckpointReceiptEvidence {
  return {
    checkpoint: "INITIAL_PREDICATE",
    receiptId: OPERATION_RECEIPT_ID,
    runId: "run-001",
    scenarioId: "morrow-farmhouse-testwired-v1",
    releaseCommit: RELEASE_COMMIT,
    expectedAction: "verify_unencumbered",
    expectedProviderReceiptIdsByProvider: {
      midnight: MIDNIGHT_RECEIPT_ID,
    },
    expectedProviderRequestIdsByProvider: {
      gcp: "gcp-request-001",
    },
    ...overrides,
  };
}

function validReceiptResponse(
  receiptOverrides: Record<string, unknown> = {},
  bodyOverrides: Record<string, unknown> = {},
): ApiResponseEnvelope<ReceiptResponse> {
  return {
    httpStatus: 200,
    headerRequestId: REQUEST_ID,
    requestId: REQUEST_ID,
    receivedAt: "2026-08-14T12:05:01.000Z",
    data: {
      schemaVersion: "mhelixctw/api/v1",
      ok: true,
      requestId: REQUEST_ID,
      receipt: {
        receiptId: OPERATION_RECEIPT_ID,
        runId: "run-001",
        scenarioId: "morrow-farmhouse-testwired-v1",
        operation: "verify_unencumbered",
        action: "verify_unencumbered",
        buildStage: "TESTWIRED",
        deploymentEvidence: "LIVE_TESTWIRED",
        releaseCommit: RELEASE_COMMIT,
        createdAt: "2026-08-14T12:05:00.000Z",
        providers: [
          {
            provider: "gcp",
            evidence: "LIVE_TESTWIRED",
            requestId: "gcp-request-001",
            evidenceLabel: "REALDEAL_TEST",
          },
          {
            provider: "midnight",
            evidence: "LIVE_TESTWIRED",
            receiptId: MIDNIGHT_RECEIPT_ID,
            evidenceLabel: "REALDEAL_TEST",
          },
          {
            provider: "didz",
            evidence: "MOCK",
            evidenceLabel: "MOCK",
          },
        ],
        protectedFieldsReturned: 0,
        ...receiptOverrides,
      },
      ...bodyOverrides,
    } as ReceiptResponse,
  };
}

function validate(
  response: ApiResponseEnvelope<ReceiptResponse>,
  checkpointReceipt = initialPredicateExpectation(),
  liveReleaseCommit: string | undefined = RELEASE_COMMIT,
) {
  return validateReceiptResponseEvidence(response, {
    checkpointReceipt,
    liveReleaseCommit,
  });
}

describe("validateReceiptResponseEvidence", () => {
  it("accepts an exact receipt bound to the checkpoint, release, and provider", () => {
    const decision = validate(validReceiptResponse());

    expect(decision.valid).toBe(true);
    if (decision.valid) {
      expect(decision.fields).toEqual({
        apiRequestId: REQUEST_ID,
        buildStage: "TESTWIRED",
        deploymentEvidence: "LIVE_TESTWIRED",
        releaseCommit: RELEASE_COMMIT,
        runId: "run-001",
        scenarioId: "morrow-farmhouse-testwired-v1",
        receiptOperation: "verify_unencumbered",
        receiptCreatedAt: "2026-08-14T12:05:00.000Z",
        receiptId: OPERATION_RECEIPT_ID,
        protectedFieldsReturned: 0,
        midnightReceiptId: MIDNIGHT_RECEIPT_ID,
      });
    }
  });

  it("requires a raw response header even when the display ID fell back to the body", () => {
    const response = {
      ...validReceiptResponse(),
      headerRequestId: undefined,
      requestId: REQUEST_ID,
    };

    expect(validate(response).valid).toBe(false);
  });

  it("rejects header, body, or display request ID disagreement", () => {
    expect(
      validate({
        ...validReceiptResponse(),
        headerRequestId: "request-other-001",
      }).valid,
    ).toBe(false);
    expect(
      validate(
        validReceiptResponse({}, { requestId: "request-other-001" }),
      ).valid,
    ).toBe(false);
    expect(
      validate({
        ...validReceiptResponse(),
        requestId: "request-other-001",
      }).valid,
    ).toBe(false);
  });

  it.each([
    ["receiptId", "receipt-other-001"],
    ["runId", "run-other-001"],
    ["scenarioId", "scenario-other-001"],
    ["operation", "attempt_protected_disclosure"],
    ["action", "attempt_protected_disclosure"],
    ["releaseCommit", "b".repeat(40)],
    ["buildStage", "LOCAL"],
    ["deploymentEvidence", "SOURCE_ONLY"],
    ["protectedFieldsReturned", 1],
    ["createdAt", "not-a-timestamp"],
  ])("rejects a mismatched or invalid receipt %s", (field, value) => {
    expect(validate(validReceiptResponse({ [field]: value })).valid).toBe(false);
  });

  it("rejects a missing or malformed live status release commit", () => {
    expect(
      validateReceiptResponseEvidence(validReceiptResponse(), {
        checkpointReceipt: initialPredicateExpectation(),
        liveReleaseCommit: undefined,
      }).valid,
    ).toBe(false);
    expect(
      validate(validReceiptResponse(), undefined, "not-a-commit").valid,
    ).toBe(false);
  });

  it("binds the live status release to the checkpoint release", () => {
    expect(
      validate(
        validReceiptResponse(),
        initialPredicateExpectation({ releaseCommit: "b".repeat(40) }),
      ).valid,
    ).toBe(false);
  });

  it("rejects unknown response, receipt, and provider keys", () => {
    expect(
      validate(validReceiptResponse({}, { unexpected: true })).valid,
    ).toBe(false);
    expect(
      validate(validReceiptResponse({ unexpected: true })).valid,
    ).toBe(false);

    const response = validReceiptResponse();
    const providers = [
      ...(response.data.receipt.providers as unknown as readonly Record<string, unknown>[]),
    ];
    providers[1] = { ...providers[1], unexpected: true };
    expect(validate(validReceiptResponse({ providers })).valid).toBe(false);
  });

  it("requires action absence for create, close, and recall receipts", () => {
    const expectation = initialPredicateExpectation({
      checkpoint: "CLOSE_SESSION_A",
      expectedAction: undefined,
      expectedProviderReceiptIdsByProvider: {},
    });
    const actionless = validReceiptResponse({
      operation: "close_session",
      action: undefined,
      providers: [
        {
          provider: "gcp",
          evidence: "LIVE_TESTWIRED",
          requestId: "gcp-request-001",
          evidenceLabel: "REALDEAL_TEST",
        },
      ],
    });
    expect(validate(actionless, expectation).valid).toBe(false);

    const {
      action: _removedAction,
      ...receiptWithoutAction
    } = actionless.data.receipt as unknown as Record<string, unknown>;
    const actionlessResponse = {
      ...actionless,
      data: {
        ...actionless.data,
        receipt: receiptWithoutAction,
      },
    } as unknown as ApiResponseEnvelope<ReceiptResponse>;
    expect(
      validate(actionlessResponse, expectation).valid,
    ).toBe(true);
  });

  it("rejects empty, duplicate, or unknown providers", () => {
    expect(
      validate(validReceiptResponse({ providers: [] })).valid,
    ).toBe(false);

    const duplicateProviders = [
      {
        provider: "midnight",
        evidence: "LIVE_TESTWIRED",
        receiptId: MIDNIGHT_RECEIPT_ID,
        evidenceLabel: "REALDEAL_TEST",
      },
      {
        provider: "midnight",
        evidence: "LIVE_TESTWIRED",
        receiptId: "midnight-receipt-002",
        evidenceLabel: "REALDEAL_TEST",
      },
    ];
    expect(
      validate(validReceiptResponse({ providers: duplicateProviders })).valid,
    ).toBe(false);

    expect(
      validate(
        validReceiptResponse({
          providers: [
            {
              provider: "unknown",
              evidence: "LIVE_TESTWIRED",
              receiptId: MIDNIGHT_RECEIPT_ID,
              evidenceLabel: "REALDEAL_TEST",
            },
          ],
        }),
      ).valid,
    ).toBe(false);
  });

  it("rejects missing, mismatched, or cross-provider expected receipt IDs", () => {
    expect(
      validate(
        validReceiptResponse({
          providers: [
            {
              provider: "midnight",
              evidence: "LIVE_TESTWIRED",
              receiptId: "midnight-receipt-other",
              evidenceLabel: "REALDEAL_TEST",
            },
          ],
        }),
      ).valid,
    ).toBe(false);

    expect(
      validate(
        validReceiptResponse(),
        initialPredicateExpectation({
          expectedProviderReceiptIdsByProvider: {
            cockroachdb: MIDNIGHT_RECEIPT_ID,
          },
        }),
      ).valid,
    ).toBe(false);

    expect(
      validate(
        validReceiptResponse({
          providers: [
            {
              provider: "midnight",
              evidence: "LIVE_TESTWIRED",
              receiptId: MIDNIGHT_RECEIPT_ID,
              evidenceLabel: "REALDEAL_TEST",
            },
            {
              provider: "cockroachdb",
              evidence: "LIVE_TESTWIRED",
              receiptId: MIDNIGHT_RECEIPT_ID,
              evidenceLabel: "REALDEAL_TEST",
            },
          ],
        }),
      ).valid,
    ).toBe(false);
  });

  it("requires REALDEAL_TEST linkage and rejects REALDEAL in TestWired", () => {
    expect(
      validate(
        validReceiptResponse({
          providers: [
            {
              provider: "midnight",
              evidence: "LIVE_TESTWIRED",
              receiptId: MIDNIGHT_RECEIPT_ID,
            },
          ],
        }),
      ).valid,
    ).toBe(false);

    expect(
      validate(
        validReceiptResponse({
          providers: [
            {
              provider: "midnight",
              evidence: "LIVE_TESTWIRED",
              receiptId: MIDNIGHT_RECEIPT_ID,
              evidenceLabel: "REALDEAL",
            },
          ],
        }),
      ).valid,
    ).toBe(false);
  });

  it("requires the original GCP mutation request binding", () => {
    expect(
      validate(
        validReceiptResponse({
          providers: [
            {
              provider: "gcp",
              evidence: "LIVE_TESTWIRED",
              requestId: "gcp-request-other-001",
              evidenceLabel: "REALDEAL_TEST",
            },
            {
              provider: "midnight",
              evidence: "LIVE_TESTWIRED",
              receiptId: MIDNIGHT_RECEIPT_ID,
              evidenceLabel: "REALDEAL_TEST",
            },
          ],
        }),
      ).valid,
    ).toBe(false);
  });

  it("rejects MOCK-only receipts and fake-live fixture providers", () => {
    const noProviderExpectations = initialPredicateExpectation({
      expectedProviderReceiptIdsByProvider: {},
      expectedProviderRequestIdsByProvider: {},
    });
    expect(
      validate(
        validReceiptResponse({
          providers: [
            {
              provider: "didz",
              evidence: "MOCK",
              evidenceLabel: "MOCK",
            },
            {
              provider: "agenticdid",
              evidence: "MOCK",
              evidenceLabel: "MOCK",
            },
            {
              provider: "rwaz",
              evidence: "MOCK",
              evidenceLabel: "MOCK",
            },
          ],
        }),
        noProviderExpectations,
      ).valid,
    ).toBe(false);
    expect(
      validate(
        validReceiptResponse({
          providers: [
            {
              provider: "didz",
              evidence: "LIVE_TESTWIRED",
              requestId: "didz-fake-live-001",
              evidenceLabel: "REALDEAL_TEST",
            },
          ],
        }),
        noProviderExpectations,
      ).valid,
    ).toBe(false);
  });

  it("rejects circular and cross-row provider identifiers", () => {
    const noProviderExpectations = initialPredicateExpectation({
      expectedProviderReceiptIdsByProvider: {},
      expectedProviderRequestIdsByProvider: {},
    });
    const providerArrays = [
      [
        {
          provider: "gcp",
          evidence: "LIVE_TESTWIRED",
          receiptId: OPERATION_RECEIPT_ID,
          evidenceLabel: "REALDEAL_TEST",
        },
      ],
      [
        {
          provider: "gcp",
          evidence: "LIVE_TESTWIRED",
          requestId: REQUEST_ID,
          evidenceLabel: "REALDEAL_TEST",
        },
      ],
      [
        {
          provider: "gcp",
          evidence: "LIVE_TESTWIRED",
          receiptId: "provider-same-001",
          requestId: "provider-same-001",
          evidenceLabel: "REALDEAL_TEST",
        },
      ],
      [
        {
          provider: "gcp",
          evidence: "LIVE_TESTWIRED",
          requestId: "provider-shared-001",
          evidenceLabel: "REALDEAL_TEST",
        },
        {
          provider: "cockroachdb",
          evidence: "LIVE_TESTWIRED",
          receiptId: "provider-shared-001",
          evidenceLabel: "REALDEAL_TEST",
        },
      ],
    ];

    for (const providers of providerArrays) {
      expect(
        validate(
          validReceiptResponse({ providers }),
          noProviderExpectations,
        ).valid,
      ).toBe(false);
    }
  });

  it("rejects an outer receipt reused by a provider when no receipt map is expected", () => {
    const expectation = initialPredicateExpectation({
      checkpoint: "CLOSE_SESSION_A",
      expectedAction: undefined,
      expectedProviderReceiptIdsByProvider: {},
    });
    const response = validReceiptResponse({
      operation: "close_session",
      providers: [
        {
          provider: "gcp",
          evidence: "LIVE_TESTWIRED",
          receiptId: OPERATION_RECEIPT_ID,
          requestId: "gcp-request-001",
          evidenceLabel: "REALDEAL_TEST",
        },
      ],
    });
    const { action: _removedAction, ...receiptWithoutAction } =
      response.data.receipt as unknown as Record<string, unknown>;
    const actionlessResponse = {
      ...response,
      data: { ...response.data, receipt: receiptWithoutAction },
    } as unknown as ApiResponseEnvelope<ReceiptResponse>;

    expect(validate(actionlessResponse, expectation).valid).toBe(false);
  });

  it("does not expose an unbound provider receipt", () => {
    const expectation = initialPredicateExpectation({
      expectedProviderReceiptIdsByProvider: {},
    });
    const decision = validate(validReceiptResponse(), expectation);

    expect(decision.valid).toBe(true);
    if (decision.valid) {
      expect(decision.fields.midnightReceiptId).toBeUndefined();
    }
  });
});

describe("buildValidatedMutationEvidenceFields", () => {
  function mutationEnvelope(data: unknown): ApiResponseEnvelope<JudgeMutationResponse> {
    return {
      httpStatus: 200,
      headerRequestId: "request-mutation-001",
      requestId: "request-mutation-001",
      receivedAt: "2026-08-14T12:00:01.000Z",
      data: data as JudgeMutationResponse,
    };
  }

  it("extracts recall evidence only from canonical direct paths", () => {
    const fields = buildValidatedMutationEvidenceFields(
      2,
      mutationEnvelope({
        buildStage: "TESTWIRED",
        deploymentEvidence: "LIVE_TESTWIRED",
        releaseCommit: RELEASE_COMMIT,
        runId: "run-001",
        session: { sessionId: "session-b-001" },
        matches: [
          {
            memoryId: "memory-001",
            semanticDistance: 0.08,
            projectionGenerationId: "projection-001",
          },
        ],
        receiptId: "receipt-recall-001",
        protectedFieldsReturned: 0,
        unrelated: {
          midnightReceiptId: "midnight-unrelated",
          receiptId: "receipt-unrelated",
        },
      }),
    );

    expect(fields).toMatchObject({
      apiRequestId: "request-mutation-001",
      runId: "run-001",
      sessionId: "session-b-001",
      canonicalMemoryId: "memory-001",
      semanticDistance: 0.08,
      projectionGenerationId: "projection-001",
      receiptId: "receipt-recall-001",
      protectedFieldsReturned: 0,
    });
    expect(fields.midnightReceiptId).toBeUndefined();
  });

  it("extracts predicate lineage but hides the provider receipt until fetch binding", () => {
    const fields = buildValidatedMutationEvidenceFields(
      3,
      mutationEnvelope({
        buildStage: "TESTWIRED",
        deploymentEvidence: "LIVE_TESTWIRED",
        releaseCommit: RELEASE_COMMIT,
        runId: "run-001",
        action: "verify_unencumbered",
        result: {
          canonicalMemoryId: "memory-001",
          evidenceCommitment: "sha256:abcdef1234567890",
          projectionGenerationId: "projection-001",
          midnightReceiptId: "midnight-receipt-001",
        },
        receiptId: "receipt-verify-001",
        protectedFieldsReturned: 0,
      }),
    );

    expect(fields).toMatchObject({
      receiptOperation: "verify_unencumbered",
      releaseCommit: RELEASE_COMMIT,
      canonicalMemoryId: "memory-001",
      evidenceCommitment: "sha256:abcdef1234567890",
      projectionGenerationId: "projection-001",
    });
    expect(fields.midnightReceiptId).toBeUndefined();
  });

  it("uses the rebuilt active generation and commitment", () => {
    const fields = buildValidatedMutationEvidenceFields(
      5,
      mutationEnvelope({
        buildStage: "TESTWIRED",
        deploymentEvidence: "LIVE_TESTWIRED",
        releaseCommit: RELEASE_COMMIT,
        runId: "run-001",
        action: "rebuild_recall_projection",
        result: {
          activeGenerationId: "projection-002",
          evidenceCommitment: "sha256:abcdef1234567890",
        },
        receiptId: "receipt-rebuild-001",
        protectedFieldsReturned: 0,
      }),
    );

    expect(fields).toMatchObject({
      receiptOperation: "rebuild_recall_projection",
      evidenceCommitment: "sha256:abcdef1234567890",
      projectionGenerationId: "projection-002",
    });
  });
});
