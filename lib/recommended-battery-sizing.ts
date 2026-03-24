/**
 * Dimensionnement cible batterie (kWh) : préférence pour le surplus PV horaire
 * (injection réseau sans batterie) quand les profils mensuels PVGIS sont disponibles ;
 * sinon repli sur le bilan annuel prod − conso (comportement historique).
 */

import { runProductionSimulation } from "@/lib/battery-simulation";
import { buildTypicalConsumptionDayForMonth } from "@/lib/building-energy-consumption";
import { buildTypicalDayForMonth } from "@/lib/pvgis";

const ROUND_TRIP_EFFICIENCY = 0.9;
const KWH_PER_KWP = 1.25;

export type RecommendedBatterySizingInput = {
  /** Profils mensuels kWh/kWp (PVGIS) ; 12 mois requis pour la voie horaire */
  productionPerKwpMonthly: Array<{ month: number; production: number }> | null | undefined;
  effectiveKwp: number;
  annualProductionKwh: number;
  annualConsumptionKwh: number;
  placeType: string;
  surfaceM2: number;
};

/**
 * @returns kWh cible, ou null si puissance effective nulle / invalide
 */
export function computeRecommendedBatteryTargetKwh(input: RecommendedBatterySizingInput): number | null {
  const {
    productionPerKwpMonthly,
    effectiveKwp,
    annualProductionKwh,
    annualConsumptionKwh,
    placeType,
    surfaceM2,
  } = input;

  if (effectiveKwp <= 0) return null;

  const canUseHourlyProfiles =
    productionPerKwpMonthly != null && productionPerKwpMonthly.length === 12;

  if (canUseHourlyProfiles) {
    const productionTypicalDayByMonth = Array.from({ length: 12 }, (_, m) =>
      buildTypicalDayForMonth(productionPerKwpMonthly!, m, effectiveKwp)
    );
    const consumptionTypicalDayByMonth = Array.from({ length: 12 }, (_, m) =>
      buildTypicalConsumptionDayForMonth(placeType, m, surfaceM2)
    );
    const sim = runProductionSimulation({
      productionTypicalDayByMonth,
      consumptionTypicalDayByMonth,
      battery: null,
    });
    const annualInjectionReseauKwh = sim.injectionReseauKwh;
    if (annualInjectionReseauKwh > 0) {
      const dailySurplusKwh = annualInjectionReseauKwh / 365;
      const capacityKwh = dailySurplusKwh / ROUND_TRIP_EFFICIENCY;
      return Math.round(capacityKwh * 10) / 10;
    }
    return Math.round(Math.max(0, effectiveKwp * KWH_PER_KWP) * 10) / 10;
  }

  const annualSurplusKwh = annualProductionKwh - annualConsumptionKwh;
  if (annualSurplusKwh > 0) {
    const dailySurplusKwh = annualSurplusKwh / 365;
    const capacityKwh = dailySurplusKwh / ROUND_TRIP_EFFICIENCY;
    return Math.round(capacityKwh * 10) / 10;
  }

  return Math.round(Math.max(0, effectiveKwp * KWH_PER_KWP) * 10) / 10;
}
