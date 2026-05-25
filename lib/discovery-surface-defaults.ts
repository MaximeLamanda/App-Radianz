/**
 * Seuil d’export parcelle du matching V5 (`--min-parcelle-footprint-sum-m2`, défaut script Python 400).
 */
export const MATCHING_V5_DEFAULT_MIN_PARCELLE_FOOTPRINT_SUM_M2 = 400;

/** Borne basse par défaut du slider « surface empreinte » sur Découverte (0 = pas de plancher côté UI). */
export const DISCOVERY_SURFACE_SLIDER_DEFAULT_MIN_M2 = 0;

/**
 * Plafond du slider « surface empreinte » sur Découverte (m²).
 * Lorsque la borne haute appliquée est à ce maximum, le filtre supérieur est **ouvert** (aucune exclusion au-delà de ce seuil) ;
 * l’UI affiche « 50 000+ » pour le côté haut de l’intervalle.
 */
export const DISCOVERY_SURFACE_SLIDER_MAX_M2 = 50_000;

/** Borne basse par défaut du slider « surface parking » (0 = pas de plancher côté UI). */
export const DISCOVERY_PARKING_SLIDER_DEFAULT_MIN_M2 = DISCOVERY_SURFACE_SLIDER_DEFAULT_MIN_M2;

/** Plafond du slider « surface parking » — mêmes bornes que l’empreinte building. */
export const DISCOVERY_PARKING_SLIDER_MAX_M2 = DISCOVERY_SURFACE_SLIDER_MAX_M2;

/** Plage envoyée à l’API quand le filtre surface est désactivé (aucune clause SQL). */
export function discoverySurfaceRangeWhenFilterOff(): { min: number; max: number } {
  return {
    min: DISCOVERY_SURFACE_SLIDER_DEFAULT_MIN_M2,
    max: DISCOVERY_SURFACE_SLIDER_MAX_M2,
  };
}

export function discoverySurfaceRangeForApi(
  enabled: boolean,
  range: { min: number; max: number }
): { min: number; max: number } {
  return enabled ? range : discoverySurfaceRangeWhenFilterOff();
}
