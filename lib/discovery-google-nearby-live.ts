/**
 * Recherche Google Places Nearby côté client (drawer découverte), filtrage dans l’emprise
 * parcelle aligné sur {@link rankNearbyPlaces}, export au format {@link V5GoogleNearbyRankedEntry}.
 */

import { centroidFromGeoJsonPolygonLike } from "@/lib/matching-v5-google-poi-fallback/centroid-from-geojson";
import { haversineMeters } from "@/lib/matching-v5-google-poi-fallback/haversine";
import { rankNearbyPlaces } from "@/lib/matching-v5-google-poi-fallback/rank-candidates";
import type { NearbyPlaceResult, RankedNearbyPlace } from "@/lib/matching-v5-google-poi-fallback/types";
import type { ScoutMatchingV5Row, V5GoogleNearbyRankedEntry } from "@/lib/scout-matching-v5-map";

const MIN_RADIUS_M = 100;

/** Attend que le script Maps JS (injecté par GoogleMapsLoader ou autre) expose `google.maps`. */
export async function waitForGoogleMapsReady(opts?: { timeoutMs?: number }): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 25000;
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = () =>
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;
  while (elapsed() < timeoutMs) {
    if (typeof window !== "undefined" && window.google?.maps?.LatLng) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

function forEachLngLatInGeometry(
  g: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  fn: (lng: number, lat: number) => void
): void {
  if (g.type === "Polygon") {
    const outer = g.coordinates[0];
    if (!outer) return;
    for (const c of outer) {
      if (c.length >= 2) fn(c[0]!, c[1]!);
    }
    return;
  }
  for (const poly of g.coordinates) {
    const outer = poly[0];
    if (!outer) continue;
    for (const c of outer) {
      if (c.length >= 2) fn(c[0]!, c[1]!);
    }
  }
}

/**
 * Union géométrique des parcelles (MultiPolygon si plusieurs polygones distincts).
 */
export function buildParcelUnionGeometry(
  rows: ScoutMatchingV5Row[]
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const parcelles = rows.filter((r) => r.grain === "parcelle");
  const parts: number[][][][] = [];
  for (const r of parcelles) {
    const g = r.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      parts.push(g.coordinates);
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) {
        parts.push(poly);
      }
    }
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    return { type: "Polygon", coordinates: parts[0]! };
  }
  return { type: "MultiPolygon", coordinates: parts };
}

/**
 * Diagonale de la bbox (m) sur toutes les coordonnées du polygone / multipolygone, ×1.5, min 100 m.
 * Même esprit que `listPoisNearPolygon` pour le rayon Nearby.
 */
export function nearbySearchRadiusMForGeometry(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  forEachLngLatInGeometry(g, (lng, lat) => {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  });
  if (!Number.isFinite(minLat) || !Number.isFinite(maxLat)) return MIN_RADIUS_M * 2;
  const diagonal = haversineMeters(
    { lat: minLat, lng: minLng },
    { lat: maxLat, lng: maxLng }
  );
  return Math.max(diagonal * 1.5, MIN_RADIUS_M);
}

function placeResultToNearby(place: google.maps.places.PlaceResult): NearbyPlaceResult | null {
  const name = String(place.name || "").trim();
  if (!name) return null;
  const loc = place.geometry?.location;
  if (!loc) return null;
  const lat = typeof loc.lat === "function" ? loc.lat() : Number(loc.lat);
  const lng = typeof loc.lng === "function" ? loc.lng() : Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const types = Array.isArray(place.types) ? place.types.filter((t): t is string => typeof t === "string") : undefined;
  return {
    place_id: String(place.place_id || ""),
    name,
    vicinity: place.vicinity,
    types,
    geometry: { location: { lat, lng } },
  };
}

/**
 * Mappe les lieux classés vers le même schéma que `_serialize_ranked_nearby` (pipeline Python).
 */
export function rankedNearbyPlacesToV5Entries(ranked: RankedNearbyPlace[]): V5GoogleNearbyRankedEntry[] {
  return ranked.map((r, i) => {
    const lat = r.geometry?.location?.lat;
    const lng = r.geometry?.location?.lng;
    return {
      rank: i,
      place_id: String(r.place_id || ""),
      name: String(r.name || ""),
      vicinity: r.vicinity ?? null,
      types: Array.isArray(r.types) ? r.types : null,
      lat: lat != null && Number.isFinite(lat) ? lat : null,
      lng: lng != null && Number.isFinite(lng) ? lng : null,
    };
  });
}

export type FetchNearbyRankedInParcelResult =
  | { ok: true; entries: V5GoogleNearbyRankedEntry[] }
  | {
      ok: false;
      code:
        | "no_api_key"
        | "no_geometry"
        | "no_centroid"
        | "maps_unavailable"
        | "places_unavailable"
        | "nearby_failed";
      message: string;
      googleStatus?: string;
    };

/**
 * Lance Nearby Search (establishment), puis {@link rankNearbyPlaces} avec l’emprise parcelle.
 */
export async function fetchNearbyRankedInParcel(params: {
  parcelGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}): Promise<FetchNearbyRankedInParcelResult> {
  const apiKey =
    typeof process !== "undefined" ? String(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "").trim() : "";
  if (!apiKey) {
    return {
      ok: false,
      code: "no_api_key",
      message: "Clé NEXT_PUBLIC_GOOGLE_MAPS_API_KEY manquante.",
    };
  }

  const centroid = centroidFromGeoJsonPolygonLike(params.parcelGeometry);
  if (!centroid) {
    return { ok: false, code: "no_centroid", message: "Impossible de calculer le centroïde de la parcelle." };
  }

  const maps = typeof window !== "undefined" ? window.google?.maps : undefined;
  if (!maps?.LatLng) {
    return {
      ok: false,
      code: "maps_unavailable",
      message: "Google Maps n’est pas chargé. Réessayez dans un instant.",
    };
  }

  let placesLib: typeof google.maps.places | undefined = maps.places;
  if (!placesLib) {
    try {
      placesLib = (await (maps as unknown as { importLibrary?: (name: string) => Promise<unknown> }).importLibrary?.(
        "places"
      )) as typeof google.maps.places | undefined;
    } catch {
      placesLib = undefined;
    }
  }
  if (!placesLib?.PlacesService || !placesLib.PlacesServiceStatus) {
    return {
      ok: false,
      code: "places_unavailable",
      message: "L’API Places n’est pas disponible.",
    };
  }

  let service: google.maps.places.PlacesService;
  try {
    service = new placesLib.PlacesService(document.createElement("div"));
  } catch {
    return {
      ok: false,
      code: "places_unavailable",
      message: "Impossible d’initialiser PlacesService.",
    };
  }

  const radiusM = nearbySearchRadiusMForGeometry(params.parcelGeometry);
  const request: google.maps.places.PlaceSearchRequest = {
    location: new maps.LatLng(centroid.lat, centroid.lng),
    radius: Math.round(radiusM),
    type: "establishment",
  };

  const PS = placesLib.PlacesServiceStatus;
  let rawPlaces: google.maps.places.PlaceResult[] = [];
  let nearbyStatus = "UNKNOWN";
  try {
    await new Promise<void>((resolve, reject) => {
      service.nearbySearch(request, (results, status) => {
        nearbyStatus = String(status);
        if (status === PS.OK) {
          rawPlaces = results ?? [];
          resolve();
          return;
        }
        if (status === PS.ZERO_RESULTS) {
          rawPlaces = [];
          resolve();
          return;
        }
        reject(new Error(nearbyStatus));
      });
    });
  } catch {
    return {
      ok: false,
      code: "nearby_failed",
      message: `Nearby Search : ${nearbyStatus}`,
      googleStatus: nearbyStatus,
    };
  }

  const nearbyList: NearbyPlaceResult[] = [];
  for (const p of rawPlaces) {
    const n = placeResultToNearby(p);
    if (n) nearbyList.push(n);
  }

  const { ranked } = rankNearbyPlaces(centroid, nearbyList, {
    maxRanked: 20,
    parcelGeometry: params.parcelGeometry,
  });

  return { ok: true, entries: rankedNearbyPlacesToV5Entries(ranked) };
}
