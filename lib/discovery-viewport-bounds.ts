import type { MapBounds } from "@/lib/swr-hooks";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";

/**
 * Marge symétrique autour de la bbox carte (fraction de la hauteur / largeur).
 * Surcharge possible : `NEXT_PUBLIC_DISCOVERY_FEATURES_BOUNDS_PADDING` (nombre 0–1).
 */
export const DISCOVERY_FEATURES_BOUNDS_PADDING: number = (() => {
  const raw =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_DISCOVERY_FEATURES_BOUNDS_PADDING?.trim()
      : undefined;
  if (!raw) return 0.3;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0.3;
  return n;
})();

function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat));
}

/**
 * Étend une bbox en ajoutant `paddingFraction` × (span lat, span lng) de chaque côté.
 */
export function expandMapBounds(bounds: MapBounds, paddingFraction: number): MapBounds {
  const latSpan = bounds.ne.lat - bounds.sw.lat;
  const lngSpan = bounds.ne.lng - bounds.sw.lng;
  const padLat = latSpan * paddingFraction;
  const padLng = lngSpan * paddingFraction;
  return {
    sw: {
      lat: clampLat(bounds.sw.lat - padLat),
      lng: bounds.sw.lng - padLng,
    },
    ne: {
      lat: clampLat(bounds.ne.lat + padLat),
      lng: bounds.ne.lng + padLng,
    },
  };
}

/**
 * Vrai si tout le rectangle `viewport` est inclus dans `query` (mêmes conventions Leaflet : sw / ne, pas d’antiméridien).
 */
export function viewportContainedInQueryBounds(viewport: MapBounds, query: MapBounds): boolean {
  return (
    viewport.sw.lat >= query.sw.lat &&
    viewport.ne.lat <= query.ne.lat &&
    viewport.sw.lng >= query.sw.lng &&
    viewport.ne.lng <= query.ne.lng
  );
}

type GeoBBox = { minLng: number; maxLng: number; minLat: number; maxLat: number };

/** Bbox d’un Point GeoJSON [lng, lat]. */
function getPointBBox(geometry: GeoJSON.Point): GeoBBox | null {
  const c = geometry.coordinates;
  if (!c || c.length < 2) return null;
  const lng = c[0]!;
  const lat = c[1]!;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat };
}

/** Bbox englobante d’un Polygon / MultiPolygon GeoJSON (coordonnées [lng, lat]). */
function getPolygonLikeBBox(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoBBox | null {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const visitRing = (ring: number[][]) => {
    for (const pt of ring) {
      if (!pt || pt.length < 2) continue;
      const lng = pt[0]!;
      const lat = pt[1]!;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  };
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) visitRing(ring);
  } else {
    for (const poly of geometry.coordinates) {
      for (const ring of poly) visitRing(ring);
    }
  }
  if (!Number.isFinite(minLng) || minLng === Infinity) return null;
  return { minLng, maxLng, minLat, maxLat };
}

/**
 * Garde les lignes dont la géométrie intersecte la bbox carte (viewport + marge).
 * Utilisé pour limiter les ids BDNB à la zone visible (évite le « trou » au-delà du cap global d’ids).
 */
export function filterScoutMatchingV5RowsByMapBounds(
  rows: ScoutMatchingV5Row[],
  viewport: MapBounds,
  paddingFraction: number
): ScoutMatchingV5Row[] {
  const vb = expandMapBounds(viewport, paddingFraction);
  return rows.filter((row) => {
    const g = row.geometry;
    const bb =
      g.type === "Point"
        ? getPointBBox(g)
        : g.type === "Polygon" || g.type === "MultiPolygon"
          ? getPolygonLikeBBox(g)
          : null;
    if (!bb) return true;
    if (bb.maxLat < vb.sw.lat || bb.minLat > vb.ne.lat) return false;
    if (bb.maxLng < vb.sw.lng || bb.minLng > vb.ne.lng) return false;
    return true;
  });
}
