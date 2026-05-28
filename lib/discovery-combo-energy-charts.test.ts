import { describe, expect, it } from "vitest";
import { buildDiscoveryMonthlyChartData } from "@/lib/discovery-combo-energy-charts";

const pvgis = {
  annualProduction: 1200,
  monthlyProduction: Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    production: 100,
  })),
  sunshineHoursEquivalent: 1400,
  optimalInclination: 30,
  optimalAzimuth: 0,
  annualIrradiation: 1500,
  monthlyIrradiation: [],
};

describe("buildDiscoveryMonthlyChartData", () => {
  it("utilise consumptionMonthlyKwh quand fourni (12 mois)", () => {
    const monthly = Array.from({ length: 12 }, () => 1500);
    const data = buildDiscoveryMonthlyChartData({
      pvgis,
      footprintM2: 400,
      kwp: 50,
      placeType: "other",
      consumptionMonthlyKwh: monthly,
    });
    expect(data).toHaveLength(12);
    expect(data.every((d) => d.consumption === 1500)).toBe(true);
  });
});
