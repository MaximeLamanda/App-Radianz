import { describe, expect, it } from "vitest";
import type { ScoutMatchingV5Row } from "./scout-matching-v5-map";
import { findMatchingV5LinkedParcelleRowsTransitive, findMatchingV5ParcelleRowsForBuilding } from "./scout-matching-v5-map";
import {
  buildingSelectionIdsForDiscoveryProspect,
  findDiscoveryProspectByComboId,
  legacyComboIdFromProspect,
  linkedParcelleRowsForV5DrawerAnchor,
  matchingV5SelectionMatchesProspect,
  parcelleRowsForDiscoveryProspect,
} from "./discovery-pipeline-match";
import type { Prospect } from "@/types";

function parcelle(
  partial: Pick<ScoutMatchingV5Row, "id" | "section" | "numeroNorm" | "codeInsee"> & {
    buildingsJson?: string;
  }
): ScoutMatchingV5Row {
  return {
    grain: "parcelle",
    geometry: { type: "Polygon", coordinates: [] },
    label: "",
    batimentConstructionId: null,
    batimentGroupeId: null,
    nbBatiments: 0,
    footprintSumM2: 0,
    sirenStatus: "",
    statusTechnique: "",
    statusMetier: "single",
    siretCount: 0,
    siretsJson: "",
    sirensJson: "",
    matchingConfidence: 0,
    matchingReason: "",
    passerelleAddress: "",
    passerelleAddressesJson: "",
    parcellesJson: "",
    buildingGeometriesJson: "",
    properties: {},
    ...partial,
  } as ScoutMatchingV5Row;
}

function buildingRow(id: string, parcellesJson: string): ScoutMatchingV5Row {
  return {
    grain: "building",
    id,
    geometry: { type: "Polygon", coordinates: [] },
    label: "",
    batimentConstructionId: "bc-1",
    batimentGroupeId: "bg-1",
    codeInsee: "33318",
    section: "",
    numeroNorm: "",
    nbBatiments: 1,
    footprintSumM2: 1200,
    sirenStatus: "",
    statusTechnique: "",
    statusMetier: "single",
    siretCount: 0,
    siretsJson: "",
    sirensJson: "",
    matchingConfidence: 0,
    matchingReason: "",
    passerelleAddress: "",
    passerelleAddressesJson: "",
    buildingsJson: "",
    buildingGeometriesJson: "",
    parcellesJson,
    properties: {},
  } as ScoutMatchingV5Row;
}

describe("linkedParcelleRowsForV5DrawerAnchor", () => {
  it("délègue au même résultat que la page pour un bâtiment", () => {
    const pj = JSON.stringify([{ code_insee: "33318", section: "HC", numero_norm: "0045" }]);
    const b = buildingRow("building:x", pj);
    const p = parcelle({ id: "p1", codeInsee: "33318", section: "HC", numeroNorm: "0045" });
    const rows = [b, p];
    expect(linkedParcelleRowsForV5DrawerAnchor(b, rows)).toEqual(findMatchingV5ParcelleRowsForBuilding(b, rows));
  });

  it("délègue au transitif pour une parcelle", () => {
    const a = parcelle({
      id: "a",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: JSON.stringify([{ batiment_construction_id: "bc-x", matching_status: "partage" }]),
    });
    const b = parcelle({
      id: "b",
      section: "B",
      numeroNorm: "0002",
      codeInsee: "33318",
      buildingsJson: JSON.stringify([{ batiment_construction_id: "bc-x", matching_status: "partage" }]),
    });
    const rows = [a, b];
    expect(linkedParcelleRowsForV5DrawerAnchor(a, rows)).toEqual(findMatchingV5LinkedParcelleRowsTransitive(a, rows));
  });
});

describe("parcelleRowsForDiscoveryProspect", () => {
  const pj = JSON.stringify([{ code_insee: "33318", section: "HC", numero_norm: "0045" }]);
  const p1 = parcelle({ id: "p1", codeInsee: "33318", section: "HC", numeroNorm: "0045" });
  const p2 = parcelle({ id: "p2", codeInsee: "33318", section: "HC", numeroNorm: "0046" });
  const allRows = [p1, p2];

  it("utilise matchingV5ParcelleIds quand présents", () => {
    const rows = parcelleRowsForDiscoveryProspect(
      { matchingV5ParcelleIds: ["p2"] },
      p1,
      allRows
    );
    expect(rows.map((r) => r.id)).toEqual(["p2"]);
  });
});

describe("buildingSelectionIdsForDiscoveryProspect", () => {
  it("retourne les ids persistés", () => {
    expect(
      buildingSelectionIdsForDiscoveryProspect({
        matchingV5BuildingSelectionIds: ["bc:1"],
      })
    ).toEqual(["bc:1"]);
  });

  it("retourne undefined si vide", () => {
    expect(buildingSelectionIdsForDiscoveryProspect({})).toBeUndefined();
  });
});

describe("findDiscoveryProspectByComboId", () => {
  const comboA = "combo:p1|p2";
  const comboB = "combo:p2|p3";

  it("retourne le prospect si matchingV5ComboId correspond", () => {
    const prospects: Prospect[] = [
      {
        id: "doc-a",
        address: "a",
        coordinates: { lat: 0, lng: 0 },
        roofSurface: { area: 1, polygon: [] },
        placeType: "other",
        qualityScore: 1,
        pipelineEntrySource: "discovery_v5",
        matchingV5ComboId: comboA,
        matchingV5ParcelleIds: ["p1", "p2"],
      },
    ];
    expect(findDiscoveryProspectByComboId(comboA, prospects)?.id).toBe("doc-a");
  });

  it("retourne null si comboId différent même parcelle partagée", () => {
    const prospects: Prospect[] = [
      {
        id: "doc-a",
        address: "a",
        coordinates: { lat: 0, lng: 0 },
        roofSurface: { area: 1, polygon: [] },
        placeType: "other",
        qualityScore: 1,
        pipelineEntrySource: "discovery_v5",
        matchingV5ComboId: comboA,
        matchingV5ParcelleIds: ["p1", "p2"],
      },
    ];
    expect(findDiscoveryProspectByComboId(comboB, prospects)).toBeNull();
  });

  it("fallback legacy: dérive comboId depuis matchingV5ParcelleIds si champ absent", () => {
    const prospects: Prospect[] = [
      {
        id: "legacy",
        address: "a",
        coordinates: { lat: 0, lng: 0 },
        roofSurface: { area: 1, polygon: [] },
        placeType: "other",
        qualityScore: 1,
        pipelineEntrySource: "discovery_v5",
        matchingV5ParcelleIds: ["p2", "p1"],
      },
    ];
    expect(legacyComboIdFromProspect(prospects[0]!)).toBe(comboA);
    expect(findDiscoveryProspectByComboId(comboA, prospects)?.id).toBe("legacy");
  });
});

describe("matchingV5SelectionMatchesProspect", () => {
  const pj = JSON.stringify([{ code_insee: "33318", section: "HC", numero_norm: "0045" }]);
  const building = buildingRow("building:x", pj);
  const p = parcelle({ id: "p1", codeInsee: "33318", section: "HC", numeroNorm: "0045" });
  const allRows = [building, p];
  const linkedForP = findMatchingV5LinkedParcelleRowsTransitive(p, allRows);
  const linkedForB = findMatchingV5ParcelleRowsForBuilding(building, allRows);

  const discoveryProspect = (matchingV5RowId: string): Pick<Prospect, "pipelineEntrySource" | "matchingV5RowId"> => ({
    pipelineEntrySource: "discovery_v5",
    matchingV5RowId,
  });

  it("matche si l’id stocké est l’ancre", () => {
    expect(matchingV5SelectionMatchesProspect(p, linkedForP, allRows, discoveryProspect("p1"))).toBe(true);
  });

  it("matche bâtiment enregistré + parcelle sélectionnée (même emprise)", () => {
    expect(matchingV5SelectionMatchesProspect(p, linkedForP, allRows, discoveryProspect("building:x"))).toBe(true);
  });

  it("matche parcelle enregistrée + bâtiment sélectionné", () => {
    expect(matchingV5SelectionMatchesProspect(building, linkedForB, allRows, discoveryProspect("p1"))).toBe(true);
  });

  it("refuse hors discovery_v5", () => {
    expect(
      matchingV5SelectionMatchesProspect(p, linkedForP, allRows, {
        pipelineEntrySource: undefined,
        matchingV5RowId: "p1",
      })
    ).toBe(false);
  });

  it("refuse une autre parcelle sans lien", () => {
    const other = parcelle({ id: "z9", codeInsee: "33318", section: "ZZ", numeroNorm: "0999" });
    const rows = [...allRows, other];
    const linkedOther = findMatchingV5LinkedParcelleRowsTransitive(other, rows);
    expect(matchingV5SelectionMatchesProspect(other, linkedOther, rows, discoveryProspect("p1"))).toBe(false);
  });
});
