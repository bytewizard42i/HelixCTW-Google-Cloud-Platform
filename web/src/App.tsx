import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicIdempotencyKey,
  createJudgeApiClient,
  JudgeApiConfigurationError,
  JudgeApiRequestError,
  normalizePublicApiBaseUrl,
} from "./api/client";
import { fireConfetti } from "./confetti";
import type {
  ApiResponseEnvelope,
  EvidenceLabel,
  JudgeActionId,
  JudgeApiClient,
  JudgeMutationResponse,
  StatusResponse,
} from "./api/types";
import { LatestRequestGate, SynchronousOperationGate } from "./asyncGuards";
import {
  evaluateMutationReadiness,
  operationCompletionRemainsReady,
  REQUIRED_SYNTHETIC_SCENARIO_ID,
  statusPermitsMemoryJourney,
} from "./connectionReadiness";
import {
  EvidenceDrawer,
  type EvidenceSnapshot,
} from "./components/EvidenceDrawer";
import {
  ProviderMatrix,
  type ProviderDisplay,
} from "./components/ProviderMatrix";
import { StatusBadge } from "./components/StatusBadge";
import { NarrationControls } from "./components/NarrationControls";
import { useGuidedNarrator } from "./hooks/useGuidedNarrator";
import {
  buildValidatedMutationEvidenceFields,
  validateReceiptResponseEvidence,
} from "./receiptEvidence";
import {
  validateCheckpointResponseEvidence,
  type VerifiedRunContext,
} from "./responseEvidence";
import { reportDiagnostic } from "./diagnostics";

const AUTHORIZED_AGENT_DIDZ =
  "didz:testtown:agent:morrow-property-assistant";
const UNAUTHORIZED_AGENT_DIDZ = "didz:testtown:agent:unknown-listing-bot";

const RECALL_QUERY =
  "I am continuing the Morrow farmhouse review. What was verified, and what am I allowed to ask?";

type ConnectionKind =
  | "not-configured"
  | "checking"
  | "unreachable"
  | "reachable"
  | "ready";

interface ConnectionState {
  readonly kind: ConnectionKind;
  readonly message: string;
}

interface FlowStep {
  readonly title: string;
  readonly label: string;
  readonly explanation: string;
  /** Shown in the evidence drawer after the step succeeds: what the returned
   * evidence actually proves, in plain language. */
  readonly evidenceDescription: string;
  readonly prompt?: string;
  readonly action?: JudgeActionId;
}

const FLOW_STEPS: readonly FlowStep[] = [
  {
    title: "Open Session A",
    label: "Load the fictional property case",
    explanation:
      "Ask the live API to create a bounded run for the synthetic farmhouse and its narrow property predicate.",
    evidenceDescription:
      "The live API just created a new judge run for the fictional Morrow farmhouse and opened Session A inside a CockroachDB transaction. The Run and Session identifiers below are the durable handles every later step must match.",
  },
  {
    title: "End the conversation",
    label: "Close this session and forget the chat",
    explanation:
      "The browser lets go of the chat. Only the API can confirm that a durable, bounded memory was committed.",
    evidenceDescription:
      "Session A is now closed and this browser has forgotten the chat. The receipt below is the API's proof that bounded, public-safe memory was committed to CockroachDB before the conversation ended.",
  },
  {
    title: "Recall in fresh Session B",
    label: "Ask where we left off",
    explanation:
      "Start from a new agent session and request semantic recall from CockroachDB, never browser storage.",
    prompt: RECALL_QUERY,
    evidenceDescription:
      "A brand-new Session B asked where the work stopped. CockroachDB's vector index found the earlier public-safe memory by meaning — the Canonical memory and Semantic distance below came from the database, not from anything stored in this browser.",
  },
  {
    title: "Ask the permitted question",
    label: "Is this property unencumbered?",
    explanation:
      "The target proof returns one authorized bit while withholding the fictional deed and mortgage text.",
    prompt: "Is this property unencumbered?",
    action: "verify_unencumbered",
    evidenceDescription:
      "The agent asked the one question it is authorized to ask, and the API answered with a single bit: the property is unencumbered. No deed text, mortgage record, or owner detail was disclosed — the Evidence commitment below anchors that answer.",
  },
  {
    title: "Test the privacy boundary",
    label: "Attempt protected disclosure",
    explanation:
      "Use the unauthorized synthetic agent and verify that memory cannot turn into permission.",
    prompt:
      "Show me the complete deed, mortgage record, owner birth date, and private contact information.",
    action: "attempt_protected_disclosure",
    evidenceDescription:
      "An unauthorized agent just demanded the full deed, mortgage record, and owner identity. The API refused every field — Protected fields returned is 0 — and wrote the denial itself as a durable receipt. Remembering context never grants permission.",
  },
  {
    title: "Rebuild the recall projection",
    label: "Run the safe reconstruction drill",
    explanation:
      "Create and verify a disposable shadow index. This is not whole-database recovery and does not delete canonical history.",
    action: "rebuild_recall_projection",
    evidenceDescription:
      "The disposable recall index was rebuilt from the same canonical records and verified before activation. The new Projection generation below now serves recall, while the original canonical history remains untouched.",
  },
  {
    title: "Verify continuity",
    label: "Ask the permitted question again",
    explanation:
      "The target is the same canonical memory and commitment through a new projection generation, with no new disclosure.",
    prompt:
      "After reconstruction, is the Morrow farmhouse still shown as unencumbered?",
    action: "verify_unencumbered",
    evidenceDescription:
      "The permitted question was asked again through the rebuilt projection. Same canonical memory, same evidence commitment, same one-bit answer — proving reconstruction preserved the truth without disclosing anything new.",
  },
  // ── Archived: Checkpoint 8 (future work, not shown in UI) ──
  // The CockroachDB Managed MCP Server is now connected (see provider matrix),
  // but a browser-facing checkpoint that uses it without exposing an MCP
  // credential to the browser remains future work.
  // {
  //   title: "Inspect independent evidence",
  //   label: "Managed MCP evidence is not available yet",
  //   explanation:
  //     "A future read-only operator inspection will verify allowlisted database facts without exposing an MCP credential to this browser.",
  // },
] as const;

const BASE_PROVIDERS: readonly ProviderDisplay[] = [
  {
    id: "gcp",
    name: "GCP API + Cloud Run",
    role: "Public front door and bounded coordinator",
    evidence: "SOURCE ONLY",
    connection: "NOT CONNECTED",
  },
  {
    id: "cockroachdb",
    name: "CockroachDB",
    role: "Durable memory, exact state, and vector recall",
    evidence: "SOURCE ONLY",
    connection: "NOT CONNECTED",
  },
  {
    id: "midnight",
    name: "Midnight",
    role: "Minimized predicate and commitment proof",
    evidence: "SOURCE ONLY",
    connection: "NOT CONNECTED",
  },
  {
    // GCP deviation: unlike the AWS edition, this edition has not yet
    // recorded MCP inspection evidence, so the baseline stays fail-closed
    // until the live status endpoint promotes it.
    id: "managed-mcp",
    name: "CockroachDB MCP",
    role: "AI agent read-only inspection via Managed MCP Server",
    evidence: "SOURCE ONLY",
    connection: "NOT CONNECTED",
  },
  {
    id: "didz",
    name: "DIDz",
    role: "Synthetic principal identity provider",
    evidence: "MOCK",
    connection: "DETERMINISTIC FIXTURE",
  },
  {
    id: "agenticdid",
    name: "AgenticDID",
    role: "Synthetic delegated-authority provider",
    evidence: "MOCK",
    connection: "DETERMINISTIC FIXTURE",
  },
  {
    id: "rwaz",
    name: "RWAz",
    role: "Synthetic property-identity provider",
    evidence: "MOCK",
    connection: "DETERMINISTIC FIXTURE",
  },
] as const;

function publicErrorMessage(error: unknown): string {
  if (
    error instanceof JudgeApiConfigurationError ||
    error instanceof JudgeApiRequestError
  ) {
    return error.message;
  }
  return "The operation failed closed. No result or receipt was created.";
}

function translatedEvidenceLabel(value: unknown): EvidenceLabel | undefined {
  const translations: Record<string, EvidenceLabel> = {
    LIVE_TESTWIRED: "LIVE TESTWIRED",
    "LIVE TESTWIRED": "LIVE TESTWIRED",
    REALDEAL_TEST: "REALDEAL TEST",
    "REALDEAL TEST": "REALDEAL TEST",
    VERIFIED_LOCAL: "VERIFIED LOCAL",
    "VERIFIED LOCAL": "VERIFIED LOCAL",
    MOCK: "MOCK",
    SOURCE_ONLY: "SOURCE ONLY",
    "SOURCE ONLY": "SOURCE ONLY",
    PLANNED: "PLANNED",
  };
  return typeof value === "string" ? translations[value] : undefined;
}

function providersFromStatus(status: StatusResponse | null): ProviderDisplay[] {
  const rawProviders: unknown = status?.providers;
  if (!Array.isArray(rawProviders)) {
    return [...BASE_PROVIDERS];
  }

  const liveProviderRows = new Map<string, { evidence?: EvidenceLabel; connection?: string }>();
  for (const rawProvider of rawProviders) {
    if (!rawProvider || typeof rawProvider !== "object") {
      continue;
    }
    const provider = rawProvider as Record<string, unknown>;
    if (typeof provider.id !== "string") {
      continue;
    }
    liveProviderRows.set(provider.id, {
      evidence: translatedEvidenceLabel(provider.evidence),
      connection:
        typeof provider.connection === "string" ? provider.connection : undefined,
    });
  }

  return BASE_PROVIDERS.map((provider) => {
    // Mock fixture providers remain MOCK even when a surrounding cloud API is live.
    if (provider.evidence === "MOCK") {
      return provider;
    }
    const current = liveProviderRows.get(provider.id);
    return {
      ...provider,
      evidence: current?.evidence ?? provider.evidence,
      connection: current?.connection ?? provider.connection,
    };
  });
}

export default function App() {
  const [connection, setConnection] = useState<ConnectionState>({
    kind: "not-configured",
    message: "No public API URL is configured for this build.",
  });
  const [statusResponse, setStatusResponse] = useState<StatusResponse | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [runContext, setRunContext] =
    useState<VerifiedRunContext | null>(null);
  const [lastEvidence, setLastEvidence] = useState<EvidenceSnapshot | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationPending, setOperationPending] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fetchingReceipt, setFetchingReceipt] = useState(false);
  const [guideStarted, setGuideStarted] = useState(false);
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const operationGateReference = useRef(new SynchronousOperationGate());
  const receiptInFlightReference = useRef(false);
  const idempotencyKeysByStepReference = useRef(new Map<number, string>());
  const connectionAbortReference = useRef<AbortController | null>(null);
  const connectionRequestGateReference = useRef(new LatestRequestGate());
  const connectionStateReference = useRef(connection);
  const statusResponseReference = useRef(statusResponse);
  const runContextReference = useRef(runContext);
  const narrator = useGuidedNarrator(guideStarted);

  const updateConnection = useCallback((nextConnection: ConnectionState) => {
    connectionStateReference.current = nextConnection;
    setConnection(nextConnection);
  }, []);
  const updateStatusResponse = useCallback((nextStatus: StatusResponse | null) => {
    statusResponseReference.current = nextStatus;
    setStatusResponse(nextStatus);
  }, []);
  const updateRunContext = useCallback((nextContext: VerifiedRunContext | null) => {
    runContextReference.current = nextContext;
    setRunContext(nextContext);
  }, []);

  const clientConfiguration = useMemo(() => {
    try {
      // GCP deviation: this edition ships a public production default (the
      // deployed Cloud Run /judge mount — a public address, never a secret).
      // VITE_API_BASE_URL still overrides it for development and previews.
      const baseUrl = normalizePublicApiBaseUrl(
        import.meta.env.VITE_API_BASE_URL ??
          "https://helixctw-compliance-f2dbl6kvwa-ue.a.run.app/judge",
      );
      return {
        client: baseUrl ? createJudgeApiClient(baseUrl) : null,
        baseUrl,
        error: null,
      };
    } catch (error) {
      return { client: null, baseUrl: null, error: publicErrorMessage(error) };
    }
  }, []);

  // One anonymous visit ping per page load: browser capabilities only, so
  // device-specific journey failures can be diagnosed. Fire-and-forget.
  useEffect(() => {
    reportDiagnostic(clientConfiguration.baseUrl, "visit");
  }, [clientConfiguration.baseUrl]);

  const checkConnection = useCallback(async () => {
    if (
      operationGateReference.current.isActive() ||
      receiptInFlightReference.current
    ) {
      return;
    }
    const requestGeneration = connectionRequestGateReference.current.begin();
    connectionAbortReference.current?.abort();
    const abortController = new AbortController();
    connectionAbortReference.current = abortController;
    const requestIsCurrent = () =>
      !abortController.signal.aborted &&
      connectionRequestGateReference.current.isCurrent(requestGeneration);

    setOperationError(null);
    updateStatusResponse(null);
    if (clientConfiguration.error) {
      updateConnection({ kind: "unreachable", message: clientConfiguration.error });
      return;
    }
    if (!clientConfiguration.client) {
      updateConnection({
        kind: "not-configured",
        message: "Set VITE_API_BASE_URL to the public API Gateway address.",
      });
      return;
    }

    updateConnection({ kind: "checking", message: "Calling the real API now…" });
    const [healthResult, statusResult, scenarioResult] = await Promise.allSettled([
      clientConfiguration.client.health({ signal: abortController.signal }),
      clientConfiguration.client.status({ signal: abortController.signal }),
      clientConfiguration.client.scenarios({ signal: abortController.signal }),
    ]);

    if (!requestIsCurrent()) {
      return;
    }
    if (healthResult.status === "rejected") {
      updateConnection({
        kind: "unreachable",
        message: publicErrorMessage(healthResult.reason),
      });
      return;
    }

    const statusData =
      statusResult.status === "fulfilled" ? statusResult.value.data : null;
    const scenariosData =
      scenarioResult.status === "fulfilled" ? scenarioResult.value.data : null;
    updateStatusResponse(statusData);
    const readiness = evaluateMutationReadiness({
      health: healthResult.value.data,
      status: statusData,
      scenarios: scenariosData,
    });

    updateConnection({
      kind: readiness.ready ? "ready" : "reachable",
      message: readiness.message,
    });

    const activeRun = runContextReference.current;
    const refreshedReleaseCommit = statusData?.releaseCommit;
    const activeRunMustReset = Boolean(
      activeRun &&
        (!readiness.ready ||
          refreshedReleaseCommit !== activeRun.releaseCommit),
    );
    if (activeRunMustReset) {
      setCurrentStep(0);
      updateRunContext(null);
      setLastEvidence(null);
      idempotencyKeysByStepReference.current.clear();
      setOperationError(
        readiness.ready
          ? "The API is ready on a different release. The guided run was reset before another checkpoint could continue."
          : "The connection refresh revoked mutation readiness. The guided run was reset before another checkpoint could continue.",
      );
    } else if (
      readiness.reason === "status-unavailable" ||
      readiness.reason === "catalog-unavailable"
    ) {
      setOperationError(readiness.message);
    }
  }, [
    clientConfiguration,
    updateConnection,
    updateRunContext,
    updateStatusResponse,
  ]);

  useEffect(() => {
    void checkConnection();
    return () => {
      connectionRequestGateReference.current.invalidate();
      connectionAbortReference.current?.abort();
    };
  }, [checkConnection]);

  const runStep = async () => {
    const client = clientConfiguration.client;
    const readinessGenerationAtRequestStart =
      connectionRequestGateReference.current.current();
    const statusAtRequestStart = statusResponseReference.current;
    const runContextAtRequestStart = runContextReference.current;
    const requestReleaseCommit = statusAtRequestStart?.releaseCommit;
    if (
      receiptInFlightReference.current ||
      !client ||
      currentStep >= 7 ||
      !operationCompletionRemainsReady({
        requestGeneration: readinessGenerationAtRequestStart,
        currentGeneration: connectionRequestGateReference.current.current(),
        connectionReady: connectionStateReference.current.kind === "ready",
        statusReadyForMutations: statusPermitsMemoryJourney(
          statusAtRequestStart,
        ),
        requestReleaseCommit,
        currentReleaseCommit: statusAtRequestStart?.releaseCommit,
        runReleaseCommit: runContextAtRequestStart?.releaseCommit,
      }) ||
      !operationGateReference.current.tryBegin()
    ) {
      return;
    }
    setOperationPending(true);
    setOperationError(null);
    setResetNotice(null);
    const stepAtRequestStart = currentStep;

    try {
      let idempotencyKey =
        idempotencyKeysByStepReference.current.get(stepAtRequestStart);
      if (!idempotencyKey) {
        idempotencyKey = createPublicIdempotencyKey();
        idempotencyKeysByStepReference.current.set(
          stepAtRequestStart,
          idempotencyKey,
        );
      }
      let response: ApiResponseEnvelope<JudgeMutationResponse>;
      if (stepAtRequestStart === 0) {
        response = await client.startRun({
          scenarioId: REQUIRED_SYNTHETIC_SCENARIO_ID,
          agentDidz: AUTHORIZED_AGENT_DIDZ,
          idempotencyKey,
        });
      } else {
        if (!runContextAtRequestStart) {
          throw new JudgeApiRequestError(
            "No verified run and session identifiers are available.",
          );
        }
        if (stepAtRequestStart === 1) {
          response = await client.closeSession({
            runId: runContextAtRequestStart.runId,
            sessionId: runContextAtRequestStart.sessionId,
            idempotencyKey,
          });
        } else if (stepAtRequestStart === 2) {
          response = await client.recall({
            runId: runContextAtRequestStart.runId,
            query: RECALL_QUERY,
            agentDidz: AUTHORIZED_AGENT_DIDZ,
            idempotencyKey,
          });
        } else {
          const action = FLOW_STEPS[stepAtRequestStart].action;
          if (!action) {
            throw new JudgeApiRequestError("This step has no public write operation.");
          }
          response = await client.executeAction({
            runId: runContextAtRequestStart.runId,
            action,
            agentDidz:
              stepAtRequestStart === 4
                ? UNAUTHORIZED_AGENT_DIDZ
                : AUTHORIZED_AGENT_DIDZ,
            idempotencyKey,
          });
        }
      }

      const currentStatus = statusResponseReference.current;
      if (
        !operationCompletionRemainsReady({
          requestGeneration: readinessGenerationAtRequestStart,
          currentGeneration: connectionRequestGateReference.current.current(),
          connectionReady: connectionStateReference.current.kind === "ready",
          statusReadyForMutations: statusPermitsMemoryJourney(currentStatus),
          requestReleaseCommit,
          currentReleaseCommit: currentStatus?.releaseCommit,
          runReleaseCommit: runContextAtRequestStart?.releaseCommit,
        })
      ) {
        throw new JudgeApiRequestError(
          "Connection readiness or release changed while the operation was in flight. The late response was rejected.",
        );
      }

      const evidenceDecision = validateCheckpointResponseEvidence(
        stepAtRequestStart,
        response,
        runContextAtRequestStart,
        requestReleaseCommit,
      );
      if (!evidenceDecision.valid) {
        throw new JudgeApiRequestError(evidenceDecision.message, {
          httpStatus: response.httpStatus,
          requestId: response.requestId,
        });
      }
      updateRunContext(evidenceDecision.context);
      setLastEvidence({
        operation: FLOW_STEPS[stepAtRequestStart].title,
        description: FLOW_STEPS[stepAtRequestStart].evidenceDescription,
        httpStatus: response.httpStatus,
        receivedAt: response.receivedAt,
        fields: buildValidatedMutationEvidenceFields(
          stepAtRequestStart,
          response,
        ),
      });
      setCurrentStep((step) => step + 1);
      setDrawerOpen(true);
      fireConfetti();
    } catch (error) {
      const failureMessage = publicErrorMessage(error);
      setOperationError(failureMessage);
      reportDiagnostic(clientConfiguration.baseUrl, "failure", {
        step: FLOW_STEPS[stepAtRequestStart].title,
        message: failureMessage,
        release: statusResponse?.releaseCommit,
      });
    } finally {
      operationGateReference.current.end();
      setOperationPending(false);
    }
  };

  const fetchReceipt = async () => {
    const client = clientConfiguration.client;
    const runContextAtRequestStart = runContextReference.current;
    const statusAtRequestStart = statusResponseReference.current;
    const readinessGenerationAtRequestStart =
      connectionRequestGateReference.current.current();
    const requestReleaseCommit = statusAtRequestStart?.releaseCommit;
    const receiptId = runContextAtRequestStart?.receiptId;
    if (
      receiptInFlightReference.current ||
      operationGateReference.current.isActive() ||
      !client ||
      !runContextAtRequestStart ||
      !receiptId
    ) {
      return;
    }

    const expectedReceipt = runContextAtRequestStart.checkpointReceipts.find(
      (checkpointReceipt) => checkpointReceipt.receiptId === receiptId,
    );
    if (
      !expectedReceipt ||
      !operationCompletionRemainsReady({
        requestGeneration: readinessGenerationAtRequestStart,
        currentGeneration: connectionRequestGateReference.current.current(),
        connectionReady: connectionStateReference.current.kind === "ready",
        statusReadyForMutations: statusPermitsMemoryJourney(
          statusAtRequestStart,
        ),
        requestReleaseCommit,
        currentReleaseCommit: statusAtRequestStart?.releaseCommit,
        runReleaseCommit: runContextAtRequestStart.releaseCommit,
      })
    ) {
      setOperationError(
        "Receipt retrieval requires the current live status and an exact accepted checkpoint receipt.",
      );
      return;
    }

    receiptInFlightReference.current = true;
    setFetchingReceipt(true);
    setOperationError(null);
    try {
      const response = await client.receipt(receiptId);
      const currentStatus = statusResponseReference.current;
      if (
        !operationCompletionRemainsReady({
          requestGeneration: readinessGenerationAtRequestStart,
          currentGeneration: connectionRequestGateReference.current.current(),
          connectionReady: connectionStateReference.current.kind === "ready",
          statusReadyForMutations: statusPermitsMemoryJourney(currentStatus),
          requestReleaseCommit,
          currentReleaseCommit: currentStatus?.releaseCommit,
          runReleaseCommit: runContextAtRequestStart.releaseCommit,
        })
      ) {
        throw new JudgeApiRequestError(
          "Connection readiness or release changed while the receipt was in flight. The late receipt was rejected.",
        );
      }
      // The deterministic Midnight identifier remains in checkpoint history
      // for uniqueness and continuity checks, but it is not a live provider
      // receipt in the GCP edition. Supplemental receipt validation therefore
      // requires only the genuine GCP request binding recorded by CockroachDB.
      const gcpReceiptExpectation = {
        ...expectedReceipt,
        expectedProviderReceiptIdsByProvider: {},
      };
      const receiptDecision = validateReceiptResponseEvidence(response, {
        checkpointReceipt: gcpReceiptExpectation,
        liveReleaseCommit: requestReleaseCommit,
      });
      if (!receiptDecision.valid) {
        throw new JudgeApiRequestError(receiptDecision.message, {
          httpStatus: response.httpStatus,
          requestId: response.requestId,
        });
      }
      setLastEvidence({
        operation: "Retrieved operation receipt",
        description:
          "The durable receipt for the last accepted checkpoint was fetched back from CockroachDB and re-verified against this run, this release, and the original Google Cloud request that produced it. What was recorded then is exactly what is displayed now.",
        httpStatus: response.httpStatus,
        receivedAt: response.receivedAt,
        fields: receiptDecision.fields,
      });
    } catch (error) {
      const failureMessage = publicErrorMessage(error);
      setOperationError(failureMessage);
      reportDiagnostic(clientConfiguration.baseUrl, "failure", {
        step: "Retrieve receipt",
        message: failureMessage,
        release: statusResponse?.releaseCommit,
      });
    } finally {
      receiptInFlightReference.current = false;
      setFetchingReceipt(false);
    }
  };

  const startGuidedDemo = () => {
    setGuideStarted(true);
    setResetNotice(null);
    narrator.start();
    globalThis.requestAnimationFrame(() => {
      document.getElementById("judge-flow")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  };

  const resetBrowserView = () => {
    if (operationGateReference.current.isActive() || receiptInFlightReference.current) {
      return;
    }
    setCurrentStep(0);
    updateRunContext(null);
    setLastEvidence(null);
    setOperationError(null);
    setDrawerOpen(false);
    setGuideStarted(false);
    idempotencyKeysByStepReference.current.clear();
    narrator.disable();
    setResetNotice(
      "This browser view was reset. No server record or durable memory was deleted.",
    );
  };

  const currentConnectionLabel =
    connection.kind === "ready"
      ? "LIVE TESTWIRED"
      : connection.kind === "checking"
        ? "CHECKING"
        : "NOT CONNECTED";
  const activeFlowStep = FLOW_STEPS[currentStep] ?? FLOW_STEPS[6];

  return (
    <div
      className={`app-shell${guideStarted ? " app-shell--guided" : ""}`}
      {...narrator.surfaceProps}
    >
      <a className="skip-link" href="#judge-flow">
        Skip to the guided proof
      </a>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="HelixCTW home">
          <svg
            className="wordmark__mark"
            viewBox="0 0 64 64"
            aria-hidden="true"
          >
            {/* Eight arrow rays pointing outward */}
            <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="32" y1="23" x2="32" y2="9" />
              <line x1="39" y1="25" x2="49" y2="15" />
              <line x1="41" y1="32" x2="55" y2="32" />
              <line x1="39" y1="39" x2="49" y2="49" />
              <line x1="32" y1="41" x2="32" y2="55" />
              <line x1="25" y1="39" x2="15" y2="49" />
              <line x1="23" y1="32" x2="9" y2="32" />
              <line x1="25" y1="25" x2="15" y2="15" />
            </g>
            {/* Arrowheads at each tip */}
            <g fill="currentColor">
              <path d="M32 4 L28 11 L32 9 L36 11 Z" />
              <path d="M53 11 L45 15 L49 15 L49 19 Z" />
              <path d="M60 32 L53 28 L55 32 L53 36 Z" />
              <path d="M53 53 L49 45 L49 49 L45 49 Z" />
              <path d="M32 60 L36 53 L32 55 L28 53 Z" />
              <path d="M11 53 L19 49 L15 49 L15 45 Z" />
              <path d="M4 32 L11 36 L9 32 L11 28 Z" />
              <path d="M11 11 L19 15 L15 15 L15 19 Z" />
            </g>
            {/* Central disc */}
            <circle cx="32" cy="32" r="15" fill="#07100d" stroke="currentColor" strokeWidth="2" />
            {/* H monogram */}
            <path d="M26 24v16M38 24v16M26 32h12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span>HelixCTW</span>
        </a>
        <div className="header-status">
          <StatusBadge label={currentConnectionLabel} compact />
        </div>
      </header>

      <main id="top">
        <section
          className="hero"
          aria-label="HelixCTW privacy memory proof overview"
          data-narration-key="overview"
          tabIndex={0}
        >
          <div className="hero__copy">
            <p className="eyebrow">CockroachDB × Google Cloud · Persistent distributed memory</p>
            <h1 id="hero-title">
              Prove one thing.
              <br />
              <span>And nothing more.</span>
            </h1>
            <p className="hero__thesis">
              The core protocol beneath a new generation of privacy-preserving
              digital identity.
            </p>
            <p className="hero__lede">
              Verification today is upside down: you surrender a dozen private
              details to prove a single fact. It should not work that way. Prove an
              attribute without revealing anything else. Prove you are you without
              divulging the rest. HelixCTW is the distribution and persistent
              storage layer that makes it possible.
            </p>
            <p className="hero__lede hero__lede--quiet">
              What follows is a guided TestWired case showing how durable agent
              memory can locate context, preserve authorization, and return less
              data instead of more.
            </p>
            <p className="hero__source">
              <a
                href="https://github.com/bytewizard42i/MidnightHelixCTW"
                target="_blank"
                rel="noreferrer"
              >
                Source code →
              </a>
            </p>
            <img
              className="hero__art hero__art--wide"
              src="/Privacy-Preserving_Protocol_Architecture_Overview.png"
              alt="Privacy-Preserving Protocol Architecture overview"
              width="2752"
              height="1536"
            />
            <div className="hero__labels" aria-label="Scenario boundaries">
              <StatusBadge label="TESTWIRED" />
              <span className="boundary-chip">SYNTHETIC DATA ONLY</span>
              <span className="boundary-chip">NO LEGAL EFFECT</span>
            </div>
          </div>

          <article
            className="case-card"
            aria-labelledby="case-title"
            data-narration-key="case"
            tabIndex={0}
          >
            <div className="case-card__signal" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="case-card__kicker">Fixed judge case · 01</p>
            <h2 id="case-title">Morrow family farmhouse</h2>
            <p>44 Quarry Road · fictional TestTown property</p>
            <dl>
              <div data-narration-key="case" tabIndex={0}>
                <dt>Parcel</dt>
                <dd>TT-PARCEL-0917-114</dd>
              </div>
              <div data-narration-key="case" tabIndex={0}>
                <dt>Permitted predicate</dt>
                <dd>property.is_unencumbered</dd>
              </div>
              <div data-narration-key="case" tabIndex={0}>
                <dt>Source documents in model context</dt>
                <dd>None</dd>
              </div>
            </dl>
          </article>
        </section>

        <NarrationControls
          guideStarted={guideStarted}
          onStart={startGuidedDemo}
          narrator={narrator}
        />

        <section
          className={`connection-banner connection-banner--${connection.kind}`}
          aria-live="polite"
          data-narration-key="connection"
          tabIndex={0}
        >
          <div>
            <StatusBadge label={currentConnectionLabel} compact />
            <p>{connection.message}</p>
          </div>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void checkConnection()}
            disabled={
              connection.kind === "checking" ||
              operationPending ||
              fetchingReceipt
            }
          >
            {connection.kind === "checking" ? "Checking real API…" : "Check connection"}
          </button>
        </section>

        <section
          className="flow-shell"
          id="judge-flow"
          aria-labelledby="flow-title"
        >
          <div
            className="flow-intro"
            data-narration-key="checkpoint"
            tabIndex={0}
          >
            <p className="eyebrow">One proof, seven checkpoints</p>
            <h2 id="flow-title" className="flow-title--full">HelixCTW</h2>
            <h3 className="flow-subtitle">The core protocol for storage and distribution for:</h3>
            <ul className="flow-registry-list">
              <li>DIDz (Privacy-Preserving Digital Identities)</li>
              <li>Agentic DIDz</li>
              <li>RWAz (Privacy-Preserving Real World Asset Tokenized Registries)</li>
            </ul>
            <h3 className="flow-subtitle">Welcome to the Morrow Family Farmhouse example.</h3>
            <p>
              We have some example RWAz data for the Morrow Family Farmhouse, and we will go through a guided tour asking some questions that we have limited authority to ask as we explore possibly buying the property.
            </p>
          </div>

          <div className="flow-layout">
            <ol className="step-rail" aria-label="Judge proof progress">
              {FLOW_STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className={
                    index < currentStep
                      ? "step-rail__item step-rail__item--complete"
                      : index === currentStep
                        ? "step-rail__item step-rail__item--current"
                        : "step-rail__item"
                  }
                  aria-current={index === currentStep ? "step" : undefined}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{step.title}</p>
                </li>
              ))}
            </ol>

            <article
              className="active-step"
              data-narration-key="checkpoint"
              tabIndex={0}
            >
              <p className="active-step__number">
                Checkpoint {Math.min(currentStep + 1, 7)} of 7
              </p>
              <h3>{activeFlowStep.title}</h3>
              <p>{activeFlowStep.explanation}</p>
              {activeFlowStep.prompt ? (
                <blockquote>{activeFlowStep.prompt}</blockquote>
              ) : null}

              {operationError ? (
                <div className="fail-closed" role="alert">
                  <strong>Failed closed</strong>
                  <p>{operationError}</p>
                </div>
              ) : null}

              <div className="active-step__actions">
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => void runStep()}
                  disabled={
                    connection.kind !== "ready" ||
                    operationPending ||
                    fetchingReceipt ||
                    currentStep >= 7
                  }
                >
                  {operationPending
                    ? "Waiting for real API…"
                    : fetchingReceipt
                      ? "Retrieving receipt…"
                      : activeFlowStep.label}
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  data-narration-key="evidence"
                >
                  Open evidence drawer
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={operationPending || fetchingReceipt}
                  onClick={resetBrowserView}
                >
                  Reset this browser view
                </button>
              </div>
              {connection.kind !== "ready" ? (
                <p className="disabled-explanation">
                  Judge actions unlock only when the API explicitly reports live
                  operational readiness.
                </p>
              ) : null}
              {resetNotice ? (
                <p className="reset-notice" role="status">
                  {resetNotice}
                </p>
              ) : null}
            </article>
          </div>
        </section>

        <div data-narration-key="providers" tabIndex={0}>
          <ProviderMatrix providers={providersFromStatus(statusResponse)} />
        </div>
      </main>

      <footer className="site-footer">
        <p>HelixCTW · entirely fictional TestWired data</p>
        <p>
          CockroachDB is memory. Midnight is proof. Authorization still decides. ·{' '}
          <a href="https://github.com/bytewizard42i" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </p>
      </footer>

      <EvidenceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        evidence={lastEvidence}
        onFetchReceipt={
          runContext?.receiptId &&
          connection.kind === "ready" &&
          statusResponse !== null &&
          statusPermitsMemoryJourney(statusResponse) &&
          statusResponse.releaseCommit === runContext.releaseCommit &&
          !operationPending
            ? fetchReceipt
            : null
        }
        fetchingReceipt={fetchingReceipt}
      />
    </div>
  );
}
