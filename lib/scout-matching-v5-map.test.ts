import { describe, expect, it } from "vitest";
import type { ScoutMatchingV5Row } from "./scout-matching-v5-map";
import {
  collectBatimentIdsForMatchingV5BuildingsApi,
  collectPartageBatimentConstructionIds,
  findMatchingV5LinkedParcelleRows,
  findMatchingV5LinkedParcelleRowsTransitive,
  findMatchingV5ParcelleRowsForBuilding,
  parseGoogleNearbyRankedJson,
  parseMatchingV5BuildingsJson,
  parseSiretsMatchJson,
} from "./scout-matching-v5-map";

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
    codeIris: "",
    nomIris: "",
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
    codeIris: "",
    nomIris: "",
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
    parcellesJson,
    properties: {},
  } as ScoutMatchingV5Row;
}

describe("findMatchingV5ParcelleRowsForBuilding", () => {
  it("retourne les parcelles dont la clé est dans parcelles_json", () => {
    const pj = JSON.stringify([
      { code_insee: "33318", section: "HC", numero_norm: "0045" },
    ]);
    const b = buildingRow("building:x", pj);
    const p = parcelle({ id: "p1", codeInsee: "33318", section: "HC", numeroNorm: "0045" });
    const other = parcelle({ id: "p2", codeInsee: "33318", section: "AB", numeroNorm: "0001" });
    expect(findMatchingV5ParcelleRowsForBuilding(b, [b, p, other])).toEqual([p]);
  });

  it("retourne vide si grain !== building", () => {
    const p = parcelle({ id: "p1", codeInsee: "33318", section: "HC", numeroNorm: "0045" });
    expect(findMatchingV5ParcelleRowsForBuilding(p, [p])).toEqual([]);
  });
});

describe("parseGoogleNearbyRankedJson", () => {
  it("parse un tableau JSON valide", () => {
    const raw = JSON.stringify([
      { rank: 0, place_id: "ChIJx", name: "Test", vicinity: null, types: ["store"], lat: 44.1, lng: -0.62 },
    ]);
    expect(parseGoogleNearbyRankedJson(raw)).toHaveLength(1);
    expect(parseGoogleNearbyRankedJson(raw)[0]?.place_id).toBe("ChIJx");
  });

  it("retourne vide si invalide", () => {
    expect(parseGoogleNearbyRankedJson("")).toEqual([]);
    expect(parseGoogleNearbyRankedJson("{")).toEqual([]);
  });
});

describe("collectPartageBatimentConstructionIds", () => {
  it("retourne vide sans partage", () => {
    const row = parcelle({
      id: "a",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: JSON.stringify([
        { batiment_construction_id: "bc-1", matching_status: "ok" },
      ]),
    });
    expect(collectPartageBatimentConstructionIds(row).size).toBe(0);
  });

  it("collecte les ids partage", () => {
    const row = parcelle({
      id: "a",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: JSON.stringify([
        { batiment_construction_id: "bc-x", matching_status: "partage" },
      ]),
    });
    expect(collectPartageBatimentConstructionIds(row)).toEqual(new Set(["bc-x"]));
  });
});

describe("collectBatimentIdsForMatchingV5BuildingsApi", () => {
  it("ignore les lignes non-parcelle et déduplique", () => {
    const p = parcelle({
      id: "p1",
      section: "ET",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: JSON.stringify([
        { batiment_construction_id: "bdnb-bg-A:1", batiment_groupe_id: "bdnb-bg-A" },
        { batiment_construction_id: "bdnb-bg-B:1", batiment_groupe_id: "bdnb-bg-B" },
      ]),
    });
    const rows = [p, buildingRow("b1", "[]")];
    expect(collectBatimentIdsForMatchingV5BuildingsApi(rows)).toEqual(["bdnb-bg-A:1", "bdnb-bg-B:1"]);
  });
});

describe("findMatchingV5LinkedParcelleRows", () => {
  it("retourne uniquement l’ancre sans partage", () => {
    const a = parcelle({
      id: "1",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: "[]",
    });
    expect(findMatchingV5LinkedParcelleRows(a, [a, parcelle({ id: "2", section: "B", numeroNorm: "0002", codeInsee: "33318" })])).toEqual([
      a,
    ]);
  });

  it("lie les parcelles qui partagent un batiment_construction_id en partage", () => {
    const jsonA = JSON.stringify([{ batiment_construction_id: "bc-shared", matching_status: "partage" }]);
    const jsonB = JSON.stringify([{ batiment_construction_id: "bc-shared" }]);
    const a = parcelle({ id: "p1", section: "A", numeroNorm: "0001", codeInsee: "33318", buildingsJson: jsonA });
    const b = parcelle({ id: "p2", section: "B", numeroNorm: "0002", codeInsee: "33318", buildingsJson: jsonB });
    const other = parcelle({ id: "p3", section: "C", numeroNorm: "0003", codeInsee: "33318", buildingsJson: "[]" });
    const rows = [b, other, a];
    const linked = findMatchingV5LinkedParcelleRows(a, rows);
    expect(linked.map((r) => r.id).sort()).toEqual(["p1", "p2"]);
  });
});

describe("findMatchingV5LinkedParcelleRowsTransitive", () => {
  it("inclut la chaîne p1–p2–p3 via deux bâtiments partage distincts", () => {
    const json1 = JSON.stringify([{ batiment_construction_id: "bc-A", matching_status: "partage" }]);
    const json2 = JSON.stringify([
      { batiment_construction_id: "bc-A", matching_status: "partage" },
      { batiment_construction_id: "bc-B", matching_status: "partage" },
    ]);
    const json3 = JSON.stringify([{ batiment_construction_id: "bc-B", matching_status: "partage" }]);
    const p1 = parcelle({ id: "p1", section: "A", numeroNorm: "0001", codeInsee: "33318", buildingsJson: json1 });
    const p2 = parcelle({ id: "p2", section: "B", numeroNorm: "0002", codeInsee: "33318", buildingsJson: json2 });
    const p3 = parcelle({ id: "p3", section: "C", numeroNorm: "0003", codeInsee: "33318", buildingsJson: json3 });
    const rows = [p3, p1, p2];
    const fromP1 = findMatchingV5LinkedParcelleRowsTransitive(p1, rows);
    expect(fromP1.map((r) => r.id).sort()).toEqual(["p1", "p2", "p3"]);
    const nonTransitive = findMatchingV5LinkedParcelleRows(p1, rows);
    expect(nonTransitive.map((r) => r.id).sort()).toEqual(["p1", "p2"]);
    expect(findMatchingV5LinkedParcelleRowsTransitive(p3, rows).map((r) => r.id).sort()).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
  });

  it("retourne uniquement l’ancre sans partage", () => {
    const a = parcelle({
      id: "1",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: "[]",
    });
    expect(findMatchingV5LinkedParcelleRowsTransitive(a, [a])).toEqual([a]);
  });
});

describe("parseSiretsMatchJson (champs api.gouv / alias)", () => {
  it("accepte tranche_effectif_salarie et annee_tranche_effectif_salarie", () => {
    const raw = JSON.stringify([
      {
        siret: "12345678901234",
        siren: "123456789",
        denomination: "Test",
        tranche_effectif_salarie: "03",
        annee_tranche_effectif_salarie: "2022",
        activite_principale: "6201Z",
      },
    ]);
    const rows = parseSiretsMatchJson(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tranche_effectifs).toBe("03");
    expect(rows[0]!.annee_effectifs).toBe("2022");
    expect(rows[0]!.activite_principale).toBe("6201Z");
  });
});

describe("parseMatchingV5BuildingsJson", () => {
  it("retourne [] si vide ou JSON invalide", () => {
    expect(parseMatchingV5BuildingsJson("")).toEqual([]);
    expect(parseMatchingV5BuildingsJson("[]")).toEqual([]);
    expect(parseMatchingV5BuildingsJson("{")).toEqual([]);
  });

  it("parse un tableau export pipeline", () => {
    const raw = JSON.stringify([
      {
        batiment_construction_id: "bdnb-bg-A:1",
        batiment_groupe_id: "bdnb-bg-A",
        annee_construction: 2017,
        footprint_m2: 1188.18,
        intersection_area_m2: 1188.1,
        matching_status: "mono",
        matching_decision: "mono",
        matching_siren_selected: "",
      },
    ]);
    const rows = parseMatchingV5BuildingsJson(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.batimentConstructionId).toBe("bdnb-bg-A:1");
    expect(rows[0]!.batimentGroupeId).toBe("bdnb-bg-A");
    expect(rows[0]!.anneeConstruction).toBe(2017);
    expect(rows[0]!.footprintM2).toBeCloseTo(1188.18, 1);
    expect(rows[0]!.matchingStatus).toBe("mono");
  });
});
