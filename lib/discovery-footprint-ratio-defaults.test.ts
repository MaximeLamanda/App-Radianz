import { describe, expect, it } from "vitest";
import {
  discoveryFootprintRatioHiEffective,
  discoveryFootprintRatioPctToUnit,
  discoveryFootprintRatioRangeForApi,
  isDiscoveryFootprintRatioFilterDisabled,
} from "./discovery-footprint-ratio-defaults";

describe("discoveryFootprintRatioRangeForApi", () => {
  it("renvoie 0–100 % quand le filtre est désactivé", () => {
    expect(discoveryFootprintRatioRangeForApi(false, { min: 30, max: 70 })).toEqual({
      min: 0,
      max: 100,
    });
  });
});

describe("discoveryFootprintRatioPctToUnit", () => {
  it("convertit les pourcentages en ratio", () => {
    expect(discoveryFootprintRatioPctToUnit(50)).toBe(0.5);
    expect(discoveryFootprintRatioPctToUnit(100)).toBe(1);
  });
});

describe("isDiscoveryFootprintRatioFilterDisabled", () => {
  it("considère 0–100 % comme désactivé", () => {
    expect(isDiscoveryFootprintRatioFilterDisabled(0, 100)).toBe(true);
    expect(isDiscoveryFootprintRatioFilterDisabled(0, 80)).toBe(false);
  });
});

describe("discoveryFootprintRatioHiEffective", () => {
  it("ouvre la borne haute à 100 %", () => {
    expect(discoveryFootprintRatioHiEffective(100)).toBe(Number.POSITIVE_INFINITY);
  });
});
