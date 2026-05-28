import { describe, expect, it } from "vitest";
import {
  annualSelfConsumptionKwhTotal,
  avoidedCo2KgPerYearGridFr,
  computeCo2AvoidanceMetricsFr,
  CO2E_GRID_KG_PER_KWH_FR,
} from "./co2-avoidance-fr";

describe("co2-avoidance-fr", () => {
  it("évite le CO₂ uniquement sur l'autoconsommation (facteur réseau FR)", () => {
    const autoconso = 10_000;
    expect(avoidedCo2KgPerYearGridFr(autoconso)).toBe(autoconso * CO2E_GRID_KG_PER_KWH_FR);
  });

  it("calcule le % de réduction vs émissions réseau de la consommation", () => {
    const metrics = computeCo2AvoidanceMetricsFr(20_000, 8_000);
    expect(metrics.baselineKgYear).toBe(20_000 * CO2E_GRID_KG_PER_KWH_FR);
    expect(metrics.avoidedKgYear).toBe(8_000 * CO2E_GRID_KG_PER_KWH_FR);
    expect(metrics.pctReduction).toBe(40);
    expect(metrics.hasData).toBe(true);
  });

  it("plafonne le % à 100 si autoconsommation ≥ consommation", () => {
    const metrics = computeCo2AvoidanceMetricsFr(5_000, 12_000);
    expect(metrics.pctReduction).toBe(100);
  });

  it("somme directe + batterie pour l'autoconsommation", () => {
    expect(annualSelfConsumptionKwhTotal(3_000, 2_000)).toBe(5_000);
    expect(annualSelfConsumptionKwhTotal(-1, 100)).toBe(100);
  });
});
