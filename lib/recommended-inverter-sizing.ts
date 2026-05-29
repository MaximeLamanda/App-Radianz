import { calculateInverterCount } from "@/lib/solar-settings";
import type { InverterReference } from "@/types";

/** Limite produit : au-delà, badge « Changer de modèle ». */
export const MAX_RECOMMENDED_INVERTER_COUNT = 8;

/**
 * Onduleur recommandé pour un kWp donné : respecte le plafond de nombre d'unités,
 * privilégie le flag catalogue `recommended` s'il convient, sinon le modèle le plus puissant
 * qui minimise le nombre d'onduleurs.
 */
export function pickRecommendedInverterReference(
  totalPowerKW: number,
  visibleInverters: readonly InverterReference[],
  maxInverterCount: number = MAX_RECOMMENDED_INVERTER_COUNT
): InverterReference | null {
  if (!visibleInverters.length) return null;

  if (!Number.isFinite(totalPowerKW) || totalPowerKW <= 0) {
    return visibleInverters.find((r) => r.recommended === true) ?? visibleInverters[0] ?? null;
  }

  const fitting = visibleInverters.filter(
    (inv) => calculateInverterCount(totalPowerKW, inv) <= maxInverterCount
  );
  if (!fitting.length) {
    return visibleInverters[0] ?? null;
  }

  const catalogRecommended = fitting.find((r) => r.recommended === true);
  if (catalogRecommended) return catalogRecommended;

  return fitting.reduce((best, inv) => {
    const count = calculateInverterCount(totalPowerKW, inv);
    const bestCount = calculateInverterCount(totalPowerKW, best);
    if (count < bestCount) return inv;
    if (count > bestCount) return best;
    return inv.powerW > best.powerW ? inv : best;
  });
}
