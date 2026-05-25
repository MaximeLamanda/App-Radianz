import { describe, expect, it } from "vitest";
import {
  comboMeetsDiscoveryConstructionYearRange,
  DISCOVERY_CONSTRUCTION_YEAR_SLIDER_MIN,
  getDiscoveryConstructionYearSliderMax,
} from "./discovery-construction-year-filter";

describe("comboMeetsDiscoveryConstructionYearRange", () => {
  const maxY = getDiscoveryConstructionYearSliderMax();

  it("passe sans filtre (plage pleine)", () => {
    expect(
      comboMeetsDiscoveryConstructionYearRange(
        [1990],
        DISCOVERY_CONSTRUCTION_YEAR_SLIDER_MIN,
        maxY,
        maxY
      )
    ).toBe(true);
  });

  it("conserve si une année du combo est dans l’intervalle", () => {
    expect(comboMeetsDiscoveryConstructionYearRange([1980, 2015], 2000, 2020, maxY)).toBe(
      true
    );
  });

  it("exclut si aucune année connue dans l’intervalle", () => {
    expect(comboMeetsDiscoveryConstructionYearRange([1980, 1990], 2000, 2020, maxY)).toBe(
      false
    );
  });

  it("exclut si aucune année connue et filtre actif", () => {
    expect(comboMeetsDiscoveryConstructionYearRange([], 2000, 2020, maxY)).toBe(false);
  });
});
