import type {
  CloseSessionResponse as CanonicalCloseSessionResponse,
  CreateRunResponse as CanonicalCreateRunResponse,
  JudgeAction as CanonicalJudgeAction,
  JudgeActionResponse as CanonicalJudgeActionResponse,
  RecallResponse as CanonicalRecallResponse,
  ReceiptResponse as CanonicalReceiptResponse,
} from "./testwired-contracts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

export type EvidenceLabel =
  | "LIVE TESTWIRED"
  | "REALDEAL TEST"
  | "VERIFIED LOCAL"
  | "MOCK"
  | "SOURCE ONLY"
  | "PLANNED"
  | "NOT AVAILABLE";

export interface ApiResponseEnvelope<ResponseBody> {
  readonly data: ResponseBody;
  readonly httpStatus: number;
  /** Raw X-Request-Id response header, never synthesized from the JSON body. */
  readonly headerRequestId?: string;
  /** Display/error request ID, with a JSON-body fallback for failed responses. */
  readonly requestId?: string;
  readonly receivedAt: string;
}

export interface HealthResponse extends JsonObject {
  readonly ok?: boolean;
  readonly service?: string;
  readonly deploymentStatus?: string;
  readonly releaseCommit?: string;
}

export interface ProviderStatus extends JsonObject {
  readonly evidenceLabel?: EvidenceLabel;
  readonly provider?: string;
  readonly receiptId?: string;
}

export interface StatusResponse extends JsonObject {
  readonly ok?: boolean;
  readonly service?: string;
  readonly deploymentStatus?: string;
  readonly releaseCommit?: string;
  readonly providers?: JsonValue[];
  readonly readyForMutations?: boolean;
  /**
   * The narrow five-route memory-slice signal. Distinct from global
   * readiness on purpose: the API keeps readyForMutations false until every
   * deferred provider earns promotion, while this reports only whether the
   * reviewed synthetic memory journey would pass its own gate.
   */
  readonly memorySlice?: {
    readonly [key: string]: JsonValue | undefined;
    readonly available?: boolean;
    readonly scope?: string;
    readonly embeddingEvidence?: string;
  };
}

export interface ScenarioCatalogEntry extends JsonObject {
  readonly scenarioId?: string;
  readonly title?: string;
  readonly synthetic?: boolean;
  readonly evidenceLabel?: EvidenceLabel;
}

export interface ScenariosResponse extends JsonObject {
  readonly scenarios?: ScenarioCatalogEntry[];
}

export type JudgeActionId = CanonicalJudgeAction;
export type CreateRunResponse = CanonicalCreateRunResponse;
export type CloseSessionResponse = CanonicalCloseSessionResponse;
export type RecallResponse = CanonicalRecallResponse;
export type JudgeActionResponse = CanonicalJudgeActionResponse;
export type ReceiptResponse = CanonicalReceiptResponse;
export type JudgeMutationResponse =
  | CreateRunResponse
  | CloseSessionResponse
  | RecallResponse
  | JudgeActionResponse;

export interface JudgeApiClient {
  health(options?: {
    readonly signal?: AbortSignal;
  }): Promise<ApiResponseEnvelope<HealthResponse>>;
  status(options?: {
    readonly signal?: AbortSignal;
  }): Promise<ApiResponseEnvelope<StatusResponse>>;
  scenarios(options?: {
    readonly signal?: AbortSignal;
  }): Promise<ApiResponseEnvelope<ScenariosResponse>>;
  startRun(input: {
    readonly scenarioId: string;
    readonly agentDidz?: string;
    readonly idempotencyKey?: string;
  }): Promise<ApiResponseEnvelope<CreateRunResponse>>;
  closeSession(input: {
    readonly runId: string;
    readonly sessionId: string;
    readonly idempotencyKey?: string;
  }): Promise<ApiResponseEnvelope<CloseSessionResponse>>;
  recall(input: {
    readonly runId: string;
    readonly query: string;
    readonly agentDidz?: string;
    readonly idempotencyKey?: string;
  }): Promise<ApiResponseEnvelope<RecallResponse>>;
  executeAction(input: {
    readonly runId: string;
    readonly action: JudgeActionId;
    readonly agentDidz?: string;
    readonly idempotencyKey?: string;
  }): Promise<ApiResponseEnvelope<JudgeActionResponse>>;
  receipt(
    receiptId: string,
  ): Promise<ApiResponseEnvelope<ReceiptResponse>>;
}
