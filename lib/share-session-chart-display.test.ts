import { describe, expect, it } from "vitest";
import {
  shareSessionBarFillFromInteractions,
  shareSessionChartNeedsHorizontalScroll,
  shareSessionChartScrollWidthPx,
  SHARE_SESSION_CHART_BAR_SLOT_PX,
  SHARE_SESSION_CHART_SCROLL_MIN_BARS,
} from "./share-session-chart-display";

describe("shareSessionChartNeedsHorizontalScroll", () => {
  it("active le scroll au-delà du seuil", () => {
    expect(shareSessionChartNeedsHorizontalScroll(SHARE_SESSION_CHART_SCROLL_MIN_BARS)).toBe(false);
    expect(shareSessionChartNeedsHorizontalScroll(SHARE_SESSION_CHART_SCROLL_MIN_BARS + 1)).toBe(true);
  });
});

describe("shareSessionChartScrollWidthPx", () => {
  it("scale avec le nombre de barres", () => {
    expect(shareSessionChartScrollWidthPx(10)).toBe(10 * SHARE_SESSION_CHART_BAR_SLOT_PX);
  });
});

describe("shareSessionBarFillFromInteractions", () => {
  it("pâle sans interaction, plus foncé au max de la série", () => {
    const pale = shareSessionBarFillFromInteractions(0, 10);
    const dark = shareSessionBarFillFromInteractions(10, 10);
    expect(pale).toMatch(/^hsl\(142 /);
    expect(dark).toMatch(/^hsl\(142 /);
    expect(pale).not.toBe(dark);
  });

  it("même valeur pour toutes les barres quand max = 0", () => {
    expect(shareSessionBarFillFromInteractions(3, 0)).toBe(shareSessionBarFillFromInteractions(0, 0));
  });
});
