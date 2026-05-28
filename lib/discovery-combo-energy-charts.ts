/**
 * Données mensuelles prod·conso Discovery — même surface et kWp que le dimensionnement.
 */

import { getEnergyConsumptionForMonth, type MonthIndex } from "@/lib/building-energy-consumption";
import type { DiscoveryDrawerFinancialSummary } from "@/lib/discovery-drawer-financial-summary";
import { getProductionFromPerKwp, type PVGISData } from "@/lib/pvgis";
import type { MonthlyProductionChartDatum } from "@/components/solar-scout/MonthlyProductionChart";

export function buildDiscoveryMonthlyChartData(params: {
  pvgis: PVGISData;
  footprintM2: number;
  kwp: number;
  placeType: string;
  batteryByMonth?: DiscoveryDrawerFinancialSummary["batteryByMonth"];
  /** kWh par mois (jan→déc) ; sinon profil type × empreinte. */
  consumptionMonthlyKwh?: number[];
}): MonthlyProductionChartDatum[] {
  const { pvgis, footprintM2, kwp, placeType, batteryByMonth, consumptionMonthlyKwh } = params;
  if (footprintM2 <= 0 || kwp <= 0 || pvgis.annualProduction <= 0) return [];

  const { monthlyProduction } = getProductionFromPerKwp(
    pvgis.annualProduction,
    pvgis.monthlyProduction,
    kwp
  );

  return monthlyProduction.map((m) => {
    const mi = m.month - 1;
    const consumption =
      consumptionMonthlyKwh?.length === 12
        ? Math.round(consumptionMonthlyKwh[mi] ?? 0)
        : Math.round(
            getEnergyConsumptionForMonth(placeType, mi as MonthIndex) * footprintM2
          );
    const base = { month: m.month, production: m.production, consumption };
    const b = batteryByMonth?.[m.month - 1];
    if (b) {
      return {
        ...base,
        selfConsumptionDirect: b.selfConsumptionDirectKwh,
        selfConsumptionViaBattery: b.selfConsumptionViaBatteryKwh,
        injectionBattery: b.injectionBatteryKwh,
        excess: b.injectionReseauKwh,
        gridDraw: b.gridDrawKwh,
      };
    }
    return base;
  });
}
