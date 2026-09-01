import { describe, expect, it } from "vitest";
import {
  evaluateMutationReadiness,
  operationCompletionRemainsReady,
  REQUIRED_SYNTHETIC_SCENARIO_ID,
  statusPermitsMemoryJourney,
} from "./connectionReadiness";

const RELEASE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const readyHealth = { ok: true, releaseCommit: RELEASE_COMMIT };
const readyStatus = {
  ok: true,
  readyForMutations: true,
  releaseCommit: RELEASE_COMMIT,
};
const readyScenarios = {
  scenarios: [
    {
      scenarioId: REQUIRED_SYNTHETIC_SCENARIO_ID,
      synthetic: true,
    },
  ],
};

describe("evaluateMutationReadiness", () => {
  it("unlocks only when health, status, and the exact synthetic case agree", () => {
    expect(
      evaluateMutationReadiness({
        health: readyHealth,
        status: readyStatus,
        scenarios: readyScenarios,
      }),
    ).toMatchObject({ ready: true, reason: "ready" });
  });

  it("requires the health payload to report ok", () => {
    expect(
      evaluateMutationReadiness({
        health: { ok: false },
        status: readyStatus,
        scenarios: readyScenarios,
      }),
    ).toMatchObject({ ready: false, reason: "health-not-ok" });
  });

  it("distinguishes unavailable status from a disconnected provider claim", () => {
    const decision = evaluateMutationReadiness({
      health: readyHealth,
      status: null,
      scenarios: readyScenarios,
    });

    expect(decision.reason).toBe("status-unavailable");
    expect(decision.message).toContain("operational status is unavailable");
  });

  it("requires both endpoints to report the same canonical release commit", () => {
    for (const input of [
      {
        health: { ok: true },
        status: readyStatus,
      },
      {
        health: readyHealth,
        status: { ok: true, readyForMutations: true },
      },
      {
        health: {
          ...readyHealth,
          releaseCommit: RELEASE_COMMIT.toUpperCase(),
        },
        status: readyStatus,
      },
      {
        health: readyHealth,
        status: {
          ...readyStatus,
          releaseCommit: `1${RELEASE_COMMIT.slice(1)}`,
        },
      },
    ]) {
      expect(
        evaluateMutationReadiness({
          health: input.health,
          status: input.status,
          scenarios: readyScenarios,
        }),
      ).toMatchObject({
        ready: false,
        reason: "release-unverified",
      });
    }
  });

  it("requires status ok and readyForMutations independently", () => {
    expect(
      evaluateMutationReadiness({
        health: readyHealth,
        status: { ok: false, readyForMutations: true },
        scenarios: readyScenarios,
      }).reason,
    ).toBe("status-not-ok");
    expect(
      evaluateMutationReadiness({
        health: readyHealth,
        status: { ...readyStatus, readyForMutations: false },
        scenarios: readyScenarios,
      }).reason,
    ).toBe("mutations-not-ready");
  });

  it("distinguishes an unavailable catalog from a missing case", () => {
    expect(
      evaluateMutationReadiness({
        health: readyHealth,
        status: readyStatus,
        scenarios: null,
      }).reason,
    ).toBe("catalog-unavailable");
    expect(
      evaluateMutationReadiness({
        health: readyHealth,
        status: readyStatus,
        scenarios: { scenarios: [] },
      }).reason,
    ).toBe("scenario-missing");
  });

  it("rejects the right scenario unless it is explicitly synthetic", () => {
    const decision = evaluateMutationReadiness({
      health: readyHealth,
      status: readyStatus,
      scenarios: {
        scenarios: [
          {
            scenarioId: REQUIRED_SYNTHETIC_SCENARIO_ID,
            synthetic: false,
          },
        ],
      },
    });

    expect(decision).toMatchObject({
      ready: false,
      reason: "scenario-not-synthetic",
    });
  });
});

describe("operationCompletionRemainsReady", () => {
  const readyCompletion = {
    requestGeneration: 4,
    currentGeneration: 4,
    connectionReady: true,
    statusReadyForMutations: true,
    requestReleaseCommit: RELEASE_COMMIT,
    currentReleaseCommit: RELEASE_COMMIT,
    runReleaseCommit: RELEASE_COMMIT,
  } as const;

  it("accepts only an unchanged ready generation and release", () => {
    expect(operationCompletionRemainsReady(readyCompletion)).toBe(true);
  });

  it("rejects a late result after any connection refresh", () => {
    expect(
      operationCompletionRemainsReady({
        ...readyCompletion,
        currentGeneration: 5,
      }),
    ).toBe(false);
  });

  it("rejects readiness revocation even on the same release", () => {
    expect(
      operationCompletionRemainsReady({
        ...readyCompletion,
        connectionReady: false,
      }),
    ).toBe(false);
    expect(
      operationCompletionRemainsReady({
        ...readyCompletion,
        statusReadyForMutations: false,
      }),
    ).toBe(false);
  });

  it("rejects a changed, missing, or malformed current release", () => {
    for (const currentReleaseCommit of [
      undefined,
      "not-a-commit",
      `1${RELEASE_COMMIT.slice(1)}`,
    ]) {
      expect(
        operationCompletionRemainsReady({
          ...readyCompletion,
          currentReleaseCommit,
        }),
      ).toBe(false);
    }
  });

  it("rejects a run captured on a different deployment", () => {
    expect(
      operationCompletionRemainsReady({
        ...readyCompletion,
        runReleaseCommit: `1${RELEASE_COMMIT.slice(1)}`,
      }),
    ).toBe(false);
  });
});

describe("statusPermitsMemoryJourney", () => {
  it("unlocks on the narrow memory-slice signal without global readiness", () => {
    expect(
      statusPermitsMemoryJourney({
        readyForMutations: false,
        memorySlice: { available: true },
      }),
    ).toBe(true);
  });

  it("unlocks on global readiness for the future fully-promoted day", () => {
    expect(
      statusPermitsMemoryJourney({ readyForMutations: true }),
    ).toBe(true);
  });

  it("stays locked when neither signal is present", () => {
    expect(statusPermitsMemoryJourney(null)).toBe(false);
    expect(statusPermitsMemoryJourney({ readyForMutations: false })).toBe(false);
    expect(
      statusPermitsMemoryJourney({
        readyForMutations: false,
        memorySlice: { available: false },
      }),
    ).toBe(false);
  });

  it("treats a malformed slice signal as locked, never as open", () => {
    expect(
      statusPermitsMemoryJourney({
        readyForMutations: false,
        memorySlice: {},
      }),
    ).toBe(false);
  });
});

describe("evaluateMutationReadiness with the memory slice", () => {
  it("reports ready when the slice is available even though global readiness is false", () => {
    expect(
      evaluateMutationReadiness({
        health: readyHealth,
        status: {
          ...readyStatus,
          readyForMutations: false,
          memorySlice: { available: true },
        },
        scenarios: readyScenarios,
      }).ready,
    ).toBe(true);
  });
});
