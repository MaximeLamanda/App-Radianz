import { describe, expect, it } from "vitest";
import { isValidEnedisGeocodeCoords } from "./enedis-geocode-cache";

describe("isValidEnedisGeocodeCoords", () => {
  it("accepte des coordonnées WGS84 valides", () => {
    expect(isValidEnedisGeocodeCoords(44.8, -0.6)).toBe(true);
  });

  it("rejette lng absent (bug hit.lng vs hit.lon)", () => {
    expect(isValidEnedisGeocodeCoords(44.8, undefined)).toBe(false);
    expect(isValidEnedisGeocodeCoords(44.8, Number.NaN)).toBe(false);
  });
});
