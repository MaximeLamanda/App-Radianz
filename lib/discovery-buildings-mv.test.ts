import { describe, expect, it } from "vitest";
import {
  dedupBuildingPointsByOsmId,
  isValidOsmBuildingId,
  parseDiscoveryBuildingParcellesResolution,
  parseDiscoveryBuildingsOverviewFeatureCollection,
} from "@/lib/discovery-buildings-mv";

describe("isValidOsmBuildingId", () => {
  it.each(["w:123", "r:1", "n:42", "w:9999999"])("accepte %s", (id) => {
    expect(isValidOsmBuildingId(id)).toBe(true);
  });
  it.each(["", "w:", ":123", "x:1", "w:abc", "w 123", "w:-1"])(
    "refuse %s",
    (id) => {
      expect(isValidOsmBuildingId(id)).toBe(false);
    }
  );
});

describe("parseDiscoveryBuildingsOverviewFeatureCollection", () => {
  it("parse une FeatureCollection minimale", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "w:1",
          geometry: { type: "Point", coordinates: [-0.6, 44.8] },
          properties: {
            osm_building_id: "w:1",
            footprint_m2: 120.5,
            parcelle_count: 2,
            parcelle_scout_v5_ids: ["parcelle-a", "parcelle-b"],
          },
        },
      ],
    };
    const out = parseDiscoveryBuildingsOverviewFeatureCollection(fc);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      osmBuildingId: "w:1",
      position: { lat: 44.8, lng: -0.6 },
      footprintM2: 120.5,
      parcelleCount: 2,
      parcelleScoutV5Ids: ["parcelle-a", "parcelle-b"],
    });
  });

  it("ignore les features sans osm_building_id ou geometry invalide", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [] },
          properties: { osm_building_id: "w:2" },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: {},
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-0.1, 44.0] },
          properties: { osm_building_id: "  " },
        },
      ],
    };
    expect(parseDiscoveryBuildingsOverviewFeatureCollection(fc)).toEqual([]);
  });

  it("renvoie un tableau vide pour une entrée non valide", () => {
    expect(parseDiscoveryBuildingsOverviewFeatureCollection(null)).toEqual([]);
    expect(parseDiscoveryBuildingsOverviewFeatureCollection({ type: "x" })).toEqual([]);
    expect(parseDiscoveryBuildingsOverviewFeatureCollection({ type: "FeatureCollection" })).toEqual(
      []
    );
  });
});

describe("dedupBuildingPointsByOsmId", () => {
  it("garde la première occurrence par osm_building_id", () => {
    const a = {
      osmBuildingId: "w:1",
      position: { lat: 44.8, lng: -0.6 },
      footprintM2: 100,
      matchingStatus: "mono",
      parcelleCount: 1,
      parcelleScoutV5Ids: ["p1"],
    };
    const b = {
      osmBuildingId: "w:1",
      position: { lat: 0, lng: 0 },
      footprintM2: 999,
      matchingStatus: "partage",
      parcelleCount: 2,
      parcelleScoutV5Ids: ["p1", "p2"],
    };
    const c = {
      osmBuildingId: "w:2",
      position: { lat: 44.9, lng: -0.5 },
      footprintM2: 200,
      matchingStatus: "mono",
      parcelleCount: 1,
      parcelleScoutV5Ids: ["p3"],
    };
    expect(dedupBuildingPointsByOsmId([a, b, c])).toEqual([a, c]);
  });

  it("ignore les ids vides", () => {
    const a = {
      osmBuildingId: "",
      position: { lat: 44.8, lng: -0.6 },
      footprintM2: null,
      matchingStatus: "",
      parcelleCount: 0,
      parcelleScoutV5Ids: [],
    };
    expect(dedupBuildingPointsByOsmId([a])).toEqual([]);
  });
});

describe("parseDiscoveryBuildingParcellesResolution", () => {
  it("parse une réponse complète", () => {
    const r = parseDiscoveryBuildingParcellesResolution({
      osm_building_id: "w:1",
      parcelle_scout_v5_ids: ["parcelle:33318:AB:0001", "parcelle:33318:AB:0002"],
      batiment_construction_id: "bdnb-xyz",
      footprint_m2: 150,
      matching_status: "partage",
    });
    expect(r).toEqual({
      osmBuildingId: "w:1",
      parcelleScoutV5Ids: ["parcelle:33318:AB:0001", "parcelle:33318:AB:0002"],
      batimentConstructionId: "bdnb-xyz",
      footprintM2: 150,
      matchingStatus: "partage",
    });
  });

  it("normalise les champs manquants ou invalides", () => {
    const r = parseDiscoveryBuildingParcellesResolution({
      osm_building_id: "w:9",
      parcelle_scout_v5_ids: null,
    });
    expect(r).toEqual({
      osmBuildingId: "w:9",
      parcelleScoutV5Ids: [],
      batimentConstructionId: null,
      footprintM2: null,
      matchingStatus: "",
    });
  });

  it("renvoie null si osm_building_id absent ou invalide", () => {
    expect(parseDiscoveryBuildingParcellesResolution({})).toBeNull();
    expect(parseDiscoveryBuildingParcellesResolution(null)).toBeNull();
    expect(parseDiscoveryBuildingParcellesResolution({ osm_building_id: "" })).toBeNull();
  });
});
