/** Borne basse du slider « proportion empreinte / parcelle » (%). */
export const DISCOVERY_FOOTPRINT_RATIO_SLIDER_MIN_PCT = 0;

/** Borne haute du slider (%). À ce maximum, le filtre supérieur est ouvert (100 %+). */
export const DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT = 100;

export const DISCOVERY_FOOTPRINT_RATIO_SLIDER_DEFAULT_MIN_PCT = 0;
export const DISCOVERY_FOOTPRINT_RATIO_SLIDER_DEFAULT_MAX_PCT = 100;

export const DISCOVERY_FOOTPRINT_RATIO_SLIDER_STEP_PCT = 5;

export function discoveryFootprintRatioRangeWhenFilterOff(): { min: number; max: number } {
  return {
    min: DISCOVERY_FOOTPRINT_RATIO_SLIDER_DEFAULT_MIN_PCT,
    max: DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT,
  };
}

export function discoveryFootprintRatioRangeForApi(
  enabled: boolean,
  range: { min: number; max: number }
): { min: number; max: number } {
  return enabled ? range : discoveryFootprintRatioRangeWhenFilterOff();
}

/** Plafond effectif du slider : au maximum UI, pas de borne haute SQL. */
export function discoveryFootprintRatioHiEffective(
  hiPct: number,
  sliderMaxPct: number = DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT
): number {
  return hiPct >= sliderMaxPct ? Number.POSITIVE_INFINITY : hiPct;
}

export function isDiscoveryFootprintRatioFilterDisabled(
  minPct: number,
  maxPct: number,
  sliderMaxPct: number = DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT
): boolean {
  return (
    minPct <= DISCOVERY_FOOTPRINT_RATIO_SLIDER_MIN_PCT &&
    maxPct >= sliderMaxPct
  );
}

/** Ratio 0–1 pour SQL à partir d’un pourcentage UI. */
export function discoveryFootprintRatioPctToUnit(pct: number): number {
  return Math.max(0, Math.min(1, pct / 100));
}
