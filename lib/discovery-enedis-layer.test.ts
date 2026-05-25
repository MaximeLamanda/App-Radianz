import { describe, expect, it } from "vitest";
import {
  DISCOVERY_ENEDIS_API_MAX_LIMIT,
  isDiscoveryEnedisMwhFilterDisabled,
  isDiscoveryEnedisYear,
  parseDiscoveryEnedisApiLimit,
  pointInMapBounds,
} from "./discovery-enedis-layer";

describe("parseDiscoveryEnedisApiLimit", () => {
  it("utilise le plafond API si limit absent (pas Number(null) → 0)", () => {
    expect(parseDiscoveryEnedisApiLimit(null)).toBe(DISCOVERY_ENEDIS_API_MAX_LIMIT);
    expect(parseDiscoveryEnedisApiLimit("")).toBe(DISCOVERY_ENEDIS_API_MAX_LIMIT);
  });

  it("borne et tronque la valeur demandée", () => {
    expect(parseDiscoveryEnedisApiLimit("500")).toBe(500);
    expect(parseDiscoveryEnedisApiLimit("0")).toBe(1);
    expect(parseDiscoveryEnedisApiLimit("999999")).toBe(DISCOVERY_ENEDIS_API_MAX_LIMIT);
  });
});

describe("isDiscoveryEnedisMwhFilterDisabled", () => {
  it("désactivé aux bornes par défaut", () => {
    expect(isDiscoveryEnedisMwhFilterDisabled(0, 10_000)).toBe(true);
  });
});

describe("isDiscoveryEnedisYear", () => {
  it("valide les années connues", () => {
    expect(isDiscoveryEnedisYear("2024")).toBe(true);
    expect(isDiscoveryEnedisYear("1999")).toBe(false);
  });
});

describe("pointInMapBounds", () => {
  it("détecte un point dans la bbox", () => {
    expect(
      pointInMapBounds(44.8, -0.6, {
        sw: { lat: 44.7, lng: -0.7 },
        ne: { lat: 44.9, lng: -0.5 },
      })
    ).toBe(true);
  });
});
