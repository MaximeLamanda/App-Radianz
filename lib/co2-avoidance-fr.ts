/**
 * Hypothèse CO₂ pour l’électricité réseau classique (France) — alignée sur l’UI Radianz (≈52 g/kWh).
 * L’autoconsommation (directe + via batterie) remplace du réseau : c’est de l’énergie verte ;
 * l’injection ne réduit pas les émissions liées à la consommation du site.
 */

export const CO2E_GRID_KG_PER_KWH_FR = 0.052;

export function annualSelfConsumptionKwhTotal(
  directKwh: number,
  viaBatteryKwh: number
): number {
  return Math.max(0, directKwh) + Math.max(0, viaBatteryKwh);
}

export interface Co2AvoidanceMetricsFr {
  /** Émissions si 100 % de la consommation venait du réseau (kg CO₂e/an). */
  baselineKgYear: number;
  /** Émissions évitées grâce à l’autoconsommation (kg CO₂e/an). */
  avoidedKgYear: number;
  /** Part des émissions « réseau » de la consommation évitée (%). */
  pctReduction: number;
  hasData: boolean;
}

export function computeCo2AvoidanceMetricsFr(
  annualConsumptionKwh: number,
  annualSelfConsumptionKwh: number
): Co2AvoidanceMetricsFr {
  const conso = Math.max(0, annualConsumptionKwh);
  const autoconso = Math.max(0, annualSelfConsumptionKwh);
  const baselineKgYear = conso * CO2E_GRID_KG_PER_KWH_FR;
  const avoidedKgYear = autoconso * CO2E_GRID_KG_PER_KWH_FR;
  const pctReduction =
    baselineKgYear > 0
      ? Math.min(100, (avoidedKgYear / baselineKgYear) * 100)
      : avoidedKgYear > 0
        ? 100
        : 0;
  const hasData = conso > 0 && autoconso > 0;
  return { baselineKgYear, avoidedKgYear, pctReduction, hasData };
}

/** CO₂ évité (kg/an) = autoconsommation × facteur réseau FR. */
export function avoidedCo2KgPerYearGridFr(annualSelfConsumptionKwh: number): number {
  return Math.max(0, annualSelfConsumptionKwh) * CO2E_GRID_KG_PER_KWH_FR;
}

export function avoidedCo2TonnesPerYearGridFr(annualSelfConsumptionKwh: number): number {
  return avoidedCo2KgPerYearGridFr(annualSelfConsumptionKwh) / 1000;
}

/** Même règle que `RadianzCo2AvoidanceRadial` pour afficher pill / radial de façon cohérente. */
export function co2AvoidanceHasDataForDisplay(
  annualConsumptionKwh: number,
  annualSelfConsumptionKwh: number
): boolean {
  return computeCo2AvoidanceMetricsFr(annualConsumptionKwh, annualSelfConsumptionKwh).hasData;
}
