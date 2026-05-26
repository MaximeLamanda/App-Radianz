/**
 * Calcul prix / break-even au moment de l’ajout pipeline Discovery
 * (ne dépend pas du state React du drawer).
 */

import {
  getEnergyConsumption,
  getEnergyConsumptionForMonth,
  type MonthIndex,
} from "@/lib/building-energy-consumption";
import { getProductionFromPerKwp } from "@/lib/pvgis";
import {
  computeDiscoveryDrawerFinancialSummary,
  type DiscoveryDrawerFinancialInputs,
  type DiscoveryDrawerFinancialSummary,
} from "@/lib/discovery-drawer-financial-summary";
import type { PVGISData } from "@/lib/pvgis";
import {
  calculateInverterCount,
  calculatePanelCount,
  getRecommendedInverterReferenceSync,
  getRecommendedPanelReferenceSync,
} from "@/lib/solar-settings";
import { getUsableRoofAreaM2, surfaceToKwp } from "@/lib/surface-to-kwp";
import type {
  BatteryReference,
  InverterReference,
  PanelReference,
  Prospect,
  SolarPotential,
} from "@/types";

/** Conso annuelle = Σ 12 mois (profil mensuel × empreinte) — aligné graphe Discovery. */
export function discoveryAnnualConsumptionKwhFromProfile(
  placeType: string,
  footprintM2: number
): number {
  if (footprintM2 <= 0) return 0;
  return Array.from({ length: 12 }, (_, m) =>
    Math.round(getEnergyConsumptionForMonth(placeType, m as MonthIndex) * footprintM2)
  ).reduce((a, b) => a + b, 0);
}

/**
 * Production annuelle affichée = Σ des 12 mois arrondis (identique au graphe et au bandeau MWh/an).
 * Diffère légèrement de `round(annuel × kWp)` — on privilégie la cohérence visuelle des barres.
 */
export function discoveryAnnualProductionKwhFromPvgisKwp(
  annualPerKwp: number,
  monthlyPerKwp: Array<{ month: number; production: number }>,
  kwp: number
): number {
  if (annualPerKwp <= 0 || kwp <= 0 || monthlyPerKwp.length !== 12) return 0;
  const { monthlyProduction } = getProductionFromPerKwp(annualPerKwp, monthlyPerKwp, kwp);
  return monthlyProduction.reduce((sum, m) => sum + m.production, 0);
}

/** Production annuelle pour le kWp stocké — aligné graphe Discovery / table pipeline. */
export function discoveryAnnualProductionKwhForKwp(
  sp: SolarPotential | undefined,
  kwp: number
): number {
  if (!sp || kwp <= 0) return 0;
  const perKwp = sp.productionPerKwpAnnual;
  const perKwpMonthly = sp.productionPerKwpMonthly;
  if (perKwp != null && perKwp > 0 && perKwpMonthly?.length === 12) {
    return discoveryAnnualProductionKwhFromPvgisKwp(perKwp, perKwpMonthly, kwp);
  }
  if (sp.monthlyProduction?.length === 12) {
    return sp.monthlyProduction.reduce((s, m) => s + (m.production ?? 0), 0);
  }
  if (sp.maxKwhPerYear != null && sp.maxKwhPerYear > 0) return sp.maxKwhPerYear;
  if (perKwp != null && perKwp > 0) return Math.round(perKwp * kwp);
  return 0;
}

/** Prod. / conso. affichées dans la table pipeline (page d’accueil). */
export function resolveDiscoveryPipelineEnergyDisplay(prospect: Prospect): {
  footprintM2: number;
  kwp: number;
  productionKwh: number;
  consumptionKwh: number;
} {
  const footprintM2 = discoveryFootprintM2FromProspect(prospect);
  const placeType = prospect.placeType || "other";
  const kwp = prospect.solarPotential?.estimatedKwp ?? 0;
  const consumptionKwh =
    prospect.annualConsumptionKwhOverride ??
    discoveryAnnualConsumptionKwhFromProfile(placeType, footprintM2);
  const productionKwh = discoveryAnnualProductionKwhForKwp(prospect.solarPotential, kwp);
  return { footprintM2, kwp, productionKwh, consumptionKwh };
}

export function pickDefaultPanelReference(
  panels: readonly PanelReference[] | null | undefined
): PanelReference | null {
  if (!panels?.length) return null;
  const visible = panels.filter((p) => p.visible !== false);
  return (
    visible.find((p) => p.recommended === true) ??
    visible[0] ??
    panels.find((p) => p.recommended === true) ??
    panels[0] ??
    null
  );
}

export function pickDefaultInverterReference(
  inverters: readonly InverterReference[] | null | undefined
): InverterReference | null {
  if (!inverters?.length) return null;
  const visible = inverters.filter((i) => i.visible !== false);
  return (
    visible.find((i) => i.recommended === true) ??
    visible[0] ??
    inverters.find((i) => i.recommended === true) ??
    inverters[0] ??
    null
  );
}

/** Empreinte toit Discovery persistée ou dérivée du prospect. */
export function discoveryFootprintM2FromProspect(prospect: Prospect): number {
  if (prospect.bdnbFootprintSumM2 != null && prospect.bdnbFootprintSumM2 > 0) {
    return prospect.bdnbFootprintSumM2;
  }
  const fromRoof = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? 0;
  if (fromRoof > 0) return fromRoof;
  if (prospect.roofSurface?.area != null && prospect.roofSurface.area > 0) {
    return prospect.roofSurface.area;
  }
  return prospect.solarPotential?.maxArrayAreaMeters2 ?? 0;
}

export type DiscoveryProspectPipelineFinancials = {
  priceRangeMinEur: number;
  priceRangeMaxEur: number;
  breakEvenMinYears: number | null;
  breakEvenMaxYears: number | null;
};

/**
 * Prix / B-E stockés sur le prospect, ou recalcul depuis `solarPotential` + empreinte.
 * Utilisé par la table pipeline quand Firestore n’a pas les champs (ajouts antérieurs ou échec drawer).
 */
export function resolveDiscoveryProspectPipelineFinancials(
  prospect: Prospect,
  panelRef: PanelReference | null,
  inverterRef: InverterReference | null,
  options?: {
    includeBattery?: boolean;
    batteryRef?: BatteryReference | null;
    batteryCount?: number;
  }
): DiscoveryProspectPipelineFinancials | null {
  const storedMin = prospect.priceRangeMinEur;
  const storedMax = prospect.priceRangeMaxEur;
  if (storedMin != null && storedMax != null) {
    return {
      priceRangeMinEur: storedMin,
      priceRangeMaxEur: storedMax,
      breakEvenMinYears: prospect.breakEvenMinYears ?? null,
      breakEvenMaxYears: prospect.breakEvenMaxYears ?? null,
    };
  }

  if (!panelRef || !inverterRef) return null;

  const footprintM2 = discoveryFootprintM2FromProspect(prospect);
  const sp = prospect.solarPotential;
  const annualPerKwp = sp?.productionPerKwpAnnual;
  if (footprintM2 <= 0 || !annualPerKwp || annualPerKwp <= 0) return null;

  const monthlyPerKwp =
    sp?.productionPerKwpMonthly?.length === 12
      ? sp.productionPerKwpMonthly.map((m) => ({
          month: m.month,
          production: m.production,
        }))
      : Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          production: annualPerKwp / 12,
        }));

  const kwp =
    sp?.estimatedKwp != null && sp.estimatedKwp > 0
      ? sp.estimatedKwp
      : computeDiscoveryKwpEstForPipeline({
          footprintM2,
          pvgisAnnualPerKwp: annualPerKwp,
          panelRef,
          placeType: prospect.placeType || "other",
        });

  const inputs = buildDiscoveryPipelineFinanceInputs({
    footprintM2,
    kwp,
    pvgis: {
      annualProduction: annualPerKwp,
      monthlyProduction: monthlyPerKwp,
      sunshineHoursEquivalent: sp?.maxSunshineHoursPerYear ?? 0,
      optimalInclination: sp?.optimalInclination ?? 30,
      optimalAzimuth: sp?.optimalAzimuth ?? 0,
      annualIrradiation: sp?.annualIrradiation ?? 0,
      monthlyIrradiation: sp?.monthlyIrradiation ?? [],
    },
  });
  if (!inputs) return null;

  const summary = computeDiscoveryDrawerFinancialSummary({
    inputs,
    placeType: prospect.placeType || "other",
    panelRef,
    inverterRef,
    batteryRef: options?.includeBattery ? options?.batteryRef ?? null : null,
    batteryCount: Math.max(1, options?.batteryCount ?? 1),
    includeBattery: options?.includeBattery ?? false,
  });
  if (!summary) return null;

  return {
    priceRangeMinEur: summary.priceRange.totalMinEur,
    priceRangeMaxEur: summary.priceRange.totalMaxEur,
    breakEvenMinYears: summary.breakEvenMin,
    breakEvenMaxYears: summary.breakEvenMax,
  };
}

const DISCOVERY_PERFECT_FIT_SELF_CONSUMPTION_TARGET = 0.7;

export type DiscoveryChoiceCardsConfig = {
  perfectFit: { panelCount: number; inverterCount: number; kwp: number };
  highestProduction: { panelCount: number; inverterCount: number; kwp: number };
};

/** Cartes Perfect fit / Highest production — aligné drawer prospect et page /p/. */
export function computeDiscoveryChoiceCardsConfig(params: {
  footprintM2: number;
  pvgisAnnualPerKwp: number;
  panelRef: PanelReference | null;
  inverterRef: InverterReference | null;
  placeType?: string;
}): DiscoveryChoiceCardsConfig {
  const { footprintM2, pvgisAnnualPerKwp, panelRef, inverterRef, placeType = "other" } = params;
  const empty = { panelCount: 0, inverterCount: 0, kwp: 0 };
  if (footprintM2 <= 0 || !panelRef || !inverterRef || pvgisAnnualPerKwp <= 0) {
    return { perfectFit: empty, highestProduction: empty };
  }

  const fullKwp = surfaceToKwp(footprintM2, undefined, undefined, panelRef);
  const perfectKwp = computeDiscoveryKwpEstForPipeline({
    footprintM2,
    pvgisAnnualPerKwp,
    panelRef,
    placeType,
  });
  const usableArea = getUsableRoofAreaM2(footprintM2);
  const maxPanelCount = calculatePanelCount(usableArea, undefined, panelRef);
  const panelCountFromKwp = (kwp: number) =>
    Math.min(Math.floor((kwp * 1000) / panelRef.powerW), maxPanelCount);

  return {
    perfectFit: {
      kwp: perfectKwp,
      panelCount: panelCountFromKwp(perfectKwp),
      inverterCount: calculateInverterCount(perfectKwp, inverterRef),
    },
    highestProduction: {
      kwp: fullKwp,
      panelCount: panelCountFromKwp(fullKwp),
      inverterCount: calculateInverterCount(fullKwp, inverterRef),
    },
  };
}

/** kWp « Perfect fit » plafonné au toit — aligné `ProspectDrawerDiscoverySection.kwpEst`. */
export function computeDiscoveryKwpEstForPipeline(params: {
  footprintM2: number;
  pvgisAnnualPerKwp: number;
  panelRef?: PanelReference | null;
  placeType?: string;
}): number {
  const { footprintM2, pvgisAnnualPerKwp, panelRef, placeType = "other" } = params;
  const kwpMax = surfaceToKwp(footprintM2, undefined, undefined, panelRef ?? null);
  if (kwpMax <= 0) return 0;
  if (pvgisAnnualPerKwp <= 0) return kwpMax;
  const consoAnnuelleKwh = discoveryAnnualConsumptionKwhFromProfile(placeType, footprintM2);
  const targetKwp =
    (consoAnnuelleKwh * DISCOVERY_PERFECT_FIT_SELF_CONSUMPTION_TARGET) / pvgisAnnualPerKwp;
  if (!Number.isFinite(targetKwp) || targetKwp <= 0) return kwpMax;
  return Math.round(Math.min(targetKwp, kwpMax) * 100) / 100;
}

export function buildDiscoveryPipelineFinanceInputs(params: {
  footprintM2: number;
  kwp: number;
  pvgis: PVGISData;
}): DiscoveryDrawerFinancialInputs | null {
  const { footprintM2, kwp, pvgis } = params;
  if (footprintM2 <= 0 || kwp <= 0 || pvgis.annualProduction <= 0) return null;
  return {
    footprintM2,
    kwp,
    annualPerKwp: pvgis.annualProduction,
    monthlyPerKwp: pvgis.monthlyProduction.map((m) => ({
      month: m.month,
      production: m.production,
    })),
  };
}

export function computeDiscoveryPipelineFinancialSummaryAtAdd(params: {
  footprintM2: number;
  pvgis: PVGISData | null;
  panelRef?: PanelReference | null;
  inverterRef?: InverterReference | null;
  batteryRef?: BatteryReference | null;
  batteryCount?: number;
  includeBattery?: boolean;
  placeType?: string;
}): DiscoveryDrawerFinancialSummary | null {
  const {
    footprintM2,
    pvgis,
    panelRef = getRecommendedPanelReferenceSync(),
    inverterRef = getRecommendedInverterReferenceSync(),
    batteryRef = null,
    batteryCount = 1,
    includeBattery = true,
    placeType = "other",
  } = params;

  if (!pvgis || footprintM2 <= 0) return null;
  const panel = panelRef ?? getRecommendedPanelReferenceSync();
  const inverter = inverterRef ?? getRecommendedInverterReferenceSync();
  if (!panel || !inverter) return null;

  const kwp = computeDiscoveryKwpEstForPipeline({
    footprintM2,
    pvgisAnnualPerKwp: pvgis.annualProduction,
    panelRef: panel,
    placeType,
  });
  const inputs = buildDiscoveryPipelineFinanceInputs({ footprintM2, kwp, pvgis });
  if (!inputs) return null;

  return computeDiscoveryDrawerFinancialSummary({
    inputs,
    placeType,
    panelRef: panel,
    inverterRef: inverter,
    batteryRef: includeBattery ? batteryRef : null,
    batteryCount: Math.max(1, batteryCount),
    includeBattery,
  });
}

/** Résumé financier à partir des inputs déjà calculés dans le drawer (PVGIS + kWp + surface). */
export function computeDiscoveryPipelineFinancialSummaryFromInputs(params: {
  inputs: DiscoveryDrawerFinancialInputs;
  panelRef: PanelReference;
  inverterRef: InverterReference;
  batteryRef?: BatteryReference | null;
  batteryCount?: number;
  includeBattery?: boolean;
  placeType?: string;
}): DiscoveryDrawerFinancialSummary | null {
  return computeDiscoveryDrawerFinancialSummary({
    inputs: params.inputs,
    placeType: params.placeType ?? "other",
    panelRef: params.panelRef,
    inverterRef: params.inverterRef,
    batteryRef: params.includeBattery ? params.batteryRef ?? null : null,
    batteryCount: Math.max(1, params.batteryCount ?? 1),
    includeBattery: params.includeBattery ?? false,
  });
}
