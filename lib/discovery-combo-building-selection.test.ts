import { describe, expect, it } from "vitest";
import { defaultDiscoveryComboBuildingSelectionIds } from "@/lib/discovery-combo-building-labels";
import {
  discoveryBuildingSelectionIdFromEntry,
  isDiscoveryBuildingSelected,
  toggleDiscoveryBuildingSelection,
} from "@/lib/discovery-combo-building-selection";
import type { ScoutMatchingV5Row, V5BuildingsJsonEntry } from "@/lib/scout-matching-v5-map";

function entry(bc: string, osm?: string): V5BuildingsJsonEntry {
  return {
    batimentConstructionId: bc,
    batimentGroupeId: null,
    anneeConstruction: null,
    footprintM2: 100,
    intersectionAreaM2: null,
    matchingStatus: "ok",
    matchingDecision: "",
    matchingSirenSelected: "",
    osmBuildingId: osm,
  };
}

function parcelleRow(id: string, buildingsJson: string): ScoutMatchingV5Row {
  return {
    id,
    grain: "parcelle",
    geometry: { type: "Point", coordinates: [0, 0] },
    buildingsJson,
    buildingGeometriesJson: "",
    footprintSumM2: 0,
    batimentConstructionId: "",
    batimentGroupeId: null,
    osmBuildingId: "",
    statusMetier: "",
    properties: {},
  } as ScoutMatchingV5Row;
}

describe("discoveryBuildingSelectionIdFromEntry", () => {
  it("préfère batiment_construction_id", () => {
    expect(discoveryBuildingSelectionIdFromEntry(entry("bc1", "w:1"))).toBe("bc:bc1");
  });

  it("repli sur osm_building_id", () => {
    expect(discoveryBuildingSelectionIdFromEntry(entry("—", "w:9"))).toBe("osm:w:9");
  });
});

describe("toggleDiscoveryBuildingSelection", () => {
  it("bascule inclusion", () => {
    const initial = new Set(["bc:a"]);
    expect(toggleDiscoveryBuildingSelection(initial, "bc:a")).toEqual(new Set());
    expect(toggleDiscoveryBuildingSelection(initial, "bc:b")).toEqual(new Set(["bc:a", "bc:b"]));
  });
});

describe("defaultDiscoveryComboBuildingSelectionIds", () => {
  it("sélectionne tous les bâtiments du combo", () => {
    const json = JSON.stringify([
      {
        batiment_construction_id: "bc1",
        footprint_m2: 100,
        matching_status: "ok",
        matching_decision: "",
        matching_siren_selected: "",
      },
      {
        batiment_construction_id: "bc2",
        footprint_m2: 200,
        matching_status: "ok",
        matching_decision: "",
        matching_siren_selected: "",
      },
    ]);
    const row = parcelleRow("p1", json);
    const ids = defaultDiscoveryComboBuildingSelectionIds([row], row);
    expect(ids).toEqual(new Set(["bc:bc1", "bc:bc2"]));
  });
});

describe("isDiscoveryBuildingSelected", () => {
  it("retourne true si présent dans le set", () => {
    expect(isDiscoveryBuildingSelected(new Set(["bc:1"]), "bc:1")).toBe(true);
    expect(isDiscoveryBuildingSelected(new Set(["bc:1"]), "bc:2")).toBe(false);
  });
});
