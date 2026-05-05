import { describe, expect, it } from "vitest";
import type { InverterReference, PanelReference } from "@/types";
import { computeDiscoveryDrawerFinancialSummary } from "@/lib/discovery-drawer-financial-summary";

const panel: PanelReference = {
  id: "p1",
  name: "Test",
  panelType: "monocrystalline",
  powerW: 400,
  efficiencyPercent: 20,
  countryOfOrigin: "FR",
  costEur: 200,
};

const inverter: InverterReference = {
  id: "i1",
  name: "Inv",
  inverterType: "string_inverter",
  powerW: 10_000,
  efficiencyPercent: 97,
  countryOfOrigin: "FR",
  costEur: 800,
  recommended: true,
  visible: true,
};

describe("computeDiscoveryDrawerFinancialSummary", () => {
  it("retourne prix et break-even quand profils 12 mois et surface > 0", () => {
    const monthly = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      production: 100,
    }));
    const r = computeDiscoveryDrawerFinancialSummary({
      inputs: {
        footprintM2: 500,
        kwp: 50,
        annualPerKwp: 1200,
        monthlyPerKwp: monthly,
      },
      placeType: "other",
      panelRef: panel,
      inverterRef: inverter,
      batteryRef: null,
      batteryCount: 1,
      includeBattery: false,
    });
    expect(r).not.toBeNull();
    expect(r!.priceRange.totalMinEur).toBeGreaterThan(0);
    expect(r!.priceRange.totalMaxEur).toBeGreaterThanOrEqual(r!.priceRange.totalMinEur);
    expect(r!.annualSavings).toBeGreaterThanOrEqual(0);
  });
});
