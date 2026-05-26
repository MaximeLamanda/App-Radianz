import { describe, expect, it } from "vitest";
import {
  discoveryComboMarkersFromOverview,
  parseDiscoveryCombosOverviewFeatureCollection,
} from "./discovery-combos-overview";

describe("parseDiscoveryCombosOverviewFeatureCollection", () => {
  it("parse une FeatureCollection combo", () => {
    const raw = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "combo:p1|p2",
          geometry: { type: "Point", coordinates: [-0.5, 44.1] },
          properties: {
            combo_id: "combo:p1|p2",
            footprint_sum_m2: 684,
            parcel_contour_sum_m2: 10495,
            parking_sum_m2: 1250,
            has_landuse_waiver: false,
            anchor_parcelle_id: "p1",
            parcelle_scout_v5_ids: ["p1", "p2"],
            osm_building_ids: ["w:1", "w:2"],
            zone_tags: ["industrial", "commercial"],
            construction_years: [1998, 2012],
          },
        },
      ],
    };
    const pts = parseDiscoveryCombosOverviewFeatureCollection(raw);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.comboId).toBe("combo:p1|p2");
    expect(pts[0]!.position).toEqual({ lat: 44.1, lng: -0.5 });
    expect(pts[0]!.footprintSumM2).toBe(684);
    expect(pts[0]!.parcelContourSumM2).toBe(10495);
    expect(pts[0]!.parkingSumM2).toBe(1250);
    expect(pts[0]!.osmBuildingIds).toEqual(["w:1", "w:2"]);
    expect(pts[0]!.zoneTags).toEqual(["commercial", "industrial"]);
    expect(pts[0]!.constructionYears).toEqual([1998, 2012]);
  });
});

describe("discoveryComboMarkersFromOverview", () => {
  it("mappe vers DiscoveryComboMarker", () => {
    const markers = discoveryComboMarkersFromOverview([
      {
        comboId: "combo:p1",
        position: { lat: 44, lng: -0.6 },
        footprintSumM2: 1200,
        parcelContourSumM2: 5000,
        parkingSumM2: 0,
        hasLanduseWaiver: true,
        anchorParcelleId: "p1",
        parcelleScoutV5Ids: ["p1"],
        osmBuildingIds: ["w:9"],
        zoneTags: ["retail"],
        constructionYears: [2005],
        nafDivisions: ["47"],
      },
    ]);
    expect(markers[0]).toEqual({
      comboId: "combo:p1",
      position: { lat: 44, lng: -0.6 },
      anchorParcelleId: "p1",
      parcelleScoutV5Ids: ["p1"],
      osmBuildingIds: ["w:9"],
      footprintSumM2: 1200,
      parcelContourSumM2: 5000,
      zoneTags: ["retail"],
      constructionYears: [2005],
      nafDivisions: ["47"],
    });
  });
});
