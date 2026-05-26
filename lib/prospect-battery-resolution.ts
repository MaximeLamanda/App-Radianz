/**
 * Résolution batterie pipeline — choix persisté, puis dimensionnement recommandé, puis défaut catalogue.
 * Aligné sur ProspectDrawer (useEffect usedBatteryRef).
 */

import { getEnergyConsumption } from "@/lib/building-energy-consumption";
import { discoveryFootprintM2FromProspect } from "@/lib/discovery-pipeline-add-financials";
import { pickRecommendedBatteryComposition } from "@/lib/recommended-battery-composition";
import { computeRecommendedBatteryTargetKwh } from "@/lib/recommended-battery-sizing";
import type { BatteryReference, Prospect } from "@/types";

export function pickDefaultBatteryReference(
  batteries: readonly BatteryReference[] | null | undefined
): BatteryReference | null {
  if (!batteries?.length) return null;
  const visible = batteries.filter((b) => b.visible !== false);
  return (
    visible.find((b) => b.recommended === true) ??
    visible[0] ??
    batteries.find((b) => b.recommended === true) ??
    batteries[0] ??
    null
  );
}

function lookupBatteryById(
  batteries: readonly BatteryReference[],
  id: string | undefined
): BatteryReference | null {
  if (!id) return null;
  const visible = batteries.filter((b) => b.visible !== false);
  return visible.find((b) => b.id === id) ?? batteries.find((b) => b.id === id) ?? null;
}

/** Composition dimensionnée depuis `solarPotential` + empreinte (comme discoveryRecommendedBatteryKwh). */
export function recommendedBatteryCompositionFromProspect(
  prospect: Prospect,
  visibleBatteries: readonly BatteryReference[]
): { model: BatteryReference; count: number } | null {
  if (!visibleBatteries.length) return null;

  const footprintM2 = discoveryFootprintM2FromProspect(prospect);
  const sp = prospect.solarPotential;
  const kwp = sp?.estimatedKwp ?? 0;
  const annualPerKwp = sp?.productionPerKwpAnnual;
  const monthly = sp?.productionPerKwpMonthly;
  if (footprintM2 <= 0 || kwp <= 0 || !annualPerKwp || monthly?.length !== 12) return null;

  const placeType = prospect.placeType || "other";
  const annualConsumptionKwh =
    prospect.annualConsumptionKwhOverride ?? getEnergyConsumption(placeType) * footprintM2;
  const annualProductionKwh = Math.round(annualPerKwp * kwp);

  const targetKwh = computeRecommendedBatteryTargetKwh({
    productionPerKwpMonthly: monthly,
    effectiveKwp: kwp,
    annualProductionKwh,
    annualConsumptionKwh,
    placeType,
    surfaceM2: footprintM2,
  });
  if (targetKwh == null) return null;
  return pickRecommendedBatteryComposition(targetKwh, [...visibleBatteries]);
}

export type ResolvedProspectBattery = {
  ref: BatteryReference | null;
  count: number;
};

/**
 * Batterie effective pour un prospect pipeline (vignette table, prix recalculés).
 * Choix utilisateur persisté → dimensionnement recommandé (init) → défaut catalogue.
 * Aligné sur ProspectDrawer (useEffect usedBatteryRef).
 */
export function resolveProspectBatteryRef(
  prospect: Prospect,
  batteries: readonly BatteryReference[] | null | undefined
): ResolvedProspectBattery {
  const all = batteries ?? [];
  const visible = all.filter((b) => b.visible !== false);
  if (!visible.length) return { ref: null, count: 1 };

  const composition = recommendedBatteryCompositionFromProspect(prospect, visible);
  const byId = lookupBatteryById(all, prospect.batteryReferenceId);

  const ref = byId ?? composition?.model ?? pickDefaultBatteryReference(all);
  const countFromProspect =
    prospect.batteryCount != null && prospect.batteryCount >= 1 ? prospect.batteryCount : null;
  const countFromRec =
    composition && ref?.id === composition.model.id ? composition.count : null;
  return { ref, count: countFromProspect ?? countFromRec ?? 1 };
}
