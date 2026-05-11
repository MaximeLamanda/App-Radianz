import { describe, expect, it } from "vitest";
import {
  isDiscoveryConstructionYearFilterDisabled,
  rowMatchesDiscoveryConstructionYearRange,
} from "@/lib/discovery-construction-year-filter";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";

function minimalRow(buildingsJson: string): ScoutMatchingV5Row {
  return { buildingsJson } as ScoutMatchingV5Row;
}

describe("isDiscoveryConstructionYearFilterDisabled", () => {
  it("retourne true pour la plage pleine (référence année plafond explicite)", () => {
    expect(isDiscoveryConstructionYearFilterDisabled(1850, 2030, 2030)).toBe(true);
  });

  it("retourne false si le max est rétréci sous le plafond", () => {
    expect(isDiscoveryConstructionYearFilterDisabled(1850, 2000, 2030)).toBe(false);
  });

  it("retourne false si le min est au-dessus du plancher", () => {
    expect(isDiscoveryConstructionYearFilterDisabled(1990, 2030, 2030)).toBe(false);
  });
});

describe("rowMatchesDiscoveryConstructionYearRange", () => {
  const SLIDER_MAX = 2030;

  it("accepte toute ligne quand le filtre est désactivé", () => {
    const row = minimalRow("[]");
    expect(rowMatchesDiscoveryConstructionYearRange(row, 1850, SLIDER_MAX, SLIDER_MAX)).toBe(true);
  });

  it("accepte si un seul bâtiment a une année dans l’intervalle", () => {
    const json = JSON.stringify([
      { batiment_construction_id: "a", annee_construction: 1970 },
      { batiment_construction_id: "b", annee_construction: 2010 },
    ]);
    const row = minimalRow(json);
    expect(rowMatchesDiscoveryConstructionYearRange(row, 2000, 2020, SLIDER_MAX)).toBe(true);
  });

  it("refuse si aucune année ne tombe dans l’intervalle", () => {
    const json = JSON.stringify([{ batiment_construction_id: "a", annee_construction: 1980 }]);
    const row = minimalRow(json);
    expect(rowMatchesDiscoveryConstructionYearRange(row, 1990, 2000, SLIDER_MAX)).toBe(false);
  });

  it("ignore les bâtiments sans année connue", () => {
    const json = JSON.stringify([
      { batiment_construction_id: "a", annee_construction: null },
      { batiment_construction_id: "b" },
    ]);
    const row = minimalRow(json);
    expect(rowMatchesDiscoveryConstructionYearRange(row, 2000, 2020, SLIDER_MAX)).toBe(false);
  });
});
