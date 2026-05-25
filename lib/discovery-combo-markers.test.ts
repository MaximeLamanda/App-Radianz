import { describe, expect, it } from "vitest";
import type { ScoutMatchingV5Row } from "./scout-matching-v5-map";
import type { DiscoveryBuildingPoint } from "./discovery-buildings-mv";
import {
  buildDiscoveryComboMarkers,
  buildParcelleComboIndex,
  comboIdFromParcelleIds,
  comboMeetsDiscoverySurfaceRange,
  filterDiscoveryComboMarkersBySurface,
  findComboAnchorForOsmBuilding,
  resolveComboMarkerSelection,
} from "./discovery-combo-markers";

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

function point(
  osmBuildingId: string,
  lat: number,
  lng: number,
  parcelleScoutV5Ids: string[] = []
): DiscoveryBuildingPoint {
  return {
    osmBuildingId,
    position: { lat, lng },
    footprintM2: 100,
    matchingStatus: "",
    parcelleCount: parcelleScoutV5Ids.length || 1,
    parcelleScoutV5Ids,
  };
}

describe("comboIdFromParcelleIds", () => {
  it("joint les ids triés", () => {
    expect(comboIdFromParcelleIds(["p2", "p1"])).toBe("combo:p1|p2");
  });
});

describe("buildParcelleComboIndex", () => {
  it("fusionne deux parcelles en partage", () => {
    const jsonA = JSON.stringify([{ batiment_construction_id: "bc-x", matching_status: "partage" }]);
    const jsonB = JSON.stringify([{ batiment_construction_id: "bc-x", matching_status: "partage" }]);
    const p1 = parcelle({ id: "p1", section: "A", numeroNorm: "0001", codeInsee: "33318", buildingsJson: jsonA });
    const p2 = parcelle({ id: "p2", section: "B", numeroNorm: "0002", codeInsee: "33318", buildingsJson: jsonB });
    const p3 = parcelle({ id: "p3", section: "C", numeroNorm: "0003", codeInsee: "33318", buildingsJson: "[]" });
    const index = buildParcelleComboIndex([p1, p2, p3]);
    expect(index.get("p1")).toBe("combo:p1|p2");
    expect(index.get("p2")).toBe("combo:p1|p2");
    expect(index.get("p3")).toBe("combo:p3");
  });
});

describe("buildDiscoveryComboMarkers", () => {
  it("agrège deux bâtiments du même combo en un marqueur au centroïde", () => {
    const json = JSON.stringify([{ batiment_construction_id: "bc-x", matching_status: "partage" }]);
    const geoms = (osmId: string) =>
      JSON.stringify([{ batiment_construction_id: "bc-x", osm_building_id: osmId, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }]);
    const p1 = parcelle({
      id: "p1",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: json,
      buildingGeometriesJson: geoms("w:1"),
    });
    const p2 = parcelle({
      id: "p2",
      section: "B",
      numeroNorm: "0002",
      codeInsee: "33318",
      buildingsJson: json,
      buildingGeometriesJson: geoms("w:2"),
    });
    const markers = buildDiscoveryComboMarkers(
      [p1, p2],
      [point("w:1", 44.0, -0.5), point("w:2", 44.2, -0.3)]
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]!.comboId).toBe("combo:p1|p2");
    expect(markers[0]!.position.lat).toBeCloseTo(44.1, 5);
    expect(markers[0]!.position.lng).toBeCloseTo(-0.4, 5);
    expect(markers[0]!.osmBuildingIds.sort()).toEqual(["w:1", "w:2"]);
    expect(markers[0]!.anchorParcelleId).toBe("p1");
  });

  it("émet deux marqueurs pour deux parcelles isolées", () => {
    const g1 = JSON.stringify([
      { batiment_construction_id: "bc-1", osm_building_id: "w:1", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    ]);
    const g2 = JSON.stringify([
      { batiment_construction_id: "bc-2", osm_building_id: "w:2", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    ]);
    const p1 = parcelle({
      id: "p1",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingGeometriesJson: g1,
    });
    const p2 = parcelle({
      id: "p2",
      section: "B",
      numeroNorm: "0002",
      codeInsee: "33318",
      buildingGeometriesJson: g2,
    });
    const markers = buildDiscoveryComboMarkers(
      [p1, p2],
      [point("w:1", 44, -0.5), point("w:2", 45, -0.6)]
    );
    expect(markers).toHaveLength(2);
    expect(new Set(markers.map((m) => m.comboId))).toEqual(new Set(["combo:p1", "combo:p2"]));
  });

  it("fallback : un marqueur par point si rows vide", () => {
    const markers = buildDiscoveryComboMarkers([], [point("w:9", 44, -0.5)]);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.comboId).toBe("w:9");
    expect(markers[0]!.anchorParcelleId).toBe("");
  });

  it("regroupe via parcelle_scout_v5_ids MV sans building_geometries_json (mode overview)", () => {
    const json = JSON.stringify([{ batiment_construction_id: "bc-x", matching_status: "partage" }]);
    const p1 = parcelle({
      id: "p1",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: json,
      buildingGeometriesJson: "",
    });
    const p2 = parcelle({
      id: "p2",
      section: "B",
      numeroNorm: "0002",
      codeInsee: "33318",
      buildingsJson: json,
      buildingGeometriesJson: "",
    });
    const markers = buildDiscoveryComboMarkers(
      [p1, p2],
      [
        point("w:1", 44.0, -0.5, ["p1"]),
        point("w:2", 44.2, -0.3, ["p2"]),
      ]
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]!.comboId).toBe("combo:p1|p2");
  });
});

describe("findComboAnchorForOsmBuilding", () => {
  it("renvoie l’ancre cadastrale du combo", () => {
    const json = JSON.stringify([{ batiment_construction_id: "bc-x", matching_status: "partage" }]);
    const geoms = JSON.stringify([
      { batiment_construction_id: "bc-x", osm_building_id: "w:1", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    ]);
    const p1 = parcelle({
      id: "p1",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: json,
      buildingGeometriesJson: geoms,
    });
    const p2 = parcelle({
      id: "p2",
      section: "B",
      numeroNorm: "0002",
      codeInsee: "33318",
      buildingsJson: json,
      buildingGeometriesJson: "[]",
    });
    expect(findComboAnchorForOsmBuilding([p1, p2], "w:1")).toEqual({
      comboId: "combo:p1|p2",
      anchorParcelleId: "p1",
      representativeOsmBuildingId: "w:1",
    });
  });
});

describe("filterDiscoveryComboMarkersBySurface", () => {
  it("masque un combo dont la somme d’empreintes est sous le plancher", () => {
    const json = JSON.stringify([
      { batiment_construction_id: "bc-1", footprint_m2: 200, osm_building_id: "w:1" },
      { batiment_construction_id: "bc-2", footprint_m2: 150, osm_building_id: "w:2" },
    ]);
    const p1 = parcelle({
      id: "p1",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      footprintSumM2: 350,
      buildingsJson: json,
    });
    const built = buildDiscoveryComboMarkers(
      [p1],
      [point("w:1", 44, -0.5, ["p1"]), point("w:2", 44.01, -0.51, ["p1"])]
    );
    expect(built).toHaveLength(1);
    expect(built[0]!.footprintSumM2).toBe(350);
    const filtered = filterDiscoveryComboMarkersBySurface(built, [p1], [], 400, 50_000);
    expect(filtered).toHaveLength(0);
    expect(
      comboMeetsDiscoverySurfaceRange(built[0]!, [p1], [], 400, Number.POSITIVE_INFINITY)
    ).toBe(false);
  });

  it("conserve un combo au-dessus du plancher (somme OSM)", () => {
    const json = JSON.stringify([
      { batiment_construction_id: "bc-1", footprint_m2: 8000, osm_building_id: "w:1" },
      { batiment_construction_id: "bc-2", footprint_m2: 7267, osm_building_id: "w:2" },
    ]);
    const p1 = parcelle({
      id: "p1",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      footprintSumM2: 15267,
      buildingsJson: json,
    });
    const built = buildDiscoveryComboMarkers([p1], [point("w:1", 44, -0.5, ["p1"])]);
    expect(built[0]!.footprintSumM2).toBe(15267);
    const filtered = filterDiscoveryComboMarkersBySurface(built, [p1], [], 400, 50_000);
    expect(filtered).toHaveLength(1);
  });

  it("déduplique un bâtiment partagé : somme combo = 684, pas 1235", () => {
    const sharedBc = "bc-shared";
    const p1 = parcelle({
      id: "p1",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      footprintSumM2: 551,
      buildingsJson: JSON.stringify([{ batiment_construction_id: sharedBc, footprint_m2: 551, osm_building_id: "w:1", matching_status: "partage" }]),
    });
    const p2 = parcelle({
      id: "p2",
      section: "B",
      numeroNorm: "0002",
      codeInsee: "33318",
      footprintSumM2: 684,
      buildingsJson: JSON.stringify([
        { batiment_construction_id: sharedBc, footprint_m2: 551, osm_building_id: "w:1", matching_status: "partage" },
        { batiment_construction_id: "bc-other", footprint_m2: 133, osm_building_id: "w:2", matching_status: "partage" },
      ]),
    });
    const built = buildDiscoveryComboMarkers(
      [p1, p2],
      [point("w:1", 44, -0.5, ["p1"]), point("w:2", 44.2, -0.3, ["p2"])]
    );
    expect(built).toHaveLength(1);
    expect(built[0]!.footprintSumM2).toBe(684);
    expect(filterDiscoveryComboMarkersBySurface(built, [p1, p2], [], 700, 50_000)).toHaveLength(0);
    expect(filterDiscoveryComboMarkersBySurface(built, [p1, p2], [], 400, 50_000)).toHaveLength(1);
  });
});

describe("resolveComboMarkerSelection", () => {
  it("retrouve ancre et osm représentatif", () => {
    const markers = buildDiscoveryComboMarkers(
      [
        parcelle({
          id: "p1",
          section: "A",
          numeroNorm: "0001",
          codeInsee: "33318",
          buildingGeometriesJson: JSON.stringify([
            {
              batiment_construction_id: "bc-1",
              osm_building_id: "w:1",
              geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
            },
          ]),
        }),
      ],
      [point("w:1", 44, -0.5)]
    );
    expect(resolveComboMarkerSelection("combo:p1", markers)).toEqual({
      comboId: "combo:p1",
      anchorParcelleId: "p1",
      representativeOsmBuildingId: "w:1",
    });
  });
});
