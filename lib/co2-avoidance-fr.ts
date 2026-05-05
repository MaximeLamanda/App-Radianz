/**
 * Hypothèse CO₂ pour l’électricité réseau (France) — alignée sur l’UI Radianz (≈52 g/kWh).
 */

export const CO2E_GRID_KG_PER_KWH_FR = 0.052;

export function avoidedCo2KgPerYearGridFr(annualProductionKwh: number): number {
  return Math.max(0, annualProductionKwh) * CO2E_GRID_KG_PER_KWH_FR;
}

export function avoidedCo2TonnesPerYearGridFr(annualProductionKwh: number): number {
  return avoidedCo2KgPerYearGridFr(annualProductionKwh) / 1000;
}

/** Même règle que `RadianzCo2AvoidanceRadial` pour afficher pill / radial de façon cohérente. */
export function co2AvoidanceHasDataForDisplay(
  annualProductionKwh: number,
  annualConsumptionKwh: number
): boolean {
  const prod = Math.max(0, annualProductionKwh);
  const conso = Math.max(0, annualConsumptionKwh);
  const avoidedKgYear = prod * CO2E_GRID_KG_PER_KWH_FR;
  return prod > 0 && (conso > 0 || avoidedKgYear > 0);
}
