import { describe, expect, it } from "vitest";
import {
  pvgisAzimuthFromFootprintGeometry,
  ringOrientationFromPlanarEastNorthMeters,
} from "@/lib/footprint-orientation-pvgis";

describe("ringOrientationFromPlanarEastNorthMeters", () => {
  it("retourne un azimut pour un rectangle aligné aux axes (m)", () => {
    const ring: Array<[number, number]> = [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
      [0, 0],
    ];
    const az = ringOrientationFromPlanarEastNorthMeters(ring);
    expect(az).not.toBeNull();
    expect(typeof az).toBe("number");
    expect(az!).toBeGreaterThanOrEqual(-180);
    expect(az!).toBeLessThanOrEqual(180);
  });
});

describe("pvgisAzimuthFromFootprintGeometry", () => {
  it("retourne un nombre pour un polygone WGS84 type parcelle test", () => {
    const ringPessac: number[][] = [
      [-0.62, 44.8],
      [-0.61, 44.8],
      [-0.61, 44.81],
      [-0.62, 44.81],
      [-0.62, 44.8],
    ];
    const az = pvgisAzimuthFromFootprintGeometry({ type: "Polygon", coordinates: [ringPessac] });
    expect(az).not.toBeNull();
    expect(az!).toBeGreaterThanOrEqual(-180);
    expect(az!).toBeLessThanOrEqual(180);
  });

  it("retourne null pour géométrie invalide", () => {
    expect(pvgisAzimuthFromFootprintGeometry({ type: "Polygon", coordinates: [[]] })).toBeNull();
  });
});
