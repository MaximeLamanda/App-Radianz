/**
 * Azimut PVGIS (0° = Sud, 90° = Ouest, -90° = Est) déduit d’une empreinte au sol WGS84,
 * même logique que le plus long côté en Lambert côté API BDNB (`ringOrientationLambert`).
 */

import { polygonAreaM2ApproxWgs84 } from "@/lib/geojson-polygon-area-m2";

const R_EARTH_M = 6_371_000;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Pente fixe alignée sur le drawer Solar Scout quand une orientation est connue. */
export const DISCOVERY_PVGIS_ROOF_SLOPE_DEG = 30;

/**
 * Anneau plan (m) : X = Est, Y = Nord — même convention que Lambert93 dans `app/api/bdnb/route.ts`.
 */
export function ringOrientationFromPlanarEastNorthMeters(ring: Array<[number, number]>): number | null {
  if (ring.length < 3) return null;

  const sides: { length: number; dx: number; dy: number }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1e-6) continue;
    sides.push({ length, dx, dy });
  }

  if (sides.length === 0) return null;
  const sorted = [...sides].sort((a, b) => b.length - a.length);
  const longest = sorted[0];
  const second = sorted[1];

  let dirX = longest.dx / longest.length;
  let dirY = longest.dy / longest.length;

  if (second && second.length > 0) {
    const dot = longest.dx * second.dx + longest.dy * second.dy;
    const cross = longest.dx * second.dy - longest.dy * second.dx;
    if (Math.abs(cross) < 0.01 * longest.length * second.length) {
      const sx = second.dx / second.length;
      const sy = second.dy / second.length;
      dirX = dot >= 0 ? dirX + sx : dirX - sx;
      dirY = dot >= 0 ? dirY + sy : dirY - sy;
      const n = Math.sqrt(dirX * dirX + dirY * dirY);
      if (n > 1e-6) {
        dirX /= n;
        dirY /= n;
      }
    }
  }

  const perp1 = { x: -dirY, y: dirX };
  const perp2 = { x: dirY, y: -dirX };

  const toAzimuth = (px: number, py: number): number => {
    const bearingDeg = (Math.atan2(px, py) * 180) / Math.PI;
    let az = bearingDeg - 180;
    if (az > 180) az -= 360;
    if (az < -180) az += 360;
    return az;
  };

  const az1 = toAzimuth(perp1.x, perp1.y);
  const az2 = toAzimuth(perp2.x, perp2.y);

  let azC1 = az1 + 90;
  if (azC1 > 180) azC1 -= 360;
  if (azC1 < -180) azC1 += 360;
  let azC2 = az1 - 90;
  if (azC2 > 180) azC2 -= 360;
  if (azC2 < -180) azC2 += 360;

  const candidates = [az1, az2, azC1, azC2];
  const best = candidates.reduce((min, c) => (Math.abs(c) < Math.abs(min) ? c : min));
  return Math.round(best * 10) / 10;
}

function lngLatRingToEnuMetersRing(
  ringLngLat: number[][],
  centerLat: number,
  centerLng: number
): Array<[number, number]> {
  const cosLat = Math.cos(toRad(centerLat));
  const out: Array<[number, number]> = [];
  for (const p of ringLngLat) {
    const lng = p[0] ?? 0;
    const lat = p[1] ?? 0;
    const x = R_EARTH_M * cosLat * toRad(lng - centerLng);
    const y = R_EARTH_M * toRad(lat - centerLat);
    out.push([x, y]);
  }
  return out;
}

function ringCentroidLngLat(ring: number[][]): { lat: number; lng: number } | null {
  const n0 = ring.length;
  if (n0 < 3) return null;
  const closed =
    ring[0]?.[0] === ring[n0 - 1]?.[0] && ring[0]?.[1] === ring[n0 - 1]?.[1]
      ? ring.slice(0, -1)
      : ring;
  if (closed.length < 3) return null;
  let slng = 0;
  let slat = 0;
  for (const c of closed) {
    slng += c[0] ?? 0;
    slat += c[1] ?? 0;
  }
  const m = closed.length;
  return { lng: slng / m, lat: slat / m };
}

function azimuthFromLngLatOuterRing(outerRing: number[][]): number | null {
  const c = ringCentroidLngLat(outerRing);
  if (!c) return null;
  const planar = lngLatRingToEnuMetersRing(outerRing, c.lat, c.lng);
  const asTuples = planar.map((p) => [p[0], p[1]] as [number, number]);
  return ringOrientationFromPlanarEastNorthMeters(asTuples);
}

function outerRingLargestPart(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number[][] | null {
  if (geometry.type === "Polygon") {
    const outer = geometry.coordinates[0];
    return outer && outer.length >= 3 ? outer : null;
  }
  let best: number[][] | null = null;
  let bestArea = 0;
  for (const poly of geometry.coordinates) {
    const outer = poly[0];
    if (!outer || outer.length < 3) continue;
    const area = polygonAreaM2ApproxWgs84({ type: "Polygon", coordinates: [outer] });
    if (area > bestArea) {
      bestArea = area;
      best = outer;
    }
  }
  return best;
}

/**
 * Azimut PVGIS pour une empreinte parcelle/bâtiment (anneau extérieur le plus grand si MultiPolygon).
 */
export function pvgisAzimuthFromFootprintGeometry(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): number | null {
  const outer = outerRingLargestPart(geometry);
  if (!outer) return null;
  return azimuthFromLngLatOuterRing(outer);
}
