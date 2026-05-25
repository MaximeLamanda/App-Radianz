import { describe, expect, it } from "vitest";
import {
  acceptGeoplateformeHitForCommune,
  parseGeoplateformeFeature,
} from "./geoplateforme-geocode";

describe("parseGeoplateformeFeature", () => {
  it("parse un feature GeoJSON valide", () => {
    const hit = parseGeoplateformeFeature({
      properties: {
        label: "12 Rue Test 33000 Bordeaux",
        score: 0.92,
        citycode: "33063",
        type: "housenumber",
        distance: 12,
      },
      geometry: { coordinates: [-0.58, 44.84] },
    });
    expect(hit?.lat).toBe(44.84);
    expect(hit?.lon).toBe(-0.58);
    expect(hit?.score).toBe(0.92);
  });
});

describe("acceptGeoplateformeHitForCommune", () => {
  it("accepte si score et commune OK", () => {
    expect(
      acceptGeoplateformeHitForCommune(
        {
          label: "x",
          score: 0.8,
          distanceM: null,
          citycode: "33318",
          resultType: "street",
          lat: 44.8,
          lon: -0.6,
        },
        "33318",
        0.75
      )
    ).toBe(true);
  });

  it("rejette si citycode différent", () => {
    expect(
      acceptGeoplateformeHitForCommune(
        {
          label: "x",
          score: 0.9,
          distanceM: null,
          citycode: "33063",
          resultType: "street",
          lat: 44.8,
          lon: -0.6,
        },
        "33318",
        0.75
      )
    ).toBe(false);
  });
});
