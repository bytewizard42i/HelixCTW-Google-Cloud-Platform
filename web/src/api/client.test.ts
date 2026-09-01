import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJudgeApiClient,
  JudgeApiConfigurationError,
  normalizePublicApiBaseUrl,
} from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizePublicApiBaseUrl", () => {
  it("returns null when the API is intentionally not configured", () => {
    expect(normalizePublicApiBaseUrl(undefined)).toBeNull();
    expect(normalizePublicApiBaseUrl("  ")).toBeNull();
  });

  it("normalizes a public HTTPS API URL", () => {
    expect(
      normalizePublicApiBaseUrl("https://abc123.execute-api.us-east-1.amazonaws.com/"),
    ).toBe("https://abc123.execute-api.us-east-1.amazonaws.com");
  });

  it("allows HTTP only for local development", () => {
    expect(normalizePublicApiBaseUrl("http://localhost:3000/"))
      .toBe("http://localhost:3000");
    expect(() => normalizePublicApiBaseUrl("http://example.com")).toThrow(
      JudgeApiConfigurationError,
    );
  });

  it("rejects credentials and query parameters in the public configuration", () => {
    expect(() => normalizePublicApiBaseUrl("https://user:pass@example.com"))
      .toThrow(JudgeApiConfigurationError);
    expect(() => normalizePublicApiBaseUrl("https://example.com?token=secret"))
      .toThrow(JudgeApiConfigurationError);
  });
});

describe("createJudgeApiClient", () => {
  it("preserves a caller-owned idempotency key across a logical retry", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({ ok: true, runId: "run-1", sessionId: "session-1" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createJudgeApiClient("https://example.test");
    const idempotencyKey = "mhelix-web:logical-checkpoint-0001";

    await client.startRun({ scenarioId: "scenario-1", idempotencyKey });
    await client.startRun({ scenarioId: "scenario-1", idempotencyKey });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, requestOptions] of fetchMock.mock.calls) {
      expect((requestOptions?.headers as Headers).get("Idempotency-Key")).toBe(
        idempotencyKey,
      );
    }
  });

  it.each([
    {
      name: "matching header and body",
      headerRequestId: "request-header-001",
      bodyRequestId: "request-header-001",
      expectedHeaderRequestId: "request-header-001",
      expectedDisplayRequestId: "request-header-001",
    },
    {
      name: "missing header with body fallback",
      headerRequestId: undefined,
      bodyRequestId: "request-body-001",
      expectedHeaderRequestId: undefined,
      expectedDisplayRequestId: "request-body-001",
    },
    {
      name: "mismatched header and body",
      headerRequestId: "request-header-002",
      bodyRequestId: "request-body-002",
      expectedHeaderRequestId: "request-header-002",
      expectedDisplayRequestId: "request-header-002",
    },
  ])(
    "keeps raw header provenance for $name",
    async ({
      headerRequestId,
      bodyRequestId,
      expectedHeaderRequestId,
      expectedDisplayRequestId,
    }) => {
      const headers = new Headers({ "content-type": "application/json" });
      if (headerRequestId) headers.set("x-request-id", headerRequestId);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ ok: true, requestId: bodyRequestId }), {
            status: 200,
            headers,
          }),
        ),
      );

      const response = await createJudgeApiClient("https://example.test").health();

      expect(response.headerRequestId).toBe(expectedHeaderRequestId);
      expect(response.requestId).toBe(expectedDisplayRequestId);
    },
  );

  it("distinguishes malformed JSON from a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{broken", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const client = createJudgeApiClient("https://example.test");

    await expect(client.health()).rejects.toMatchObject({
      message: "The TestWired API returned malformed JSON. No result was accepted.",
      httpStatus: 200,
    });
  });

  it("reports caller cancellation without presenting it as a network outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, requestOptions: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestOptions.signal?.addEventListener("abort", () => {
            reject(new DOMException("cancelled", "AbortError"));
          });
        }),
      ),
    );
    const client = createJudgeApiClient("https://example.test");
    const abortController = new AbortController();
    const requestPromise = client.status({ signal: abortController.signal });
    abortController.abort();

    await expect(requestPromise).rejects.toMatchObject({
      message:
        "The TestWired API request was cancelled before a result was accepted.",
    });
  });
});
