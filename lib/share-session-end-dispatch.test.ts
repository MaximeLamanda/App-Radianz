import { describe, expect, it, vi } from "vitest";

import { dispatchShareSessionEnd } from "./share-session-end-dispatch";

describe("dispatchShareSessionEnd", () => {
  it("utilise sendBeacon si disponible", async () => {
    const sendBeacon = vi.fn(() => true);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    const mode = await dispatchShareSessionEnd(
      {
        shareToken: "tok",
        sessionId: "sid",
        durationMs: 3000,
        maxScrollDepth01: 0.42,
        interactionCount: 7,
        ctaClicks: 3,
      },
      { sendBeacon, fetchImpl }
    );

    expect(mode).toBe("beacon");
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fallback fetch keepalive si sendBeacon indisponible", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));

    const mode = await dispatchShareSessionEnd(
      {
        shareToken: "tok",
        sessionId: "sid",
        durationMs: 3000,
        maxScrollDepth01: 0.42,
        interactionCount: 9,
        ctaClicks: 2,
      },
      { fetchImpl }
    );

    expect(mode).toBe("fetch");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit?]>;
    const init = (calls[0]?.[1] ?? {}) as RequestInit;
    expect(init.keepalive).toBe(true);
    const payload = JSON.parse(String(init.body));
    expect(payload.interactionCount).toBe(9);
    expect(payload.ctaClicks).toBe(2);
  });
});
