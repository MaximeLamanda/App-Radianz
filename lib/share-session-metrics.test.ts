import { describe, expect, it } from "vitest";

import {
  clampShareSessionCounter,
  clampShareSessionDurationMs,
  computeElementScrollDepth01,
  clampShareSessionMaxScrollDepth01,
  computeShareSessionScrollDepth01,
  SHARE_SESSION_MAX_COUNTER,
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

describe("computeShareSessionScrollDepth01", () => {
  it("utilise un fallback si scrollY est indisponible", () => {
    expect(
      computeShareSessionScrollDepth01({
        scrollY: undefined,
        docScrollTop: 200,
        innerHeight: 600,
        docScrollHeight: 2600,
      })
    ).toBeCloseTo(0.1);
  });

  it("borne le ratio entre 0 et 1", () => {
    expect(
      computeShareSessionScrollDepth01({
        scrollY: -200,
        innerHeight: 600,
        docScrollHeight: 2600,
      })
    ).toBe(0);
    expect(
      computeShareSessionScrollDepth01({
        scrollY: 5000,
        innerHeight: 600,
        docScrollHeight: 2600,
      })
    ).toBe(1);
  });

  it("retourne 0 si la page ne scrolle pas", () => {
    expect(
      computeShareSessionScrollDepth01({
        scrollY: 50,
        innerHeight: 800,
        docScrollHeight: 800,
      })
    ).toBe(0);
  });
});

describe("computeElementScrollDepth01", () => {
  it("calcule la profondeur d'un conteneur scrollable", () => {
    expect(
      computeElementScrollDepth01({
        scrollTop: 120,
        clientHeight: 200,
        scrollHeight: 1000,
      })
    ).toBeCloseTo(0.15);
  });

  it("retourne 0 si le conteneur ne scrolle pas", () => {
    expect(
      computeElementScrollDepth01({
        scrollTop: 20,
        clientHeight: 400,
        scrollHeight: 400,
      })
    ).toBe(0);
  });
});

describe("clampShareSessionCounter", () => {
  it("normalise les compteurs entiers", () => {
    expect(clampShareSessionCounter(12.9)).toBe(12);
    expect(clampShareSessionCounter(-1)).toBe(0);
    expect(clampShareSessionCounter(NaN)).toBe(0);
    expect(clampShareSessionCounter(SHARE_SESSION_MAX_COUNTER + 10)).toBe(
      SHARE_SESSION_MAX_COUNTER
    );
  });
});
