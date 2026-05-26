import { describe, expect, it } from "vitest";
import type { ScoutMatchingV5Row } from "./scout-matching-v5-map";
import {
  collectMatchingV5BuildingFeatures,
  collectBatimentIdsForMatchingV5BuildingsApi,
  collectPartageBatimentConstructionIds,
  findMatchingV5LinkedParcelleRows,
  findMatchingV5LinkedParcelleRowsTransitive,
  findMatchingV5ParcelleRowsForBuilding,
  findMatchingV5RowIdForBatimentFootprint,
  formatDiscoveryDrawerHeroAddress,
  formatDiscoveryDrawerHeroAddressSourceLabel,
  resolveDiscoveryDrawerHeroAddressSource,
  formatV5ZoneTagLabel,
  formatV5OsmPoiTypeLabelForDisplay,
  mergeOsmBuildingContactsFromRows,
  mergeOsmPoisFromParcelleRows,
  mergeMatchingV5RowsPreservingDetail,
  osmBrowseUrlFromBuildingId,
  isV5OsmActivityZoneTag,
  parseGoogleNearbyRankedJson,
  listValidOsmBuildingIdsInBuildingsJson,
  listValidOsmBuildingIdsInBuildingGeometriesJson,
  parseMatchingV5BuildingGeometriesJson,
  parseMatchingV5BuildingsJson,
  parseOsmPoisJson,
  parseSiretsMatchJson,
} from "./scout-matching-v5-map";

describe("formatV5ZoneTagLabel", () => {
  it("retourne les libellés FR pour landuse / leisure courants", () => {
    expect(formatV5ZoneTagLabel("residential")).toBe("Résidentiel");
    expect(formatV5ZoneTagLabel("education")).toBe("École · université · campus");
    expect(formatV5ZoneTagLabel("farmland")).toBe("Zone agricole");
    expect(formatV5ZoneTagLabel("sports_centre")).toBe("Centre sportif");
    expect(formatV5ZoneTagLabel("pitch")).toBe("Terrain de sport");
  });

  it("retourne une chaîne vide si tag absent", () => {
    expect(formatV5ZoneTagLabel("")).toBe("");
    expect(formatV5ZoneTagLabel(null)).toBe("");
  });
});

describe("isV5OsmActivityZoneTag", () => {
  it("retourne true pour industrial/commercial/retail", () => {
    expect(isV5OsmActivityZoneTag("industrial")).toBe(true);
    expect(isV5OsmActivityZoneTag(" commercial ")).toBe(true);
    expect(isV5OsmActivityZoneTag("RETAIL")).toBe(true);
  });

  it("retourne false pour les autres valeurs", () => {
    expect(isV5OsmActivityZoneTag("residential")).toBe(false);
    expect(isV5OsmActivityZoneTag("")).toBe(false);
    expect(isV5OsmActivityZoneTag(null)).toBe(false);
  });
});

function parcelle(
  partial: Partial<ScoutMatchingV5Row> & Pick<ScoutMatchingV5Row, "id" | "section" | "numeroNorm" | "codeInsee">
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

describe("formatV5OsmPoiTypeLabelForDisplay", () => {
  it("laisse inchangé un libellé déjà métier (sans syntaxe clé:valeur)", () => {
    expect(formatV5OsmPoiTypeLabelForDisplay("Restauration rapide")).toBe("Restauration rapide");
    expect(formatV5OsmPoiTypeLabelForDisplay("Garage / réparation auto")).toBe("Garage / réparation auto");
  });

  it("convertit l’ancien format OSM leisure: … en libellé client", () => {
    expect(formatV5OsmPoiTypeLabelForDisplay("leisure: amusement_arcade")).toBe("Salle d'arcades");
  });

  it("convertit shop:yes", () => {
    expect(formatV5OsmPoiTypeLabelForDisplay("shop:yes")).toBe("Magasin");
  });

  it("repli générique pour autres clé:valeur OSM", () => {
    expect(formatV5OsmPoiTypeLabelForDisplay("leisure: unknown_xyz")).toBe("Loisirs — Unknown Xyz");
  });
});

describe("formatDiscoveryDrawerHeroAddress", () => {
  it("priorise display_address confirmée à Google et PPM", () => {
    const p = parcelle({
      id: "p1",
      codeInsee: "33318",
      section: "HC",
      numeroNorm: "0045",
      displayAddress: "14 rue Confirmée 33600 Pessac",
      displayAddressConfidence: "confirmed",
      passerelleAddress: "12 rue PPM 33600 Pessac",
      properties: { google_anchor_address: "8 avenue du POI 33600 Pessac" },
    });
    expect(formatDiscoveryDrawerHeroAddress(p, [p])).toBe("14 rue Confirmée 33600 Pessac");
  });

  it("priorise google_anchor_address à la passerelle", () => {
    const p = parcelle({
      id: "p1",
      codeInsee: "33318",
      section: "HC",
      numeroNorm: "0045",
      passerelleAddress: "12 rue PPM 33600 Pessac",
      properties: { google_anchor_address: "8 avenue du POI 33600 Pessac" },
    });
    expect(formatDiscoveryDrawerHeroAddress(p, [p])).toBe("8 avenue du POI 33600 Pessac");
  });

  it("utilise la vicinity du place_id gagnant si pas d’ancre", () => {
    const ranked = JSON.stringify([
      { rank: 0, place_id: "ChIJwin", name: "Café", vicinity: "10 rue X, Pessac", types: ["cafe"] },
    ]);
    const p = parcelle({
      id: "p1",
      codeInsee: "33",
      section: "A",
      numeroNorm: "1",
      properties: {
        google_winner_place_id: "ChIJwin",
        google_nearby_ranked_json: ranked,
      },
    });
    expect(formatDiscoveryDrawerHeroAddress(p, [p])).toBe("10 rue X, Pessac");
  });

  it("utilise l’adresse OSM si pas de Google utilisable", () => {
    const osm = JSON.stringify([
      {
        osm_type: "n",
        osm_id: 1,
        name: "Shop",
        address: "5 rue OSM 33600 Pessac",
        website: "",
        phone: "",
        poi_type_label: "Magasin",
        osm_url: "",
        lat: 44.8,
        lng: -0.63,
      },
    ]);
    const p = parcelle({
      id: "p1",
      codeInsee: "33",
      section: "B",
      numeroNorm: "2",
      osmPoisJson: osm,
      passerelleAddress: "",
    });
    expect(formatDiscoveryDrawerHeroAddress(p, [p])).toBe("5 rue OSM 33600 Pessac");
  });

  it("repli passerelle puis cadastre", () => {
    const p = parcelle({
      id: "p1",
      codeInsee: "33318",
      section: "HC",
      numeroNorm: "0999",
      passerelleAddress: "Adresse ppm seule",
    });
    expect(formatDiscoveryDrawerHeroAddress(p, [p])).toBe("Adresse ppm seule");

    const p2 = parcelle({
      id: "p2",
      codeInsee: "33318",
      section: "ZZ",
      numeroNorm: "0001",
      passerelleAddress: "",
      passerelleAddressesJson: "",
    });
    expect(formatDiscoveryDrawerHeroAddress(p2, [p2])).toBe("Parcelle ZZ 0001 · 33318");
  });
});

describe("resolveDiscoveryDrawerHeroAddressSource", () => {
  it("expose display_address_source quand adresse confirmée", () => {
    const p = parcelle({
      id: "p1",
      codeInsee: "33318",
      section: "HC",
      numeroNorm: "0045",
      displayAddress: "14 rue Confirmée",
      displayAddressConfidence: "confirmed",
      displayAddressSource: "ban_reverse",
      passerelleAddress: "12 rue PPM",
    });
    expect(resolveDiscoveryDrawerHeroAddressSource(p, [p])).toBe("ban_reverse");
    expect(formatDiscoveryDrawerHeroAddressSourceLabel("ban_reverse")).toBe("BAN");
  });

  it("retourne google si ancre Google sans display_address", () => {
    const p = parcelle({
      id: "p1",
      codeInsee: "33318",
      section: "HC",
      numeroNorm: "0045",
      properties: { google_anchor_address: "8 avenue du POI" },
    });
    expect(resolveDiscoveryDrawerHeroAddressSource(p, [p])).toBe("google");
  });

  it("retourne ppm pour passerelle seule", () => {
    const p = parcelle({
      id: "p1",
      codeInsee: "33318",
      section: "HC",
      numeroNorm: "0999",
      passerelleAddress: "Adresse ppm seule",
    });
    expect(resolveDiscoveryDrawerHeroAddressSource(p, [p])).toBe("ppm");
  });

  it("retourne cadastre sans source ppm/google/display", () => {
    const p = parcelle({
      id: "p2",
      codeInsee: "33318",
      section: "ZZ",
      numeroNorm: "0001",
    });
    expect(resolveDiscoveryDrawerHeroAddressSource(p, [p])).toBe("cadastre");
  });
});

describe("parseOsmPoisJson", () => {
  it("parse un tableau JSON valide", () => {
    const raw = JSON.stringify([
      {
        osm_type: "n",
        osm_id: 1,
        name: "Garage Dupont",
        address: "3 Rue des Artisans, 33600 Pessac",
        website: "https://example.com",
        phone: "+33 5 56 00 00 00",
        poi_primary_key: "shop",
        poi_primary_value: "car_repair",
        poi_type_label: "Garage / réparation auto",
        osm_url: "https://www.openstreetmap.org/node/1",
        lat: 44.8,
        lng: -0.63,
      },
    ]);
    const list = parseOsmPoisJson(raw);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Garage Dupont");
    expect(list[0]?.address).toBe("3 Rue des Artisans, 33600 Pessac");
    expect(list[0]?.osm_id).toBe(1);
  });

  it("humanise poi_type_label au parse (exports hérités clé:valeur OSM)", () => {
    const raw = JSON.stringify([
      {
        osm_type: "n",
        osm_id: 1,
        name: "Fun",
        address: "",
        website: "",
        phone: "",
        poi_type_label: "leisure: amusement_arcade",
        osm_url: "u",
        lat: 1,
        lng: 2,
      },
    ]);
    const list = parseOsmPoisJson(raw);
    expect(list[0]?.poi_type_label).toBe("Salle d'arcades");
  });

  it("retourne vide si invalide", () => {
    expect(parseOsmPoisJson("")).toEqual([]);
    expect(parseOsmPoisJson("{")).toEqual([]);
  });
});

describe("mergeOsmPoisFromParcelleRows", () => {
  it("dédoublonne par osm_type+osm_id", () => {
    const json = JSON.stringify([
      {
        osm_type: "n",
        osm_id: 9,
        name: "A",
        address: "",
        website: "",
        phone: "",
        poi_type_label: "shop:yes",
        osm_url: "u",
        lat: 1,
        lng: 2,
      },
    ]);
    const a = parcelle({ id: "p1", section: "A", numeroNorm: "1", codeInsee: "33", osmPoisJson: json });
    const b = parcelle({ id: "p2", section: "B", numeroNorm: "2", codeInsee: "33", osmPoisJson: json });
    const merged = mergeOsmPoisFromParcelleRows([a, b]);
    expect(merged).toHaveLength(1);
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

  it("accepte un tableau JSONB déjà parsé", () => {
    const arr = [{ rank: 0, place_id: "ChIJy", name: "Café", vicinity: null, types: ["cafe"], lat: 44.2, lng: -0.6 }];
    expect(parseGoogleNearbyRankedJson(arr)).toHaveLength(1);
    expect(parseGoogleNearbyRankedJson(arr)[0]?.place_id).toBe("ChIJy");
  });

  it("accepte un objet unique (défensif)", () => {
    const one = { rank: 1, place_id: "ChIJz", name: "Shop" };
    expect(parseGoogleNearbyRankedJson(one)).toEqual([one]);
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
  it("collecte buildings_json des parcelles + ids bâtiment multi-parcelles, avec déduplication", () => {
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
    expect(collectBatimentIdsForMatchingV5BuildingsApi(rows)).toEqual(["bdnb-bg-A:1", "bdnb-bg-B:1", "bc-1"]);
  });

  it("préfère bdnb_batiment_construction_id quand présent (source OSM)", () => {
    const p = parcelle({
      id: "p-osm",
      section: "ET",
      numeroNorm: "0002",
      codeInsee: "33318",
      buildingsJson: JSON.stringify([
        {
          batiment_construction_id: "w:123456",
          bdnb_batiment_construction_id: "bdnb-bg-C:3",
          osm_building_id: "w:123456",
        },
      ]),
    });
    expect(collectBatimentIdsForMatchingV5BuildingsApi([p])).toEqual(["bdnb-bg-C:3"]);
  });
});

describe("findMatchingV5RowIdForBatimentFootprint", () => {
  it("retourne null si id vide", () => {
    expect(findMatchingV5RowIdForBatimentFootprint([parcelle({ id: "p1", section: "A", numeroNorm: "0001", codeInsee: "33" })], "")).toBeNull();
  });

  it("priorise une ligne building dont batimentConstructionId correspond", () => {
    const b = buildingRow("building:x", "[]");
    const p = parcelle({
      id: "p1",
      section: "HC",
      numeroNorm: "0045",
      codeInsee: "33318",
      buildingsJson: JSON.stringify([{ batiment_construction_id: "bc-1" }]),
    });
    expect(findMatchingV5RowIdForBatimentFootprint([p, b], "bc-1")).toBe("building:x");
  });

  it("retourne la parcelle si aucune ligne building ne correspond", () => {
    const p = parcelle({
      id: "p1",
      section: "HC",
      numeroNorm: "0045",
      codeInsee: "33318",
      buildingsJson: JSON.stringify([{ batiment_construction_id: "bc-only-parcelle" }]),
    });
    expect(findMatchingV5RowIdForBatimentFootprint([p], "bc-only-parcelle")).toBe("p1");
  });

  it("matche batiment_groupe_id dans buildings_json", () => {
    const p = parcelle({
      id: "p2",
      section: "AB",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: JSON.stringify([{ batiment_groupe_id: "bg-shared", batiment_construction_id: "x" }]),
    });
    expect(findMatchingV5RowIdForBatimentFootprint([p], "bg-shared")).toBe("p2");
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

describe("listValidOsmBuildingIdsInBuildingsJson", () => {
  it("retourne [] si vide ou invalide", () => {
    expect(listValidOsmBuildingIdsInBuildingsJson("")).toEqual([]);
    expect(listValidOsmBuildingIdsInBuildingsJson("{")).toEqual([]);
  });

  it("extrait osm_building_id même sans batiment_construction_id", () => {
    const raw = JSON.stringify([{ osm_building_id: "w:42" }, { osm_building_id: "n:7" }]);
    expect(listValidOsmBuildingIdsInBuildingsJson(raw)).toEqual(["w:42", "n:7"]);
  });

  it("ignore les ids mal formés", () => {
    const raw = JSON.stringify([
      { osm_building_id: "w:42" },
      { osm_building_id: "bad" },
      { osm_building_id: "" },
    ]);
    expect(listValidOsmBuildingIdsInBuildingsJson(raw)).toEqual(["w:42"]);
  });
});

describe("listValidOsmBuildingIdsInBuildingGeometriesJson", () => {
  it("retourne [] si vide ou invalide", () => {
    expect(listValidOsmBuildingIdsInBuildingGeometriesJson("")).toEqual([]);
    expect(listValidOsmBuildingIdsInBuildingGeometriesJson("{")).toEqual([]);
  });

  it("extrait r:/w:/n: même sans batiment_construction_id ni geometry", () => {
    const raw = JSON.stringify([
      { osm_building_id: "r:383523600", footprint_m2: 120 },
      { osm_building_id: "w:1" },
    ]);
    expect(listValidOsmBuildingIdsInBuildingGeometriesJson(raw)).toEqual(["r:383523600", "w:1"]);
  });
});

describe("parseMatchingV5BuildingGeometriesJson", () => {
  it("retourne [] si vide ou JSON invalide", () => {
    expect(parseMatchingV5BuildingGeometriesJson("")).toEqual([]);
    expect(parseMatchingV5BuildingGeometriesJson("{")).toEqual([]);
  });

  it("parse un tableau enrichi avec geometry", () => {
    const raw = JSON.stringify([
      {
        batiment_construction_id: "bdnb-bg-A:1",
        batiment_groupe_id: "bdnb-bg-A",
        annee_construction: 2017,
        footprint_m2: 1188.18,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
    ]);
    const rows = parseMatchingV5BuildingGeometriesJson(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.batimentConstructionId).toBe("bdnb-bg-A:1");
    expect(rows[0]!.geometry.type).toBe("Polygon");
    expect(rows[0]!.anneeConstruction).toBe(2017);
  });

  it("parse les champs contact OSM building enrichis", () => {
    const raw = JSON.stringify([
      {
        batiment_construction_id: "bdnb-bg-A:2",
        osm_building_id: "w:321",
        osm_name: "Atelier Delta",
        osm_website: "atelier-delta.fr",
        osm_phone: "+33 5 56 10 10 10",
        osm_poi_primary_key: "craft",
        osm_poi_primary_value: "metal_construction",
        osm_poi_type_label: "Artisanat — Metal construction",
        osm_raw_tags: { "building:use": "industrial", "addr:street": "Rue des Forges" },
        zone_tag: "industrial",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
    ]);
    const rows = parseMatchingV5BuildingGeometriesJson(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.osmName).toBe("Atelier Delta");
    expect(rows[0]!.osmWebsite).toBe("atelier-delta.fr");
    expect(rows[0]!.osmPhone).toBe("+33 5 56 10 10 10");
    expect(rows[0]!.osmPoiPrimaryKey).toBe("craft");
    expect(rows[0]!.osmRawTags?.["building:use"]).toBe("industrial");
  });
});

describe("osmBrowseUrlFromBuildingId", () => {
  it("construit une URL way/node/relation", () => {
    expect(osmBrowseUrlFromBuildingId("w:12")).toBe("https://www.openstreetmap.org/way/12");
    expect(osmBrowseUrlFromBuildingId("n:1")).toBe("https://www.openstreetmap.org/node/1");
    expect(osmBrowseUrlFromBuildingId("r:99")).toBe("https://www.openstreetmap.org/relation/99");
  });

  it("retourne vide si format inconnu", () => {
    expect(osmBrowseUrlFromBuildingId("")).toBe("");
    expect(osmBrowseUrlFromBuildingId("bad")).toBe("");
    expect(osmBrowseUrlFromBuildingId("x:1")).toBe("");
  });
});

describe("mergeOsmBuildingContactsFromRows", () => {
  it("ignore les bâtiments sans nom et dédoublonne par osm_building_id", () => {
    const shared = JSON.stringify([
      {
        batiment_construction_id: "bc-1",
        osm_building_id: "w:123",
        osm_name: "",
        osm_phone: "0556000000",
        osm_website: "https://acme.example",
        osm_poi_type_label: "",
        zone_tag: "industrial",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
    ]);
    const a = parcelle({
      id: "p1",
      section: "A",
      numeroNorm: "1",
      codeInsee: "33",
      buildingGeometriesJson: shared,
    });
    const b = parcelle({
      id: "p2",
      section: "B",
      numeroNorm: "2",
      codeInsee: "33",
      buildingGeometriesJson: shared,
    });
    const merged = mergeOsmBuildingContactsFromRows([a, b]);
    expect(merged).toHaveLength(0);
  });

  it("garde le nom building OSM quand présent", () => {
    const raw = JSON.stringify([
      {
        batiment_construction_id: "bc-2",
        osm_building_id: "w:456",
        osm_name: "Atelier Nova",
        osm_phone: "0556123456",
        osm_website: "nova.example",
        zone_tag: "industrial",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
    ]);
    const p = parcelle({
      id: "p3",
      section: "C",
      numeroNorm: "3",
      codeInsee: "33",
      buildingGeometriesJson: raw,
    });
    const merged = mergeOsmBuildingContactsFromRows([p]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe("Atelier Nova");
    expect(merged[0]!.externalUrl).toBe("https://nova.example");
  });

  it("expose la fiche OSM en externalUrl quand il n’y a pas de site web", () => {
    const raw = JSON.stringify([
      {
        batiment_construction_id: "bc-osm-only",
        osm_building_id: "w:999001",
        osm_name: "Entrepôt sans site",
        osm_phone: "",
        osm_website: "",
        zone_tag: "warehouse",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
    ]);
    const p = parcelle({
      id: "p-osm-only",
      section: "D",
      numeroNorm: "4",
      codeInsee: "33",
      buildingGeometriesJson: raw,
    });
    const merged = mergeOsmBuildingContactsFromRows([p]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.website).toBe("");
    expect(merged[0]!.externalUrl).toBe("https://www.openstreetmap.org/way/999001");
  });
});

describe("collectMatchingV5BuildingFeatures", () => {
  it("construit des features depuis building_geometries_json", () => {
    const p = parcelle({
      id: "p1",
      section: "ET",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingGeometriesJson: JSON.stringify([
        {
          batiment_construction_id: "bdnb-bg-A:1",
          batiment_groupe_id: "bdnb-bg-A",
          annee_construction: 2017,
          footprint_m2: 1188.18,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        },
      ]),
    });
    const features = collectMatchingV5BuildingFeatures([p]);
    expect(features).toHaveLength(1);
    expect(features[0]!.id).toBe("bdnbcstr:bdnb-bg-A:1");
  });

  it("déduplique avec une ligne grain=building déjà présente", () => {
    const p = parcelle({
      id: "p1",
      section: "ET",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingGeometriesJson: JSON.stringify([
        {
          batiment_construction_id: "bc-1",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        },
      ]),
    });
    const features = collectMatchingV5BuildingFeatures([p, buildingRow("building:x", "[]")]);
    expect(features).toHaveLength(1);
    expect(features[0]!.id).toBe("bdnbcstr:bc-1");
  });
});

describe("mergeMatchingV5RowsPreservingDetail", () => {
  const base = (id: string, geom: ScoutMatchingV5Row["geometry"], bg = ""): ScoutMatchingV5Row =>
    ({
      id,
      grain: "parcelle",
      geometry: geom,
      buildingsJson: "[]",
      buildingGeometriesJson: bg,
      footprintSumM2: 0,
      batimentConstructionId: "",
      batimentGroupeId: null,
      osmBuildingId: "",
      statusMetier: "",
      properties: {},
    }) as ScoutMatchingV5Row;

  it("garde le polygone hydraté quand le viewport renvoie un Point overview", () => {
    const hydrated = base("p1", {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    });
    const overview = base("p1", { type: "Point", coordinates: [0, 0] });
    const merged = mergeMatchingV5RowsPreservingDetail([hydrated], [overview]);
    expect(merged[0]!.geometry.type).toBe("Polygon");
  });
});
