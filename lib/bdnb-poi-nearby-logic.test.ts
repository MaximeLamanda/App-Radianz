import { describe, expect, it } from "vitest";
import {
  pointInRing,
  ringCentroid,
  sortPlacesLikeClient,
  polygonBBoxDiagonalMeters,
  haversineMeters,
} from "./bdnb-poi-nearby-logic";

describe("haversineMeters", () => {
  it("distance Paris–Lyon ordre de grandeur cohérente (~400 km)", () => {
    const d = haversineMeters(48.8566, 2.3522, 45.764, 4.8357);
    expect(d).toBeGreaterThan(350_000);
    expect(d).toBeLessThan(450_000);
  });
});

describe("pointInRing", () => {
  const square: Array<[number, number]> = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ];

  it("point intérieur", () => {
    expect(pointInRing(0.5, 0.5, square)).toBe(true);
  });

  it("point extérieur", () => {
    expect(pointInRing(2, 2, square)).toBe(false);
  });
});

describe("ringCentroid", () => {
  it("carré unité", () => {
    const r = ringCentroid([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
    expect(r.lat).toBeCloseTo(1, 5);
    expect(r.lng).toBeCloseTo(1, 5);
  });
});

describe("polygonBBoxDiagonalMeters", () => {
  it("petit polygone → rayon de secours minimal", () => {
    const d = polygonBBoxDiagonalMeters([
      [2.35, 48.85],
      [2.351, 48.85],
      [2.351, 48.851],
      [2.35, 48.851],
    ]);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(5000);
  });
});

describe("sortPlacesLikeClient", () => {
  const ring: Array<[number, number]> = [
    [2.0, 48.0],
    [2.01, 48.0],
    [2.01, 48.01],
    [2.0, 48.01],
    [2.0, 48.0],
  ];
  const centroid = { lat: 48.005, lng: 2.005 };

  it("exclut types génériques et sans nom", () => {
    const out = sortPlacesLikeClient(
      [
        { name: "A", types: ["establishment"], geometry: { location: { lat: 48.005, lng: 2.005 } } },
        { name: "B", types: ["street_address"], geometry: { location: { lat: 48.005, lng: 2.005 } } },
        { types: ["establishment"], geometry: { location: { lat: 48.005, lng: 2.005 } } },
      ],
      centroid,
      ring
    );
    expect(out.map((p) => p.name)).toEqual(["A"]);
  });

  it("priorise les POI dans le polygone puis hors", () => {
    const out = sortPlacesLikeClient(
      [
        {
          name: "loin",
          types: ["establishment"],
          geometry: { location: { lat: 48.1, lng: 2.0 } },
        },
        {
          name: "dedans",
          types: ["establishment"],
          geometry: { location: { lat: 48.005, lng: 2.005 } },
        },
      ],
      centroid,
      ring
    );
    expect(out[0]?.name).toBe("dedans");
    expect(out[1]?.name).toBe("loin");
  });
});
