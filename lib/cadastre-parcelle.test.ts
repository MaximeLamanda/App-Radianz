import { describe, expect, it } from "vitest";
import { mergeCadastreFeatureCollections, padNumeroParcelle } from "./cadastre-parcelle";

describe("padNumeroParcelle", () => {
  it("pad sur 4 caractères", () => {
    expect(padNumeroParcelle("17")).toBe("0017");
    expect(padNumeroParcelle("1234")).toBe("1234");
  });
});

describe("mergeCadastreFeatureCollections", () => {
  it("fusionne les features", () => {
    const out = mergeCadastreFeatureCollections([
      {
        features: [
          {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [] },
            properties: { idu: "a" },
          },
        ],
      },
      { features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [] } }] },
    ]);
    expect(out.features).toHaveLength(2);
  });
});
