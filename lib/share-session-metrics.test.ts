import { describe, expect, it } from "vitest";

import {
  clampShareSessionDurationMs,
  clampShareSessionMaxScrollDepth01,
  SHARE_SESSION_MAX_DURATION_MS,
} from "@/lib/share-session-metrics";

describe("clampShareSessionMaxScrollDepth01", () => {
  it("borne 0–1", () => {
    expect(clampShareSessionMaxScrollDepth01(-0.1)).toBe(0);
    expect(clampShareSessionMaxScrollDepth01(0)).toBe(0);
    expect(clampShareSessionMaxScrollDepth01(0.5)).toBe(0.5);
    expect(clampShareSessionMaxScrollDepth01(1)).toBe(1);
    expect(clampShareSessionMaxScrollDepth01(2)).toBe(1);
    expect(clampShareSessionMaxScrollDepth01(NaN)).toBe(0);
  });
});

describe("clampShareSessionDurationMs", () => {
  it("arrondit vers le bas et borne le max", () => {
    expect(clampShareSessionDurationMs(1500.9)).toBe(1500);
    expect(clampShareSessionDurationMs(-1)).toBe(0);
    expect(clampShareSessionDurationMs(SHARE_SESSION_MAX_DURATION_MS + 1)).toBe(
      SHARE_SESSION_MAX_DURATION_MS
    );
  });
});
