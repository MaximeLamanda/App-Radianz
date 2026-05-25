import { describe, expect, it } from "vitest";
import { MATCHING_V5_MVT_MAX_Z, MATCHING_V5_MVT_MIN_Z } from "@/lib/discovery-mvt-tile";
import { toleranceDegForMatchingV5MvtZoom } from "@/lib/matching-v5-mvt-simplify";

describe("toleranceDegForMatchingV5MvtZoom", () => {
  it("est 0 aux zooms élevés", () => {
    expect(toleranceDegForMatchingV5MvtZoom(19)).toBe(0);
    expect(toleranceDegForMatchingV5MvtZoom(17)).toBe(0);
  });

  it("augmente quand z diminue", () => {
    const t8 = toleranceDegForMatchingV5MvtZoom(8);
    const t14 = toleranceDegForMatchingV5MvtZoom(14);
    expect(t8).toBeGreaterThan(t14);
  });

  it("borne z hors intervalle API", () => {
    expect(toleranceDegForMatchingV5MvtZoom(3)).toBe(toleranceDegForMatchingV5MvtZoom(MATCHING_V5_MVT_MIN_Z));
    expect(toleranceDegForMatchingV5MvtZoom(25)).toBe(toleranceDegForMatchingV5MvtZoom(MATCHING_V5_MVT_MAX_Z));
  });
});
