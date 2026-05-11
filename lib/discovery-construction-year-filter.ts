import {
  parseMatchingV5BuildingsJson,
  type ScoutMatchingV5Row,
} from "@/lib/scout-matching-v5-map";

/** Borne basse du curseur « année de construction » (Découverte). */
export const DISCOVERY_CONSTRUCTION_YEAR_SLIDER_MIN = 1850;

/** Borne haute du curseur : année civile en cours. */
export function getDiscoveryConstructionYearSliderMax(): number {
  return new Date().getFullYear();
}

/** Filtre inactif : plage maximale → aucune contrainte sur les années. */
export function isDiscoveryConstructionYearFilterDisabled(
  minY: number,
  maxY: number,
  sliderMaxYear: number = getDiscoveryConstructionYearSliderMax()
): boolean {
  const lo = Math.min(minY, maxY);
  const hi = Math.max(minY, maxY);
  return lo <= DISCOVERY_CONSTRUCTION_YEAR_SLIDER_MIN && hi >= sliderMaxYear;
}

/**
 * Conserve l’empreinte si au moins un bâtiment du `buildings_json` a une
 * `annee_construction` connue et comprise dans [minY, maxY] (inclus).
 * Si le filtre est désactivé (plage pleine), retourne toujours true.
 */
export function rowMatchesDiscoveryConstructionYearRange(
  row: ScoutMatchingV5Row,
  minY: number,
  maxY: number,
  sliderMaxYear: number = getDiscoveryConstructionYearSliderMax()
): boolean {
  const lo = Math.min(minY, maxY);
  const hi = Math.max(minY, maxY);
  if (isDiscoveryConstructionYearFilterDisabled(lo, hi, sliderMaxYear)) return true;
  return parseMatchingV5BuildingsJson(row.buildingsJson).some(
    (b) =>
      b.anneeConstruction != null &&
      b.anneeConstruction >= lo &&
      b.anneeConstruction <= hi
  );
}
