/**
 * Logique pure : tri / filtre des Places « Nearby » comme le client Solar Scout
 * (hors appel réseau). Utilisé par scripts/build-bdnb-poi-sample.ts.
 */

export const BDNB_POI_EXCLUDED_TYPES = new Set([
  "geocode",
  "route",
  "street_address",
  "premise",
  "subpremise",
  "locality",
  "political",
]);

export type NearbyPlaceLite = {
  place_id?: string;
  name?: string;
  types?: string[];
  geometry?: { location: { lat: number; lng: number } };
};

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function polygonBBoxDiagonalMeters(ring: Array<[number, number]>): number {
  if (ring.length < 2) return 200;
  const lats = ring.map((c) => c[1]);
  const lngs = ring.map((c) => c[0]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return haversineMeters(minLat, minLng, maxLat, maxLng);
}

export function pointInRing(
  lat: number,
  lng: number,
  ring: Array<[number, number]>
): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function getOuterRing(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): Array<[number, number]> {
  if (geom.type === "Polygon") {
    return geom.coordinates[0] as Array<[number, number]>;
  }
  return geom.coordinates[0][0] as Array<[number, number]>;
}

export function ringCentroid(ring: Array<[number, number]>): { lat: number; lng: number } {
  let sumLat = 0;
  let sumLng = 0;
  for (const c of ring) {
    sumLng += c[0];
    sumLat += c[1];
  }
  const n = ring.length || 1;
  return { lat: sumLat / n, lng: sumLng / n };
}

/**
 * Même ordre que l’ancien `sortPlacesLikeClient` dans le script : d’abord les POI
 * dans le polygone (tri par distance au centroïde), puis hors polygone.
 */
export function sortPlacesLikeClient(
  places: NearbyPlaceLite[],
  centroid: { lat: number; lng: number },
  outerRing: Array<[number, number]>
): NearbyPlaceLite[] {
  const filtered = places.filter((place) => {
    const types = place.types || [];
    if (types.some((t) => BDNB_POI_EXCLUDED_TYPES.has(t))) return false;
    if (!place.name) return false;
    return true;
  });
  const locOf = (p: NearbyPlaceLite) => p.geometry?.location;
  const insideRaw = filtered.filter((p) => {
    const loc = locOf(p);
    if (!loc) return false;
    return pointInRing(loc.lat, loc.lng, outerRing);
  });
  const outsideRaw = filtered.filter((p) => {
    const loc = locOf(p);
    if (!loc) return true;
    return !pointInRing(loc.lat, loc.lng, outerRing);
  });
  const sortByCentroid = (arr: NearbyPlaceLite[]) =>
    [...arr].sort((a, b) => {
      const la = locOf(a);
      const lb = locOf(b);
      if (!la) return 1;
      if (!lb) return -1;
      const da = haversineMeters(la.lat, la.lng, centroid.lat, centroid.lng);
      const db = haversineMeters(lb.lat, lb.lng, centroid.lat, centroid.lng);
      return da - db;
    });
  return [...sortByCentroid(insideRaw), ...sortByCentroid(outsideRaw)];
}
