/**
 * Fire-and-forget visitor diagnostics.
 *
 * Sends one bounded, sanitized snapshot per event to the API so real-device
 * problems (for example, a checkpoint failing only on a phone browser) can be
 * debugged from the pulled diagnostics folder. Never awaited by UI logic,
 * never throws, and sends no cookies, credentials, or cross-site identifiers.
 */

const bounded = (value: string): string => value.slice(0, 400);

function capabilitySnapshot(): string {
  const flags = [
    `randomUUID:${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"}`,
    `dialog:${typeof HTMLDialogElement === "function"}`,
    `speech:${typeof window !== "undefined" && "speechSynthesis" in window}`,
    `audio:${typeof Audio === "function"}`,
    `touch:${typeof navigator !== "undefined" && navigator.maxTouchPoints > 0}`,
  ];
  return flags.join(" ");
}

export function reportDiagnostic(
  baseUrl: string | null,
  kind: "visit" | "failure",
  detail: { step?: string; message?: string; release?: string } = {},
): void {
  try {
    if (!baseUrl) return;
    const payload: Record<string, string> = {
      kind,
      userAgent: bounded(navigator.userAgent),
      screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio}`,
      capabilities: capabilitySnapshot(),
    };
    if (detail.step) payload.step = bounded(detail.step);
    if (detail.message) payload.message = bounded(detail.message);
    if (detail.release) payload.release = bounded(detail.release);
    void fetch(`${baseUrl}/api/v1/diagnostics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Diagnostics must never disturb the journey.
  }
}
