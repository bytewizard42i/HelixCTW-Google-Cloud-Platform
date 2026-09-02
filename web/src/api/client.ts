import type {
  ApiResponseEnvelope,
  CloseSessionResponse,
  CreateRunResponse,
  HealthResponse,
  JsonObject,
  JudgeActionResponse,
  JudgeApiClient,
  RecallResponse,
  ReceiptResponse,
  ScenariosResponse,
  StatusResponse,
} from "./types";

// 30 s rather than 15 s: close-session legitimately takes ~4.5 s on the
// server, a Cloud Run cold start can add several more, and slow mobile
// networks add their own. The journey still fails closed on timeout — this
// only gives honest-but-slow connections a fair chance to succeed.
const REQUEST_TIMEOUT_MILLISECONDS = 30_000;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

export class JudgeApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JudgeApiConfigurationError";
  }
}

export class JudgeApiRequestError extends Error {
  readonly httpStatus?: number;
  readonly requestId?: string;

  constructor(
    message: string,
    options: { readonly httpStatus?: number; readonly requestId?: string } = {},
  ) {
    super(message);
    this.name = "JudgeApiRequestError";
    this.httpStatus = options.httpStatus;
    this.requestId = options.requestId;
  }
}

/**
 * Vite exposes every VITE_ value to the browser. This validator therefore
 * accepts only a public HTTPS origin, plus localhost HTTP for development.
 */
export function normalizePublicApiBaseUrl(
  configuredValue: string | undefined,
): string | null {
  const trimmedValue = configuredValue?.trim();
  if (!trimmedValue) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedValue);
  } catch {
    throw new JudgeApiConfigurationError(
      "VITE_API_BASE_URL must be a complete public URL.",
    );
  }

  const isLocalDevelopment =
    parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
  if (parsedUrl.protocol !== "https:" && !(isLocalDevelopment && parsedUrl.protocol === "http:")) {
    throw new JudgeApiConfigurationError(
      "VITE_API_BASE_URL must use HTTPS, except for local development.",
    );
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new JudgeApiConfigurationError(
      "VITE_API_BASE_URL cannot contain credentials, query parameters, or a fragment.",
    );
  }

  return parsedUrl.toString().replace(/\/$/, "");
}

export function createPublicIdempotencyKey(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new JudgeApiConfigurationError(
      "This browser cannot create a cryptographically random idempotency key.",
    );
  }
  return `mhelix-web:${crypto.randomUUID()}`;
}

function validatedIdempotencyKey(configuredKey: string | undefined): string {
  const idempotencyKey = configuredKey ?? createPublicIdempotencyKey();
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new JudgeApiConfigurationError(
      "The mutation idempotency key must contain 16 to 128 safe characters.",
    );
  }
  return idempotencyKey;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safePublicErrorMessage(responseBody: unknown): string {
  if (isJsonObject(responseBody) && typeof responseBody.message === "string") {
    return responseBody.message;
  }
  if (
    isJsonObject(responseBody) &&
    isJsonObject(responseBody.error) &&
    typeof responseBody.error.message === "string"
  ) {
    return responseBody.error.message;
  }
  return "The TestWired API failed closed without returning a public error message.";
}

export function createJudgeApiClient(baseUrl: string): JudgeApiClient {
  const normalizedBaseUrl = normalizePublicApiBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw new JudgeApiConfigurationError("VITE_API_BASE_URL is not configured.");
  }

  async function request<ResponseBody>(
    path: string,
    options: {
      readonly method?: "GET" | "POST";
      readonly body?: JsonObject;
      readonly idempotentMutation?: boolean;
      readonly idempotencyKey?: string;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<ApiResponseEnvelope<ResponseBody>> {
    const abortController = new AbortController();
    let timedOut = false;
    const timeoutIdentifier = globalThis.setTimeout(
      () => {
        timedOut = true;
        abortController.abort();
      },
      REQUEST_TIMEOUT_MILLISECONDS,
    );
    const cancelFromCaller = () => abortController.abort();
    if (options.signal?.aborted) {
      cancelFromCaller();
    } else {
      options.signal?.addEventListener("abort", cancelFromCaller, { once: true });
    }
    const method = options.method ?? "GET";
    const headers = new Headers({ Accept: "application/json" });

    if (method === "POST") {
      headers.set("Content-Type", "application/json");
      if (options.idempotentMutation) {
        headers.set(
          "Idempotency-Key",
          validatedIdempotencyKey(options.idempotencyKey),
        );
      }
    }

    try {
      const response = await fetch(`${normalizedBaseUrl}${path}`, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: abortController.signal,
      });
      const headerRequestId = response.headers.get("x-request-id") ?? undefined;
      let requestId = headerRequestId;
      const contentType = response.headers.get("content-type") ?? "";
      let responseBody: unknown = null;
      if (contentType.includes("application/json")) {
        try {
          responseBody = await response.json();
        } catch {
          throw new JudgeApiRequestError(
            "The TestWired API returned malformed JSON. No result was accepted.",
            { httpStatus: response.status, requestId },
          );
        }
      }
      if (!requestId && isJsonObject(responseBody) && typeof responseBody.requestId === "string") {
        requestId = responseBody.requestId;
      }

      if (!response.ok) {
        throw new JudgeApiRequestError(safePublicErrorMessage(responseBody), {
          httpStatus: response.status,
          requestId,
        });
      }
      if (!isJsonObject(responseBody)) {
        throw new JudgeApiRequestError(
          "The TestWired API returned an invalid response body.",
          { httpStatus: response.status, requestId },
        );
      }

      return {
        data: responseBody as ResponseBody,
        httpStatus: response.status,
        headerRequestId,
        requestId,
        receivedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof JudgeApiRequestError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new JudgeApiRequestError(
          timedOut
            ? "The TestWired API did not respond within 15 seconds."
            : "The TestWired API request was cancelled before a result was accepted.",
        );
      }
      throw new JudgeApiRequestError(
        "The TestWired API could not be reached. No operation was recorded.",
      );
    } finally {
      globalThis.clearTimeout(timeoutIdentifier);
      options.signal?.removeEventListener("abort", cancelFromCaller);
    }
  }

  return {
    // GCP deviation: Cloud Run reserves some z-suffixed paths, so the
    // liveness route is /health in this edition's API.
    health: (options) => request<HealthResponse>("/health", options),
    status: (options) => request<StatusResponse>("/api/v1/status", options),
    scenarios: (options) =>
      request<ScenariosResponse>("/api/v1/judge/scenarios", options),
    startRun: ({ scenarioId, agentDidz, idempotencyKey }) =>
      request<CreateRunResponse>("/api/v1/judge/runs", {
        method: "POST",
        idempotentMutation: true,
        idempotencyKey,
        body: agentDidz ? { scenarioId, agentDidz } : { scenarioId },
      }),
    closeSession: ({ runId, sessionId, idempotencyKey }) =>
      request<CloseSessionResponse>(
        `/api/v1/judge/runs/${encodeURIComponent(runId)}/sessions/close`,
        {
          method: "POST",
          idempotentMutation: true,
          idempotencyKey,
          body: { sessionId },
        },
      ),
    recall: ({ runId, query, agentDidz, idempotencyKey }) =>
      request<RecallResponse>(
        `/api/v1/judge/runs/${encodeURIComponent(runId)}/recall`,
        {
          method: "POST",
          idempotentMutation: true,
          idempotencyKey,
          body: agentDidz ? { query, agentDidz } : { query },
        },
      ),
    executeAction: ({ runId, action, agentDidz, idempotencyKey }) =>
      request<JudgeActionResponse>(
        `/api/v1/judge/runs/${encodeURIComponent(runId)}/actions`,
        {
          method: "POST",
          idempotentMutation: true,
          idempotencyKey,
          body: agentDidz ? { action, agentDidz } : { action },
        },
      ),
    receipt: (receiptId) =>
      request<ReceiptResponse>(
        `/api/v1/judge/receipts/${encodeURIComponent(receiptId)}`,
      ),
  };
}
