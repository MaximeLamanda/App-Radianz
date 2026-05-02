/**
 * Point dans polygone / multipolygone GeoJSON (EPSG:4326, anneaux [lng, lat]).
 * Anneau extérieur + trous (RFC 7946).
 */

function normalizeRing(ring: number[][]): number[][] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring.slice(0, -1);
  }
  return ring;
}

/** Ray casting — lng/lat en degrés (plan local OK pour petites parcelles). */
export function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  const r = normalizeRing(ring);
  if (r.length < 3) return false;
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0];
    const yi = r[i][1];
    const xj = r[j][0];
    const yj = r[j][1];
    const denom = yj - yi;
    const intersect =
      yi !== yj && (lat < yi) !== (lat < yj) && lng < ((xj - xi) * (lat - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygonRings(poly: number[][][], lng: number, lat: number): boolean {
  if (!poly?.length) return false;
  const outer = poly[0];
  if (!pointInRing(lng, lat, outer)) return false;
  for (let h = 1; h < poly.length; h++) {
    if (pointInRing(lng, lat, poly[h])) return false;
  }
  return true;
}

/** Vrai si le point est dans au moins un polygone du MultiPolygon. */
export function pointInParcelGeometry(
  lng: number,
  lat: number,
  g: GeoJSON.Polygon | GeoJSON.MultiPolygon
): boolean {
  if (g.type === "Polygon") {
    return pointInPolygonRings(g.coordinates, lng, lat);
  }
  for (const poly of g.coordinates) {
    if (pointInPolygonRings(poly, lng, lat)) return true;
  }
  return false;
}
