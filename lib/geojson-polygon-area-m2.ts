/**
 * Aire approximative (m²) d'un Polygon / MultiPolygon GeoJSON en [lng, lat] WGS84.
 * Projection tangente locale au centroïde de chaque anneau extérieur + shoelace.
 * Suffisant pour l’affichage « surface parcelle » sur des parcelles cadastrales.
 */
const R_EARTH_M = 6_371_000;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

function ringAreaM2OuterRingLngLat(ring: number[][]): number {
  if (!ring?.length) return 0;
  const n = ring.length;
  const closed =
    ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1] ? ring.slice(0, -1) : ring;
  const m = closed.length;
  if (m < 3) return 0;

  let sumLng = 0;
  let sumLat = 0;
  for (const p of closed) {
    sumLng += p[0];
    sumLat += p[1];
  }
  const lng0 = sumLng / m;
  const lat0 = sumLat / m;
  const cosLat = Math.cos(toRad(lat0));

  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of closed) {
    xs.push(R_EARTH_M * cosLat * toRad(p[0] - lng0));
    ys.push(R_EARTH_M * toRad(p[1] - lat0));
  }

  let a = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    a += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return Math.abs(a / 2);
}

/** Aire extérieure d’un polygone GeoJSON (ignore les trous ; somme les parties d’un MultiPolygon). */
export function polygonAreaM2ApproxWgs84(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  if (geometry.type === "Polygon") {
    const outer = geometry.coordinates[0];
    return ringAreaM2OuterRingLngLat(outer ?? []);
  }
  let sum = 0;
  for (const poly of geometry.coordinates) {
    const outer = poly[0];
    sum += ringAreaM2OuterRingLngLat(outer ?? []);
  }
  return sum;
}

/**
 * Aire emprise matching V5 : polygone comme `polygonAreaM2ApproxWgs84` ;
 * `Point` (overview carte) → repli sur `footprintSumM2` côté appelant.
 */
export function polygonAreaM2ApproxWithPointFallback(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.Point,
  footprintSumM2: number
): number {
  if (geometry.type === "Point") return Math.max(0, footprintSumM2);
  return Math.max(0, polygonAreaM2ApproxWgs84(geometry));
}
