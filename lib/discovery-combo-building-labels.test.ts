import { describe, expect, it } from "vitest";
import {
  buildDiscoveryComboBuildingNumberLabels,
  collectSortedDiscoveryComboBuildingEntries,
  compareV5BuildingsJsonEntriesForDisplay,
} from "@/lib/discovery-combo-building-labels";
import type { ScoutMatchingV5Row, V5BuildingsJsonEntry } from "@/lib/scout-matching-v5-map";

function parcelleRow(
  id: string,
  buildingsJson: string,
  overrides: Partial<ScoutMatchingV5Row> = {}
): ScoutMatchingV5Row {
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
    ...overrides,
  } as ScoutMatchingV5Row;
}

function buildingsJson(entries: Array<{ bc: string; fp: number | null }>): string {
  return JSON.stringify(
    entries.map((e) => ({
      batiment_construction_id: e.bc,
      footprint_m2: e.fp,
      matching_status: "ok",
      matching_decision: "",
      matching_siren_selected: "",
    }))
  );
}

function polyFeature(bc: string, fp: number, ring: number[][]): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: { batiment_construction_id: bc, footprint_m2: fp },
  };
}

describe("compareV5BuildingsJsonEntriesForDisplay", () => {
  it("trie par empreinte décroissante puis BC id", () => {
    const a: V5BuildingsJsonEntry = {
      batimentConstructionId: "bc-a",
      batimentGroupeId: null,
      anneeConstruction: null,
      footprintM2: 100,
      intersectionAreaM2: null,
      matchingStatus: "ok",
      matchingDecision: "",
      matchingSirenSelected: "",
    };
    const b: V5BuildingsJsonEntry = {
      ...a,
      batimentConstructionId: "bc-b",
      footprintM2: 200,
    };
    expect(compareV5BuildingsJsonEntriesForDisplay(a, b)).toBeGreaterThan(0);
    expect(compareV5BuildingsJsonEntriesForDisplay(b, a)).toBeLessThan(0);
  });
});

describe("collectSortedDiscoveryComboBuildingEntries", () => {
  it("déduplique et trie le cluster parcelle", () => {
    const anchor = parcelleRow("p1", buildingsJson([{ bc: "bc1", fp: 100 }]));
    const cluster = [
      anchor,
      parcelleRow("p2", buildingsJson([{ bc: "bc2", fp: 300 }, { bc: "bc1", fp: 100 }])),
    ];
    const rows = collectSortedDiscoveryComboBuildingEntries(cluster, anchor);
    expect(rows.map((r) => r.batimentConstructionId)).toEqual(["bc2", "bc1"]);
  });
});

describe("buildDiscoveryComboBuildingNumberLabels", () => {
  it("assigne 1…N au centroïde selon l’ordre tiroir", () => {
    const anchor = parcelleRow("p1", buildingsJson([
      { bc: "bc-small", fp: 80 },
      { bc: "bc-large", fp: 400 },
    ]));
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        polyFeature("bc-small", 80, [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]),
        polyFeature("bc-large", 400, [[1, 1], [1.001, 1], [1.001, 1.001], [1, 1.001], [1, 1]]),
      ],
    };

    const labels = buildDiscoveryComboBuildingNumberLabels([anchor], anchor, fc);
    expect(labels).toHaveLength(2);
    expect(labels.find((l) => l.batimentConstructionId === "bc-large")?.number).toBe(1);
    expect(labels.find((l) => l.batimentConstructionId === "bc-small")?.number).toBe(2);
    for (const l of labels) {
      expect(Number.isFinite(l.lat)).toBe(true);
      expect(Number.isFinite(l.lng)).toBe(true);
      expect(l.selectionId).toBeTruthy();
    }
  });

  it("retourne [] sans ancre ou sans polygones", () => {
    const anchor = parcelleRow("p1", buildingsJson([{ bc: "bc1", fp: 100 }]));
    expect(buildDiscoveryComboBuildingNumberLabels([], null, { type: "FeatureCollection", features: [] })).toEqual([]);
    expect(
      buildDiscoveryComboBuildingNumberLabels([anchor], anchor, { type: "FeatureCollection", features: [] })
    ).toEqual([]);
  });
});
