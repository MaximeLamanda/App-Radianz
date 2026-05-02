/**
 * Centroïde d'un anneau GeoJSON [lng, lat] (fermé ou non).
 * Formule aire + centroïde polygone (shoelace).
 */
function ringCentroidLngLat(ring: number[][]): { lng: number; lat: number } | null {
  if (!ring?.length) return null;
  const n = ring.length;
  const closed =
    ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1] ? ring.slice(0, -1) : ring;
  const m = closed.length;
  if (m < 1) return null;
  if (m === 1) return { lng: closed[0][0], lat: closed[0][1] };
  if (m === 2) {
    return { lng: (closed[0][0] + closed[1][0]) / 2, lat: (closed[0][1] + closed[1][1]) / 2 };
  }

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const cross = closed[i][0] * closed[j][1] - closed[j][0] * closed[i][1];
    twiceArea += cross;
    cx += (closed[i][0] + closed[j][0]) * cross;
    cy += (closed[i][1] + closed[j][1]) * cross;
  }

  if (Math.abs(twiceArea) < 1e-18) {
    let sx = 0;
    let sy = 0;
    for (const p of closed) {
      sx += p[0];
      sy += p[1];
    }
    return { lng: sx / m, lat: sy / m };
  }

  const area = twiceArea / 2;
  return { lng: cx / (6 * area), lat: cy / (6 * area) };
}

function polygonAreaAbs(coords: number[][][]): number {
  const outer = coords[0];
  if (!outer?.length) return 0;
  const ring = outer;
  const n = ring.length;
  const closed =
    ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1] ? ring.slice(0, -1) : ring;
  let a = 0;
  for (let i = 0; i < closed.length; i++) {
    const j = (i + 1) % closed.length;
    a += closed[i][0] * closed[j][1] - closed[j][0] * closed[i][1];
  }
  return Math.abs(a / 2);
}

/**
 * Centroïde du premier anneau de chaque polygone ; MultiPolygon = moyenne pondérée par aire.
 */
export function centroidFromGeoJsonPolygonLike(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): { lat: number; lng: number } | null {
  if (geometry.type === "Polygon") {
    const c = ringCentroidLngLat(geometry.coordinates[0] ?? []);
    if (!c) return null;
    return { lat: c.lat, lng: c.lng };
  }

  const polys = geometry.coordinates;
  let sumLng = 0;
  let sumLat = 0;
  let sumA = 0;
  for (const poly of polys) {
    const c = ringCentroidLngLat(poly[0] ?? []);
    if (!c) continue;
    const a = polygonAreaAbs(poly);
    const w = a > 1e-24 ? a : 1;
    sumLng += c.lng * w;
    sumLat += c.lat * w;
    sumA += w;
  }
  if (sumA <= 0) return null;
  return { lat: sumLat / sumA, lng: sumLng / sumA };
}
