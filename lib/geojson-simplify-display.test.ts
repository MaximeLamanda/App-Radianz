import { describe, expect, it } from "vitest";
import {
  simplifyFeatureCollectionForMapDisplay,
  toleranceDegForParcelHighlightZoom,
} from "@/lib/geojson-simplify-display";

describe("toleranceDegForParcelHighlightZoom", () => {
  it("est nul à zoom fort", () => {
    expect(toleranceDegForParcelHighlightZoom(18)).toBe(0);
  });

  it("est positif à zoom modéré", () => {
    expect(toleranceDegForParcelHighlightZoom(12)).toBeGreaterThan(0);
  });
});

describe("simplifyFeatureCollectionForMapDisplay", () => {
  it("retourne la même référence si tolérance 0", () => {
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ],
            ],
          },
        },
      ],
    };
    expect(simplifyFeatureCollectionForMapDisplay(fc, 0)).toBe(fc);
  });

  it("réduit le nombre de sommets avec une forte tolérance", () => {
    const ring: GeoJSON.Position[] = [
      [0, 0],
      [0.0000001, 0],
      [0.0000002, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ];
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [ring] },
        },
      ],
    };
    const out = simplifyFeatureCollectionForMapDisplay(fc, 0.5);
    const g = out.features[0]!.geometry;
    expect(g.type).toBe("Polygon");
    if (g.type === "Polygon") {
      expect(g.coordinates[0]!.length).toBeLessThan(ring.length);
    }
  });
});
