import { describe, expect, it } from "vitest";
import type { DiscoveryBuildingPoint } from "@/lib/discovery-buildings-mv";
import {
  buildDiscoveryOsmBuildingSurfaceIndex,
  buildingHasProLanduseWaiver,
  buildingPointMeetsDiscoverySurfaceRange,
  discoveryBuildingPointMeetsSurfaceRange,
  rowDiscoveryFootprintSumM2,
  rowMeetsDiscoverySurfaceMinM2,
  rowMeetsDiscoverySurfaceRange,
} from "@/lib/discovery-footprint-landuse-waiver";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";

function row(partial: Partial<ScoutMatchingV5Row> & { buildingsJson?: string }): ScoutMatchingV5Row {
  return {
    id: "p1",
    grain: "parcelle",
    footprintSumM2: partial.footprintSumM2 ?? 50,
    buildingsJson: partial.buildingsJson ?? "[]",
    ...partial,
  } as ScoutMatchingV5Row;
}

describe("discovery-footprint-landuse-waiver", () => {
  it("refuse industrial sous le seuil (pas de dérogation côté slider Découverte)", () => {
    const r = row({
      footprintSumM2: 94,
      buildingsJson: JSON.stringify([
        {
          batiment_construction_id: "r:1",
          zone_tag: "industrial",
          zone_source: "landuse",
          osm_building_id: "r:1",
        },
      ]),
    });
    expect(rowMeetsDiscoverySurfaceMinM2(r, 400)).toBe(false);
  });

  it("refuse residential sous le seuil", () => {
    const r = row({
      footprintSumM2: 94,
      buildingsJson: JSON.stringify([
        {
          batiment_construction_id: "r:1",
          zone_tag: "residential",
          zone_source: "landuse",
          osm_building_id: "r:1",
        },
      ]),
    });
    expect(rowMeetsDiscoverySurfaceMinM2(r, 400)).toBe(false);
  });

  it("buildingHasProLanduseWaiver exige zone_source landuse", () => {
    expect(
      buildingHasProLanduseWaiver({
        zoneTag: "commercial",
        zoneSource: "building_use",
      })
    ).toBe(false);
  });

  it("repli footprint_sum_m2=0 sur buildings_json", () => {
    const r = row({
      footprintSumM2: 0,
      buildingsJson: JSON.stringify([
        { batiment_construction_id: "bc1", footprint_m2: 250 },
        { batiment_construction_id: "bc2", footprint_m2: 300 },
      ]),
    });
    expect(rowDiscoveryFootprintSumM2(r)).toBe(550);
    expect(rowMeetsDiscoverySurfaceRange(r, 400, 600)).toBe(true);
    expect(rowMeetsDiscoverySurfaceRange(r, 400, 500)).toBe(false);
  });

  it("buildingPointMeetsDiscoverySurfaceRange borne haute ouverte", () => {
    expect(buildingPointMeetsDiscoverySurfaceRange(1200, 0, Number.POSITIVE_INFINITY)).toBe(true);
    expect(buildingPointMeetsDiscoverySurfaceRange(300, 400, Number.POSITIVE_INFINITY)).toBe(false);
    expect(buildingPointMeetsDiscoverySurfaceRange(900, 0, 800)).toBe(false);
  });

  it("discoveryBuildingPointMeetsSurfaceRange refuse sous le seuil même en industrial", () => {
    const r = row({
      footprintSumM2: 94,
      buildingsJson: JSON.stringify([
        {
          batiment_construction_id: "r:1",
          zone_tag: "industrial",
          zone_source: "landuse",
          osm_building_id: "w:42",
          footprint_m2: 94,
        },
      ]),
    });
    const index = buildDiscoveryOsmBuildingSurfaceIndex([r]);
    const point: DiscoveryBuildingPoint = {
      osmBuildingId: "w:42",
      position: { lat: 44, lng: -0.5 },
      footprintM2: 94,
      matchingStatus: "",
      parcelleCount: 1,
      parcelleScoutV5Ids: ["p1"],
    };
    expect(discoveryBuildingPointMeetsSurfaceRange(point, index, 400, Number.POSITIVE_INFINITY)).toBe(
      false
    );
    expect(discoveryBuildingPointMeetsSurfaceRange(point, index, 0, 200)).toBe(true);
  });
});
