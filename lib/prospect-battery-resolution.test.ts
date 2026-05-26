import { describe, expect, it } from "vitest";
import type { BatteryReference, Prospect } from "@/types";
import { resolveProspectBatteryRef } from "@/lib/prospect-battery-resolution";

const smallBattery: BatteryReference = {
  id: "battery-luna2000-7-s1",
  name: "LUNA2000-7-S1",
  capacityKwh: 7,
  powerChargeKw: 10.5,
  powerDischargeKw: 10.5,
  roundTripEfficiencyPercent: 90,
  costEur: 4500,
  countryOfOrigin: "Chine",
  recommended: true,
  visible: true,
};

const largeBattery: BatteryReference = {
  id: "battery-luna2000-107-1s11",
  name: "HUAWEI LUNA2000-107-1S11",
  capacityKwh: 107,
  powerChargeKw: 108,
  powerDischargeKw: 108,
  roundTripEfficiencyPercent: 90,
  costEur: 55000,
  countryOfOrigin: "Chine",
  imageUrl: "/AR0797-WS_visual.webp",
  recommended: false,
  visible: true,
  maxBatteriesPerRack: 20,
};

const batteries = [smallBattery, largeBattery];

function discoveryProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    address: "1 rue Test",
    coordinates: { lat: 44.8, lng: -0.6 },
    qualityScore: 80,
    pipelineEntrySource: "discovery_v5",
    bdnbFootprintSumM2: 5000,
    solarPotential: {
      maxArrayPanelsCount: 1000,
      maxArrayAreaMeters2: 5000,
      maxSunshineHoursPerYear: 1400,
      maxKwhPerYear: 1_000_000,
      estimatedKwp: 900,
      productionPerKwpAnnual: 1200,
      productionPerKwpMonthly: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        production: 100,
      })),
    },
    ...overrides,
  };
}

describe("resolveProspectBatteryRef", () => {
  it("Discovery sans batteryReferenceId : composition dimensionnée (gros modèle), pas le recommandé catalogue", () => {
    const { ref } = resolveProspectBatteryRef(discoveryProspect(), batteries);
    expect(ref?.id).toBe("battery-luna2000-107-1s11");
  });

  it("Discovery : batteryReferenceId persisté prime sur la composition dimensionnée", () => {
    const { ref, count } = resolveProspectBatteryRef(
      discoveryProspect({
        batteryReferenceId: "battery-luna2000-7-s1",
        batteryCount: 3,
      }),
      batteries
    );
    expect(ref?.id).toBe("battery-luna2000-7-s1");
    expect(count).toBe(3);
  });

  it("sans composition calculable : retombe sur batteryReferenceId", () => {
    const { ref } = resolveProspectBatteryRef(
      discoveryProspect({
        batteryReferenceId: "battery-luna2000-7-s1",
        solarPotential: undefined,
      }),
      batteries
    );
    expect(ref?.id).toBe("battery-luna2000-7-s1");
  });

  it("hors discovery : batteryReferenceId avant composition", () => {
    const { ref } = resolveProspectBatteryRef(
      discoveryProspect({
        pipelineEntrySource: undefined,
        batteryReferenceId: "battery-luna2000-7-s1",
      }),
      batteries
    );
    expect(ref?.id).toBe("battery-luna2000-7-s1");
  });
});
