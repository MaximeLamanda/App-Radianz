import { MATCHING_V5_MVT_MAX_Z, MATCHING_V5_MVT_MIN_Z } from "@/lib/discovery-mvt-tile";

/**
 * Tolérance en degrés (4326) pour `ST_SimplifyPreserveTopology` avant projection tuile.
 * Zoom bas = géométrie plus légère ; zoom élevé = détail préservé.
 */
export function toleranceDegForMatchingV5MvtZoom(z: number): number {
  const clamped = Math.min(Math.max(z, MATCHING_V5_MVT_MIN_Z), MATCHING_V5_MVT_MAX_Z);
  if (clamped >= 17) return 0;
  if (clamped >= 15) return 1e-7;
  if (clamped >= 13) return 3e-7;
  if (clamped >= 11) return 1e-6;
  if (clamped >= 9) return 3e-6;
  return 1e-5;
}
