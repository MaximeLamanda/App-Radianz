import { describe, expect, it } from "vitest";
import { resolveDiscoveryComboEnergyFootprintM2 } from "./discovery-combo-energy-footprint";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";

function buildingsJson(entries: { bc: string; fp: number; osm?: string }[]): string {
  return JSON.stringify(
    entries.map((e) => ({
      batiment_construction_id: e.bc,
      osm_building_id: e.osm,
      footprint_m2: e.fp,
      matching_status: "ok",
      matching_decision: "",
      matching_siren_selected: "",
    }))
  );
}

function parcelleRow(id: string, footprint: number, buildingsJsonStr?: string): ScoutMatchingV5Row {
  return {
    id,
    grain: "parcelle",
    label: id,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    },
    footprintSumM2: footprint,
    buildingsJson: buildingsJsonStr ?? "",
    matchingConfidence: 80,
    statusMetier: "ok",
    codeInsee: "33318",
    properties: {},
  } as ScoutMatchingV5Row;
}

describe("resolveDiscoveryComboEnergyFootprintM2", () => {
  it("somme les bâtiments cochés quand le filtre est actif (aligné table)", () => {
    const p1 = parcelleRow(
      "p1",
      300,
      buildingsJson([
        { bc: "bc-a", fp: 100, osm: "w:1" },
        { bc: "bc-b", fp: 200, osm: "w:2" },
      ])
    );
    expect(
      resolveDiscoveryComboEnergyFootprintM2({
        anchorRow: p1,
        parcelleRows: [p1],
        selectedBuildingIds: new Set(["osm:w:1"]),
      })
    ).toBe(100);
  });

  it("utilise le hint SQL si le cluster parcelle est incomplet", () => {
    const anchor = parcelleRow("p1", 100);
    expect(
      resolveDiscoveryComboEnergyFootprintM2({
        anchorRow: anchor,
        parcelleRows: [anchor],
        sqlHint: {
          footprintSumM2: 2539,
          parcelContourSumM2: 10495,
          expectedParcelleCount: 3,
        },
      })
    ).toBe(2539);
  });

  it("déduplique les BC sur le combo complet sans filtre", () => {
    const p1 = parcelleRow("p1", 551, buildingsJson([{ bc: "bc-shared", fp: 551 }]));
    const p2 = parcelleRow(
      "p2",
      684,
      buildingsJson([
        { bc: "bc-shared", fp: 551 },
        { bc: "bc-other", fp: 133 },
      ])
    );
    expect(
      resolveDiscoveryComboEnergyFootprintM2({
        anchorRow: p1,
        parcelleRows: [p1, p2],
      })
    ).toBe(684);
  });

  it("ne force pas l’overview SQL quand le filtre bâtiment est actif", () => {
    const p1 = parcelleRow(
      "p1",
      300,
      buildingsJson([
        { bc: "bc-a", fp: 100, osm: "w:1" },
        { bc: "bc-b", fp: 200, osm: "w:2" },
      ])
    );
    expect(
      resolveDiscoveryComboEnergyFootprintM2({
        anchorRow: p1,
        parcelleRows: [p1],
        selectedBuildingIds: new Set(["osm:w:1"]),
        comboFootprintFromOverview: 9999,
      })
    ).toBe(100);
  });
});
