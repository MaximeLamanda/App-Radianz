import type { BatteryReference } from "@/types";

/**
 * Choisit modèle × nombre pour approcher une capacité cible (kWh).
 * Même règles que `recommendedBatteryComposition` dans ProspectDrawer.
 */
export function pickRecommendedBatteryComposition(
  targetKwh: number,
  visibleBatteries: BatteryReference[]
): { model: BatteryReference; count: number } | null {
  if (!visibleBatteries.length || !Number.isFinite(targetKwh) || targetKwh <= 0) return null;
  const sortedByCapacity = [...visibleBatteries].sort((a, b) => b.capacityKwh - a.capacityKwh);
  const largestModel = sortedByCapacity[0];
  if (!largestModel) return null;

  if (targetKwh >= largestModel.capacityKwh) {
    const maxPerRack = largestModel.maxBatteriesPerRack ?? 20;
    let bestCount = 1;
    let bestEcart = Math.abs(largestModel.capacityKwh - targetKwh);
    for (let c = 2; c <= maxPerRack; c++) {
      const totalKwh = largestModel.capacityKwh * c;
      const ecart = Math.abs(totalKwh - targetKwh);
      if (ecart < bestEcart) {
        bestEcart = ecart;
        bestCount = c;
      }
    }
    return { model: largestModel, count: bestCount };
  }

  let best: { model: BatteryReference; count: number; ecart: number } | null = null;
  for (const model of visibleBatteries) {
    const maxPerRack = model.maxBatteriesPerRack ?? 20;
    for (let c = 1; c <= maxPerRack; c++) {
      const totalKwh = model.capacityKwh * c;
      const ecart = Math.abs(totalKwh - targetKwh);
      const isBetter =
        best == null ||
        ecart < best.ecart ||
        (ecart === best.ecart && c < best.count) ||
        (ecart === best.ecart && c === best.count && model.capacityKwh > best.model.capacityKwh);
      if (isBetter) best = { model, count: c, ecart };
    }
  }
  return best ? { model: best.model, count: best.count } : null;
}
