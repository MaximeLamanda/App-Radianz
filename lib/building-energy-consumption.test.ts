import { describe, expect, it } from "vitest";
import {
  getEnergyConsumption,
  monthlyConsumptionKwhFromAnnualProfile,
} from "./building-energy-consumption";

describe("monthlyConsumptionKwhFromAnnualProfile", () => {
  it("returns twelve zeros when surface or target is invalid", () => {
    expect(monthlyConsumptionKwhFromAnnualProfile("other", 0, 12000)).toEqual(Array(12).fill(0));
    expect(monthlyConsumptionKwhFromAnnualProfile("other", 100, -1)).toEqual(Array(12).fill(0));
  });

  it("sums to rounded target annual kWh for a typical place type", () => {
    const placeType = "other";
    const surface = 200;
    const target = 45_000;
    const monthly = monthlyConsumptionKwhFromAnnualProfile(placeType, surface, target);
    expect(monthly).toHaveLength(12);
    const sum = monthly.reduce((a, b) => a + b, 0);
    expect(sum).toBe(Math.round(target));
  });

  it("preserves relative seasonality (winter months not all equal to summer)", () => {
    const placeType = "other";
    const surface = 300;
    const target = 60_000;
    const monthly = monthlyConsumptionKwhFromAnnualProfile(placeType, surface, target);
    const rawJan = monthly[0] ?? 0;
    const rawJul = monthly[6] ?? 0;
    expect(rawJan).toBeGreaterThan(0);
    expect(rawJul).toBeGreaterThan(0);
    const typeAnnual = getEnergyConsumption(placeType) * surface;
    const shapeJan = monthlyConsumptionKwhFromAnnualProfile(placeType, surface, typeAnnual)[0] ?? 0;
    const shapeJul = monthlyConsumptionKwhFromAnnualProfile(placeType, surface, typeAnnual)[6] ?? 0;
    const ratioShape = shapeJan / shapeJul;
    const ratioScaled = rawJan / rawJul;
    expect(Math.abs(ratioScaled - ratioShape)).toBeLessThan(0.02);
  });
});
