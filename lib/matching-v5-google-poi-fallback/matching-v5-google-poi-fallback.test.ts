import { describe, expect, it, vi } from "vitest";
import { centroidFromGeoJsonPolygonLike } from "./centroid-from-geojson";
import { parseNearbySearchJson } from "./nearby-search";
import { pointInParcelGeometry } from "./point-in-geojson-polygon";
import { rankNearbyPlaces } from "./rank-candidates";
import { runGooglePoiFallback } from "./run-google-poi-fallback";

describe("centroidFromGeoJsonPolygonLike", () => {
  it("retourne le centroïde d’un carré simple", () => {
    const geometry: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    };
    const c = centroidFromGeoJsonPolygonLike(geometry);
    expect(c).not.toBeNull();
    expect(c!.lng).toBeCloseTo(1, 5);
    expect(c!.lat).toBeCloseTo(1, 5);
  });

  it("retourne null pour coordonnées vides", () => {
    const geometry: GeoJSON.Polygon = { type: "Polygon", coordinates: [[]] };
    expect(centroidFromGeoJsonPolygonLike(geometry)).toBeNull();
  });
});

describe("parseNearbySearchJson", () => {
  it("parse OK avec résultats", () => {
    const out = parseNearbySearchJson({
      status: "OK",
      results: [
        {
          place_id: "abc",
          name: "Café",
          types: ["cafe", "establishment"],
          geometry: { location: { lat: 44.8, lng: -0.6 } },
        },
      ],
    });
    expect(out.status).toBe("OK");
    expect(out.results).toHaveLength(1);
    expect(out.results[0].place_id).toBe("abc");
  });

  it("ZERO_RESULTS donne liste vide sans erreur", () => {
    const out = parseNearbySearchJson({ status: "ZERO_RESULTS", results: [] });
    expect(out.results).toHaveLength(0);
  });

  it("REQUEST_DENIED vide les résultats", () => {
    const out = parseNearbySearchJson({
      status: "REQUEST_DENIED",
      error_message: "bad key",
      results: [{ place_id: "x", name: "y" }],
    });
    expect(out.results).toHaveLength(0);
  });
});

describe("pointInParcelGeometry", () => {
  const square: GeoJSON.Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
    ],
  };

  it("point intérieur", () => {
    expect(pointInParcelGeometry(1, 1, square)).toBe(true);
  });

  it("point extérieur", () => {
    expect(pointInParcelGeometry(3, 1, square)).toBe(false);
  });
});

describe("rankNearbyPlaces", () => {
  it("favorise un establishment proche vs route lointaine", () => {
    const centroid = { lat: 44.8, lng: -0.63 };
    const { ranked } = rankNearbyPlaces(
      centroid,
      [
        {
          place_id: "r1",
          name: "Route",
          types: ["route"],
          geometry: { location: { lat: 44.801, lng: -0.631 } },
        },
        {
          place_id: "e1",
          name: "Shop",
          types: ["establishment", "store"],
          geometry: { location: { lat: 44.8005, lng: -0.6305 } },
        },
      ],
      { maxRanked: 10 }
    );
    expect(ranked[0].place_id).toBe("e1");
    expect(ranked[0].insideParcel).toBe(false);
  });

  it("exclut les POI hors polygone parcelle", () => {
    const centroid = { lat: 44.8, lng: -0.63 };
    const parcel: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-0.6306, 44.8004],
          [-0.6300, 44.8004],
          [-0.6300, 44.8006],
          [-0.6306, 44.8006],
          [-0.6306, 44.8004],
        ],
      ],
    };
    const { ranked, excludedOutsideParcel } = rankNearbyPlaces(
      centroid,
      [
        {
          place_id: "out",
          name: "Dehors",
          types: ["store"],
          geometry: { location: { lat: 44.801, lng: -0.631 } },
        },
        {
          place_id: "in",
          name: "Dedans",
          types: ["store"],
          geometry: { location: { lat: 44.8005, lng: -0.6303 } },
        },
      ],
      { maxRanked: 10, parcelGeometry: parcel }
    );
    expect(excludedOutsideParcel).toBe(1);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].place_id).toBe("in");
    expect(ranked[0].insideParcel).toBe(true);
  });
});

describe("runGooglePoiFallback", () => {
  it("refuse une clé vide", async () => {
    const r = await runGooglePoiFallback(44.8, -0.63, { apiKey: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.step).toBe("config");
  });

  it("enchaîne Nearby puis Details avec fetch mocké", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("nearbysearch")) {
        return {
          json: async () => ({
            status: "OK",
            results: [
              {
                place_id: "pid-win",
                name: "Boulangerie X",
                types: ["bakery", "establishment"],
                geometry: { location: { lat: 44.8001, lng: -0.6301 } },
              },
            ],
          }),
        };
      }
      if (url.includes("place/details")) {
        return {
          json: async () => ({
            status: "OK",
            result: {
              place_id: "pid-win",
              name: "Boulangerie X",
              formatted_address: "1 rue Test, 33600 Pessac",
              types: ["bakery", "establishment"],
            },
          }),
        };
      }
      throw new Error("unexpected url " + url);
    }) as unknown as typeof fetch;

    const parcelGeometry: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-0.6315, 44.7998],
          [-0.6298, 44.7998],
          [-0.6298, 44.8003],
          [-0.6315, 44.8003],
          [-0.6315, 44.7998],
        ],
      ],
    };

    const r = await runGooglePoiFallback(44.8, -0.63, {
      apiKey: "test-key",
      radiusM: 100,
      fetchImpl,
      parcelGeometry,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.winner?.formatted_address).toContain("Pessac");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });
});
