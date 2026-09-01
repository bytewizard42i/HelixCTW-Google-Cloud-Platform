import type {
  HealthResponse,
  ScenariosResponse,
  StatusResponse,
} from "./api/types";

export const REQUIRED_SYNTHETIC_SCENARIO_ID =
  "morrow-farmhouse-testwired-v1";

const RELEASE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

/**
 * The unlock signal for the guided journey. The journey the browser drives is
 * exactly the five-route synthetic memory slice, so the slice signal unlocks
 * it. Global readiness also unlocks it, for the future day every provider is
 * promoted. Anything else stays locked.
 */
export function statusPermitsMemoryJourney(
  status: Pick<StatusResponse, "readyForMutations" | "memorySlice"> | null,
): boolean {
  if (!status) {
    return false;
  }
  return (
    status.readyForMutations === true || status.memorySlice?.available === true
  );
}

export type MutationReadinessReason =
  | "ready"
  | "health-not-ok"
  | "status-unavailable"
  | "status-not-ok"
  | "release-unverified"
  | "mutations-not-ready"
  | "catalog-unavailable"
  | "scenario-missing"
  | "scenario-not-synthetic";

export interface MutationReadinessInput {
  readonly health: HealthResponse;
  readonly status: StatusResponse | null;
  readonly scenarios: ScenariosResponse | null;
}

export interface MutationReadinessDecision {
  readonly ready: boolean;
  readonly reason: MutationReadinessReason;
  readonly message: string;
}

export interface OperationCompletionReadinessInput {
  readonly requestGeneration: number;
  readonly currentGeneration: number;
  readonly connectionReady: boolean;
  readonly statusReadyForMutations: boolean;
  readonly requestReleaseCommit: string | undefined;
  readonly currentReleaseCommit: string | undefined;
  readonly runReleaseCommit?: string;
}

function notReady(
  reason: Exclude<MutationReadinessReason, "ready">,
  message: string,
): MutationReadinessDecision {
  return { ready: false, reason, message };
}

/**
 * Keeps judge mutations locked until three independent public reads agree:
 * health is good, health and status identify the same canonical release,
 * operational status is ready, and the exact fixed case is explicitly
 * catalogued as synthetic.
 */
export function evaluateMutationReadiness({
  health,
  status,
  scenarios,
}: MutationReadinessInput): MutationReadinessDecision {
  if (health.ok !== true) {
    return notReady(
      "health-not-ok",
      "The API answered, but its health response did not report ok: true. Judge actions remain disabled.",
    );
  }
  if (!status) {
    return notReady(
      "status-unavailable",
      "The API health check passed, but operational status is unavailable. Judge actions remain disabled.",
    );
  }
  if (status.ok !== true) {
    return notReady(
      "status-not-ok",
      "The API health check passed, but operational status did not report ok: true. Judge actions remain disabled.",
    );
  }
  const healthReleaseCommit = health.releaseCommit ?? "";
  const statusReleaseCommit = status.releaseCommit ?? "";
  if (
    !RELEASE_COMMIT_PATTERN.test(healthReleaseCommit) ||
    !RELEASE_COMMIT_PATTERN.test(statusReleaseCommit) ||
    healthReleaseCommit !== statusReleaseCommit
  ) {
    return notReady(
      "release-unverified",
      "Health and operational status did not report the same canonical release commit. Judge actions remain disabled.",
    );
  }
  if (!statusPermitsMemoryJourney(status)) {
    return notReady(
      "mutations-not-ready",
      "The API responded, but neither global mutation readiness nor the reviewed memory slice is available. Judge actions remain disabled.",
    );
  }
  if (!scenarios) {
    return notReady(
      "catalog-unavailable",
      "The API health and status endpoints reported ready, but the scenario catalog is unavailable. Judge actions remain disabled.",
    );
  }

  const catalog = scenarios.scenarios;
  if (!Array.isArray(catalog)) {
    return notReady(
      "scenario-missing",
      "The scenario catalog does not contain the required Morrow farmhouse case. Judge actions remain disabled.",
    );
  }
  const requiredScenario = catalog.find(
    (scenario) => scenario.scenarioId === REQUIRED_SYNTHETIC_SCENARIO_ID,
  );
  if (!requiredScenario) {
    return notReady(
      "scenario-missing",
      "The scenario catalog does not contain the required Morrow farmhouse case. Judge actions remain disabled.",
    );
  }
  if (requiredScenario.synthetic !== true) {
    return notReady(
      "scenario-not-synthetic",
      "The required Morrow farmhouse scenario is not explicitly marked synthetic. Judge actions remain disabled.",
    );
  }

  return {
    ready: true,
    reason: "ready",
    message:
      "The API health check and operational status agree on one release, and the synthetic Morrow scenario catalog reports ready.",
  };
}

/**
 * Rechecks the readiness facts captured before a mutation or receipt read.
 * A connection refresh increments the generation immediately, so even a late
 * response from the same release cannot advance after readiness was revoked.
 */
export function operationCompletionRemainsReady({
  requestGeneration,
  currentGeneration,
  connectionReady,
  statusReadyForMutations,
  requestReleaseCommit,
  currentReleaseCommit,
  runReleaseCommit,
}: OperationCompletionReadinessInput): boolean {
  if (
    requestGeneration !== currentGeneration ||
    !connectionReady ||
    !statusReadyForMutations ||
    !RELEASE_COMMIT_PATTERN.test(requestReleaseCommit ?? "") ||
    !RELEASE_COMMIT_PATTERN.test(currentReleaseCommit ?? "") ||
    requestReleaseCommit !== currentReleaseCommit
  ) {
    return false;
  }

  return (
    runReleaseCommit === undefined ||
    (RELEASE_COMMIT_PATTERN.test(runReleaseCommit) &&
      runReleaseCommit === currentReleaseCommit)
  );
}
