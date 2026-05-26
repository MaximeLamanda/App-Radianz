import { describe, expect, it } from "vitest";
import {
  discoveryComboBuildingFootprintM2,
  discoveryComboHeroSurfaces,
} from "./discovery-combo-hero-surfaces";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";

function buildingsJsonForTest(entries: { bc: string; fp: number; osm?: string }[]): string {
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

function parcelleRow(
  id: string,
  footprint: number,
  buildingsJson?: string
): ScoutMatchingV5Row {
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
    buildingsJson: buildingsJson ?? "",
    matchingConfidence: 80,
    statusMetier: "ok",
    codeInsee: "33318",
    properties: {},
  } as ScoutMatchingV5Row;
}

describe("discoveryComboHeroSurfaces", () => {
  it("utilise les valeurs SQL tant que toutes les parcelles ne sont pas chargées", () => {
    const anchor = parcelleRow("p1", 100);
    const surfaces = discoveryComboHeroSurfaces({
      anchorRow: anchor,
      parcelleRows: [anchor],
      sqlHint: {
        footprintSumM2: 2539,
        parcelContourSumM2: 10495,
        expectedParcelleCount: 3,
      },
    });
    expect(surfaces.footprintM2).toBe(2539);
    expect(surfaces.parcelM2).toBe(10495);
  });

  it("somme tous les bâtiments du combo sans filtre bâtiment actif", () => {
    const p1 = parcelleRow(
      "p1",
      551,
      buildingsJsonForTest([{ bc: "bc-shared", fp: 551 }])
    );
    const p2 = parcelleRow(
      "p2",
      684,
      buildingsJsonForTest([
        { bc: "bc-shared", fp: 551 },
        { bc: "bc-other", fp: 133 },
      ])
    );
    const surfaces = discoveryComboHeroSurfaces({
      anchorRow: p1,
      parcelleRows: [p1, p2],
    });
    expect(surfaces.footprintM2).toBe(684);
  });

  it("filtre sur les bâtiments cochés quand le filtre est actif", () => {
    const p1 = parcelleRow(
      "p1",
      300,
      buildingsJsonForTest([
        { bc: "bc-a", fp: 100, osm: "w:1" },
        { bc: "bc-b", fp: 200, osm: "w:2" },
      ])
    );
    const allSelected = new Set(["bc:bc-a", "bc:bc-b"]);
    expect(
      discoveryComboHeroSurfaces({
        anchorRow: p1,
        parcelleRows: [p1],
        selectedBuildingIds: allSelected,
      }).footprintM2
    ).toBe(300);

    expect(
      discoveryComboHeroSurfaces({
        anchorRow: p1,
        parcelleRows: [p1],
        selectedBuildingIds: new Set(["osm:w:1"]),
      }).footprintM2
    ).toBe(100);

    expect(
      discoveryComboHeroSurfaces({
        anchorRow: p1,
        parcelleRows: [p1],
        selectedBuildingIds: new Set(),
      }).footprintM2
    ).toBe(0);
  });
});

describe("discoveryComboBuildingFootprintM2", () => {
  it("replie sur le hint SQL si les lignes ne donnent pas d’empreinte", () => {
    const anchor = parcelleRow("p1", 0);
    expect(
      discoveryComboBuildingFootprintM2({
        anchorRow: anchor,
        parcelleRows: [anchor],
        sqlHint: {
          footprintSumM2: 2539,
          parcelContourSumM2: 10495,
          expectedParcelleCount: 1,
        },
      })
    ).toBe(2539);
  });

  it("somme les bâtiments du combo sans filtre bâtiment", () => {
    const p1 = parcelleRow(
      "p1",
      300,
      buildingsJsonForTest([
        { bc: "bc-a", fp: 100 },
        { bc: "bc-b", fp: 200 },
      ])
    );
    expect(
      discoveryComboBuildingFootprintM2({
        anchorRow: p1,
        parcelleRows: [p1],
      })
    ).toBe(300);
  });
});
