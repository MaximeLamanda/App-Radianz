/**
 * Résumé financier pipeline pour le drawer Découverte (même logique que `financialSummary` dans ProspectDrawer).
 */

import {
  buildTypicalConsumptionDayForMonth,
  getEnergyConsumption,
  getEnergyConsumptionForMonth,
  type MonthIndex,
} from "@/lib/building-energy-consumption";
import { runProductionSimulation, scaleBatteryForCount } from "@/lib/battery-simulation";
import { buildTypicalDayForMonth } from "@/lib/pvgis";
import {
  calculateInverterCount,
  calculatePanelCount,
  estimateAnnualSavingsEur,
  estimateAnnualSavingsEurWithBattery,
  estimateInstallationPriceEur,
  estimateTotalPriceRangeEur,
  getBreakEvenYears,
} from "@/lib/solar-settings";
import { getUsableRoofAreaM2 } from "@/lib/surface-to-kwp";
import type { BatteryReference, InverterReference, PanelReference } from "@/types";

export type DiscoveryDrawerFinancialInputs = {
  footprintM2: number;
  kwp: number;
  annualPerKwp: number;
  monthlyPerKwp: Array<{ month: number; production: number }>;
};

export type DiscoveryDrawerFinancialSummary = {
  equipmentEur: number;
  priceRange: { totalMinEur: number; totalMaxEur: number };
  annualSavings: number;
  breakEvenMin: number | null;
  breakEvenMax: number | null;
  breakdownFromHourlySim: boolean;
  selfConsumptionDirectKwhTotal: number;
  selfConsumptionViaBatteryKwhTotal: number;
  injectionReseauKwhTotal: number;
  batteryByMonth?: { selfConsumptionDirectKwh: number; selfConsumptionViaBatteryKwh: number; injectionBatteryKwh: number; injectionReseauKwh: number; excessKwh: number; gridDrawKwh: number }[];
};

export function computeDiscoveryDrawerFinancialSummary(params: {
  inputs: DiscoveryDrawerFinancialInputs;
  placeType: string;
  panelRef: PanelReference;
  inverterRef: InverterReference;
  batteryRef: BatteryReference | null;
  batteryCount: number;
  includeBattery: boolean;
  annualConsumptionKwh?: number | null;
}): DiscoveryDrawerFinancialSummary | null {
  const {
    inputs,
    placeType,
    panelRef,
    inverterRef,
    batteryRef,
    batteryCount,
    includeBattery,
    annualConsumptionKwh,
  } = params;
  const { footprintM2: totalArea, kwp: effectiveKwp, annualPerKwp: productionPerKwpAnnual, monthlyPerKwp } =
    inputs;

  if (totalArea <= 0 || effectiveKwp <= 0 || !panelRef || !inverterRef) return null;

  const usableArea = getUsableRoofAreaM2(totalArea);
  const maxPanelCount = calculatePanelCount(usableArea, undefined, panelRef);
  const panelPowerW = panelRef.powerW;
  const panelCount = Math.min(Math.floor((effectiveKwp * 1000) / panelPowerW), maxPanelCount);
  const inverterCount = calculateInverterCount(effectiveKwp, inverterRef);

  const baselineConsumptionKwh =
    totalArea > 0
      ? Array.from({ length: 12 }, (_, m) =>
          Math.round(getEnergyConsumptionForMonth(placeType, m as MonthIndex) * totalArea)
        ).reduce((a, b) => a + b, 0)
      : getEnergyConsumption(placeType) * totalArea;
  const totalConsumptionKwh =
    annualConsumptionKwh != null && Number.isFinite(annualConsumptionKwh) && annualConsumptionKwh >= 0
      ? Math.round(annualConsumptionKwh)
      : baselineConsumptionKwh;
  const consumptionScale =
    baselineConsumptionKwh > 0 ? totalConsumptionKwh / baselineConsumptionKwh : 1;
  const annualProductionKWh = Math.round(productionPerKwpAnnual * effectiveKwp);

  const canUseProfiles = monthlyPerKwp.length === 12;
  let equipmentEur: number;
  let annualSavings: number;
  let breakdownFromHourlySim = false;
  let selfConsumptionDirectKwhTotal = 0;
  let selfConsumptionViaBatteryKwhTotal = 0;
  let injectionReseauKwhTotal = 0;
  let batteryByMonth: DiscoveryDrawerFinancialSummary["batteryByMonth"];

  if (canUseProfiles && annualProductionKWh > 0 && totalConsumptionKwh > 0) {
    breakdownFromHourlySim = true;
    const kwp = effectiveKwp;
    const productionTypicalDayByMonth = Array.from({ length: 12 }, (_, m) =>
      buildTypicalDayForMonth(monthlyPerKwp, m, kwp)
    );
    const consumptionTypicalDayByMonth = Array.from({ length: 12 }, (_, m) =>
      buildTypicalConsumptionDayForMonth(placeType, m, totalArea).map((h) => h * consumptionScale)
    );
    const scaledBattery =
      includeBattery && batteryRef ? scaleBatteryForCount(batteryRef, batteryCount) : null;
    const simulationResult = runProductionSimulation({
      productionTypicalDayByMonth,
      consumptionTypicalDayByMonth,
      battery: scaledBattery,
    });
    annualSavings = estimateAnnualSavingsEurWithBattery(simulationResult);
    equipmentEur = estimateInstallationPriceEur(
      panelCount,
      inverterCount,
      panelRef,
      inverterRef,
      includeBattery && batteryRef ? batteryRef : undefined,
      batteryCount
    );
    selfConsumptionDirectKwhTotal = simulationResult.selfConsumptionDirectKwh;
    selfConsumptionViaBatteryKwhTotal = simulationResult.selfConsumptionViaBatteryKwh;
    injectionReseauKwhTotal = simulationResult.excessKwh;
    batteryByMonth = simulationResult.byMonth;
  } else {
    annualSavings = estimateAnnualSavingsEur(annualProductionKWh, undefined, totalConsumptionKwh);
    equipmentEur = estimateInstallationPriceEur(panelCount, inverterCount, panelRef, inverterRef);
  }

  const priceRange = estimateTotalPriceRangeEur(effectiveKwp, equipmentEur);
  const breakEvenMin = getBreakEvenYears(priceRange.totalMinEur, annualSavings);
  const breakEvenMax = getBreakEvenYears(priceRange.totalMaxEur, annualSavings);

  return {
    equipmentEur,
    priceRange,
    annualSavings,
    breakEvenMin,
    breakEvenMax,
    breakdownFromHourlySim,
    selfConsumptionDirectKwhTotal,
    selfConsumptionViaBatteryKwhTotal,
    injectionReseauKwhTotal,
    batteryByMonth,
  };
}
