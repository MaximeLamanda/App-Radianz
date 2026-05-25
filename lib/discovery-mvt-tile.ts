/** Zoom min / max pour `/api/matching-v5/tiles/{z}/{x}/{y}` (aligné route API). */
export const MATCHING_V5_MVT_MIN_Z = 6;
export const MATCHING_V5_MVT_MAX_Z = 19;

/**
 * Valide les indices tuile WebMercator (z/x/y) depuis des segments d’URL.
 */
export function parseMatchingV5TileZXY(
  zs: string,
  xs: string,
  ys: string
): { z: number; x: number; y: number } | null {
  const z = Math.trunc(Number(zs));
  const x = Math.trunc(Number(xs));
  const y = Math.trunc(Number(ys));
  if (![z, x, y].every((n) => Number.isFinite(n) && n >= 0)) return null;
  if (z < MATCHING_V5_MVT_MIN_Z || z > MATCHING_V5_MVT_MAX_Z) return null;
  const max = 2 ** z;
  if (x >= max || y >= max) return null;
  return { z, x, y };
}
