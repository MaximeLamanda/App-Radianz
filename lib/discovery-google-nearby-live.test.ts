import { describe, expect, it } from "vitest";
import type { ScoutMatchingV5Row } from "./scout-matching-v5-map";
import type { RankedNearbyPlace } from "./matching-v5-google-poi-fallback/types";
import {
  buildParcelUnionGeometry,
  circlePolygonFromCenterRadiusM,
  filterGoogleNearbyEntriesInParcel,
  nearbySearchRadiusMForGeometry,
  parcelSearchContextForGoogleNearby,
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

describe("parcelSearchContextForGoogleNearby", () => {
  it("dérive un polygone tampon pour une parcelle en Point (aperçu carte)", () => {
    const rows: ScoutMatchingV5Row[] = [
      {
        grain: "parcelle",
        geometry: { type: "Point", coordinates: [-0.6, 44.84] },
        footprintSumM2: 2500,
      } as ScoutMatchingV5Row,
    ];
    const ctx = parcelSearchContextForGoogleNearby(rows);
    expect(ctx?.filterParcelGeometry.type).toBe("Polygon");
    expect(
      ctx?.filterParcelGeometry.type === "Polygon" &&
        ctx.filterParcelGeometry.coordinates[0]?.length
    ).toBeGreaterThan(4);
  });

  it("filtre sur cadastre seul si polygone présent (tampon Point exclu du filtre)", () => {
    const ring = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
      [0, 0],
    ];
    const rows: ScoutMatchingV5Row[] = [
      { grain: "parcelle", geometry: { type: "Polygon", coordinates: [ring] } } as ScoutMatchingV5Row,
      {
        grain: "parcelle",
        geometry: { type: "Point", coordinates: [0.05, 0.05] },
        footprintSumM2: 400,
      } as ScoutMatchingV5Row,
    ];
    const ctx = parcelSearchContextForGoogleNearby(rows);
    expect(ctx?.filterParcelGeometry.type).toBe("Polygon");
    expect(ctx?.searchExtentGeometry.type).toBe("MultiPolygon");
  });
});

describe("filterGoogleNearbyEntriesInParcel", () => {
  it("exclut les POI hors polygone cadastral", () => {
    const square: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0.001, 0],
          [0.001, 0.001],
          [0, 0.001],
          [0, 0],
        ],
      ],
    };
    const entries = [
      { rank: 0, place_id: "in", name: "Dedans", lat: 0.0005, lng: 0.0005 },
      { rank: 1, place_id: "out", name: "Dehors", lat: 0.01, lng: 0.01 },
    ];
    const filtered = filterGoogleNearbyEntriesInParcel(entries, square);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.place_id).toBe("in");
  });
});

describe("circlePolygonFromCenterRadiusM", () => {
  it("ferme l’anneau", () => {
    const p = circlePolygonFromCenterRadiusM(44.8, -0.6, 100);
    const ring = p.coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});

describe("nearbySearchRadiusMForGeometry", () => {
  it("reste dans une plage raisonnable pour une petite parcelle", () => {
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
    const r = nearbySearchRadiusMForGeometry(g);
    expect(r).toBeGreaterThanOrEqual(80);
    expect(r).toBeLessThanOrEqual(180);
  });
});
