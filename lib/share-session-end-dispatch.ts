import {
  clampShareSessionCounter,
  clampShareSessionDurationMs,
  clampShareSessionMaxScrollDepth01,
} from "@/lib/share-session-metrics";

type DispatchInput = {
  shareToken: string;
  sessionId: string;
  durationMs: number;
  maxScrollDepth01: number;
  interactionCount?: number;
  ctaClicks?: number;
};

type DispatchDeps = {
  sendBeacon?: (url: string, data?: BodyInit | null) => boolean;
  fetchImpl?: typeof fetch;
};

export async function dispatchShareSessionEnd(
  input: DispatchInput,
  deps: DispatchDeps = {}
): Promise<"beacon" | "fetch" | "skipped"> {
  const shareToken = input.shareToken.trim();
  const sessionId = input.sessionId.trim();
  if (!shareToken || !sessionId) return "skipped";

  const payload = {
    shareToken,
    sessionId,
    durationMs: clampShareSessionDurationMs(input.durationMs),
    maxScrollDepth01: clampShareSessionMaxScrollDepth01(input.maxScrollDepth01),
    interactionCount: clampShareSessionCounter(input.interactionCount),
    ctaClicks: clampShareSessionCounter(input.ctaClicks),
  };
  const body = JSON.stringify(payload);
  const url = "/api/prospect-share/share-session/end";

  const sendBeacon =
    deps.sendBeacon ??
    (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
      ? navigator.sendBeacon.bind(navigator)
      : undefined);
  if (sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    if (sendBeacon(url, blob)) return "beacon";
  }

  const fetchImpl = deps.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return "skipped";
  await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
  return "fetch";
}
