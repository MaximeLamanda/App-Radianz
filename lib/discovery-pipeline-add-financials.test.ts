import { describe, expect, it } from "vitest";
import type { InverterReference, PanelReference, Prospect } from "@/types";
import {
  buildDiscoveryPipelineFinanceInputs,
  computeDiscoveryChoiceCardsConfig,
  computeDiscoveryKwpEstForPipeline,
  computeDiscoveryPipelineFinancialSummaryAtAdd,
  discoveryFootprintM2FromProspect,
  pickDefaultPanelReference,
  resolveDiscoveryProspectPipelineFinancials,
  resolveDiscoveryPipelineEnergyDisplay,
  discoveryAnnualConsumptionKwhFromProfile,
  discoveryConsumptionOverrideForProspect,
  resolveDiscoveryAnnualConsumptionKwh,
} from "@/lib/discovery-pipeline-add-financials";

const panel: PanelReference = {
  id: "p1",
  name: "Test",
  panelType: "monocrystalline",
  powerW: 400,
  efficiencyPercent: 20,
  countryOfOrigin: "FR",
  costEur: 200,
  recommended: true,
  visible: true,
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

describe("pickDefaultPanelReference", () => {
  it("prend le panneau visible recommandé ou le premier visible", () => {
    expect(pickDefaultPanelReference([{ ...panel, recommended: false, visible: true }])).toMatchObject({
      id: "p1",
    });
    expect(pickDefaultPanelReference([panel])).toMatchObject({ id: "p1" });
  });
});

describe("computeDiscoveryChoiceCardsConfig", () => {
  it("perfect fit kWp ≤ highest production kWp", () => {
    const cfg = computeDiscoveryChoiceCardsConfig({
      footprintM2: 1000,
      pvgisAnnualPerKwp: pvgis.annualProduction,
      panelRef: panel,
      inverterRef: inverter,
    });
    expect(cfg.perfectFit.kwp).toBeGreaterThan(0);
    expect(cfg.highestProduction.kwp).toBeGreaterThanOrEqual(cfg.perfectFit.kwp);
  });
});

describe("computeDiscoveryKwpEstForPipeline", () => {
  it("retourne un kWp > 0 pour une empreinte partielle de combo", () => {
    const kwp = computeDiscoveryKwpEstForPipeline({
      footprintM2: 450,
      pvgisAnnualPerKwp: pvgis.annualProduction,
      panelRef: panel,
    });
    expect(kwp).toBeGreaterThan(0);
  });

  it("augmente le kWp perfect fit quand la conso annuelle est doublée", () => {
    const footprintM2 = 500;
    const baseline = discoveryAnnualConsumptionKwhFromProfile("other", footprintM2);
    const kwpBaseline = computeDiscoveryKwpEstForPipeline({
      footprintM2,
      pvgisAnnualPerKwp: pvgis.annualProduction,
      panelRef: panel,
      placeType: "other",
    });
    const kwpDoubled = computeDiscoveryKwpEstForPipeline({
      footprintM2,
      pvgisAnnualPerKwp: pvgis.annualProduction,
      panelRef: panel,
      placeType: "other",
      annualConsumptionKwh: baseline * 2,
    });
    expect(kwpDoubled).toBeGreaterThan(kwpBaseline);
  });
});

describe("resolveDiscoveryAnnualConsumptionKwh", () => {
  it("accepte un override à 0 kWh", () => {
    const footprintM2 = 400;
    const baseline = discoveryAnnualConsumptionKwhFromProfile("other", footprintM2);
    expect(baseline).toBeGreaterThan(0);
    expect(
      resolveDiscoveryAnnualConsumptionKwh({
        placeType: "other",
        footprintM2,
        annualConsumptionKwh: 0,
      })
    ).toBe(0);
  });
});

describe("discoveryConsumptionOverrideForProspect", () => {
  it("persiste 0 quand différent de la baseline", () => {
    expect(discoveryConsumptionOverrideForProspect(0, 50_000)).toBe(0);
    expect(discoveryConsumptionOverrideForProspect(50_000, 50_000)).toBeUndefined();
  });
});

describe("computeDiscoveryPipelineFinancialSummaryAtAdd", () => {
  it("calcule prix et break-even sans state drawer", () => {
    const summary = computeDiscoveryPipelineFinancialSummaryAtAdd({
      footprintM2: 450,
      pvgis,
      panelRef: panel,
      inverterRef: inverter,
      includeBattery: false,
    });
    expect(summary).not.toBeNull();
    expect(summary!.priceRange.totalMinEur).toBeGreaterThan(0);
    expect(summary!.priceRange.totalMaxEur).toBeGreaterThanOrEqual(summary!.priceRange.totalMinEur);
  });

  it("retourne null si PVGIS absent", () => {
    expect(
      computeDiscoveryPipelineFinancialSummaryAtAdd({
        footprintM2: 450,
        pvgis: null,
        panelRef: panel,
        inverterRef: inverter,
      })
    ).toBeNull();
  });
});

describe("buildDiscoveryPipelineFinanceInputs", () => {
  it("retourne null si surface nulle", () => {
    expect(
      buildDiscoveryPipelineFinanceInputs({ footprintM2: 0, kwp: 10, pvgis })
    ).toBeNull();
  });
});

describe("resolveDiscoveryProspectPipelineFinancials", () => {
  it("recalcule depuis solarPotential quand prix absent en Firestore", () => {
    const prospect: Prospect = {
      address: "1 rue Test",
      coordinates: { lat: 44.8, lng: -0.6 },
      placeType: "other",
      qualityScore: 80,
      pipelineEntrySource: "discovery_v5",
      bdnbFootprintSumM2: 420,
      solarPotential: {
        maxArrayPanelsCount: 0,
        maxSunshineHoursPerYear: 1400,
        maxArrayAreaMeters2: 420,
        maxKwhPerYear: 50_000,
        estimatedKwp: 84,
        productionPerKwpAnnual: 1200,
        productionPerKwpMonthly: pvgis.monthlyProduction,
      },
    };
    const fin = resolveDiscoveryProspectPipelineFinancials(prospect, panel, inverter, {
      includeBattery: false,
    });
    expect(fin).not.toBeNull();
    expect(fin!.priceRangeMinEur).toBeGreaterThan(0);
  });

  it("utilise les valeurs stockées si présentes", () => {
    const prospect: Prospect = {
      address: "1 rue Test",
      coordinates: { lat: 44.8, lng: -0.6 },
      placeType: "other",
      qualityScore: 80,
      priceRangeMinEur: 80_000,
      priceRangeMaxEur: 95_000,
      breakEvenMinYears: 6,
      breakEvenMaxYears: 8,
    };
    const fin = resolveDiscoveryProspectPipelineFinancials(prospect, panel, inverter);
    expect(fin).toEqual({
      priceRangeMinEur: 80_000,
      priceRangeMaxEur: 95_000,
      breakEvenMinYears: 6,
      breakEvenMaxYears: 8,
    });
  });
});

describe("resolveDiscoveryPipelineEnergyDisplay", () => {
  it("recalcule la prod. depuis estimatedKwp et pas un maxKwhPerYear obsolète", () => {
    const footprintM2 = 1000;
    const kwpPerfectFit = computeDiscoveryKwpEstForPipeline({
      footprintM2,
      pvgisAnnualPerKwp: pvgis.annualProduction,
      panelRef: panel,
    });
    const prospect: Prospect = {
      address: "1 rue Test",
      coordinates: { lat: 44.8, lng: -0.6 },
      placeType: "other",
      qualityScore: 80,
      pipelineEntrySource: "discovery_v5",
      bdnbFootprintSumM2: footprintM2,
      solarPotential: {
        maxArrayPanelsCount: 0,
        maxSunshineHoursPerYear: 1400,
        maxArrayAreaMeters2: footprintM2,
        maxKwhPerYear: 1_200_000,
        estimatedKwp: kwpPerfectFit,
        productionPerKwpAnnual: pvgis.annualProduction,
        productionPerKwpMonthly: pvgis.monthlyProduction,
      },
    };
    const display = resolveDiscoveryPipelineEnergyDisplay(prospect);
    const conso = discoveryAnnualConsumptionKwhFromProfile("other", footprintM2);
    expect(display.consumptionKwh).toBe(conso);
    expect(display.productionKwh).toBeLessThan(conso);
    const expectedProd = pvgis.monthlyProduction.reduce(
      (sum, m) => sum + Math.round(m.production * kwpPerfectFit),
      0
    );
    expect(display.productionKwh).toBe(expectedProd);
    expect(display.productionKwh).not.toBe(1_200_000);
  });
});

describe("discoveryFootprintM2FromProspect", () => {
  it("préfère bdnbFootprintSumM2", () => {
    expect(
      discoveryFootprintM2FromProspect({
        address: "x",
        coordinates: { lat: 0, lng: 0 },
        placeType: "other",
        qualityScore: 1,
        bdnbFootprintSumM2: 333,
        roofSurfaces: [{ id: "r", area: 100, polygon: [] }],
      })
    ).toBe(333);
  });
});
