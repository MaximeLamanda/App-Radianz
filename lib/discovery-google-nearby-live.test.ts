import { describe, expect, it } from "vitest";
import type { ScoutMatchingV5Row } from "./scout-matching-v5-map";
import type { RankedNearbyPlace } from "./matching-v5-google-poi-fallback/types";
import {
  buildParcelUnionGeometry,
  nearbySearchRadiusMForGeometry,
  rankedNearbyPlacesToV5Entries,
} from "./discovery-google-nearby-live";

describe("rankedNearbyPlacesToV5Entries", () => {
  it("mappe vers V5GoogleNearbyRankedEntry (rank 0..n-1)", () => {
    const ranked: RankedNearbyPlace[] = [
      {
        place_id: "ChIJx",
        name: "Café test",
        vicinity: "Rue A",
        types: ["cafe", "food"],
        geometry: { location: { lat: 44.5, lng: -0.52 } },
        distanceM: 12,
        typeScore: 0.4,
        relevanceScore: 0.9,
        insideParcel: true,
      },
    ];
    const out = rankedNearbyPlacesToV5Entries(ranked);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      rank: 0,
      place_id: "ChIJx",
      name: "Café test",
      vicinity: "Rue A",
      types: ["cafe", "food"],
      lat: 44.5,
      lng: -0.52,
    });
  });
});

describe("buildParcelUnionGeometry", () => {
  it("retourne null sans parcelle", () => {
    expect(buildParcelUnionGeometry([])).toBeNull();
  });

  it("une parcelle Polygon => Polygon", () => {
    const rows: ScoutMatchingV5Row[] = [
      {
        grain: "parcelle",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-0.6, 44.8],
              [-0.59, 44.8],
              [-0.59, 44.81],
              [-0.6, 44.81],
              [-0.6, 44.8],
            ],
          ],
        },
      } as ScoutMatchingV5Row,
    ];
    const g = buildParcelUnionGeometry(rows);
    expect(g?.type).toBe("Polygon");
  });

  it("deux parcelles => MultiPolygon à deux parties", () => {
    const ringA = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
      [0, 0],
    ];
    const ringB = [
      [0.05, 0.05],
      [0.06, 0.05],
      [0.06, 0.06],
      [0.05, 0.06],
      [0.05, 0.05],
    ];
    const rows: ScoutMatchingV5Row[] = [
      { grain: "parcelle", geometry: { type: "Polygon", coordinates: [ringA] } } as ScoutMatchingV5Row,
      { grain: "parcelle", geometry: { type: "Polygon", coordinates: [ringB] } } as ScoutMatchingV5Row,
    ];
    const g = buildParcelUnionGeometry(rows);
    expect(g?.type).toBe("MultiPolygon");
    if (g?.type === "MultiPolygon") {
      expect(g.coordinates).toHaveLength(2);
    }
  });
});

describe("nearbySearchRadiusMForGeometry", () => {
  it("retourne au moins 100 m", () => {
    const g: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0.0001, 0],
          [0.0001, 0.0001],
          [0, 0.0001],
          [0, 0],
        ],
      ],
    };
    expect(nearbySearchRadiusMForGeometry(g)).toBeGreaterThanOrEqual(100);
  });
});
