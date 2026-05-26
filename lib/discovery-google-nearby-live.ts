/**
 * Recherche Google Places Nearby côté client (drawer découverte), filtrage dans l’emprise
 * parcelle aligné sur {@link rankNearbyPlaces}, export au format {@link V5GoogleNearbyRankedEntry}.
 */

import { centroidFromGeoJsonPolygonLike, latLngFromMatchingGeometry } from "@/lib/matching-v5-google-poi-fallback/centroid-from-geojson";
import { haversineMeters } from "@/lib/matching-v5-google-poi-fallback/haversine";
import { pointInParcelGeometry } from "@/lib/matching-v5-google-poi-fallback/point-in-geojson-polygon";
import { rankNearbyPlaces } from "@/lib/matching-v5-google-poi-fallback/rank-candidates";
import type { NearbyPlaceResult, RankedNearbyPlace } from "@/lib/matching-v5-google-poi-fallback/types";
import type { ScoutMatchingV5Row, V5GoogleNearbyRankedEntry } from "@/lib/scout-matching-v5-map";

const MIN_RADIUS_M = 80;
const MAX_NEARBY_RADIUS_M = 180;
const RADIUS_MARGIN_M = 25;
/** Tampon minimal pour parcelle encore en `Point` (aperçu carte, pas de contour cadastral). */
const POINT_PARCEL_FILTER_RADIUS_M = 50;

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

function polygonFromParts(parts: number[][][][]): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return { type: "Polygon", coordinates: parts[0]! };
  return { type: "MultiPolygon", coordinates: parts };
}

/** Cercle approché (WGS84) pour une parcelle encore en `Point` (overview carte). */
export function circlePolygonFromCenterRadiusM(
  lat: number,
  lng: number,
  radiusM: number,
  segments = 16
): GeoJSON.Polygon {
  const latRad = (lat * Math.PI) / 180;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.max(0.2, Math.cos(latRad));
  const ring: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    const dx = Math.cos(angle) * radiusM;
    const dy = Math.sin(angle) * radiusM;
    ring.push([lng + dx / metersPerDegLng, lat + dy / metersPerDegLat]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

export type GoogleNearbyParcelSearchContext = {
  /** Emprise stricte pour filtrer les POI (contours cadastraux ; tampon 50 m seulement sans polygone). */
  filterParcelGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  /** Étendue pour le rayon Nearby (peut inclure des tampons Point non utilisés au filtre). */
  searchExtentGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};

/**
 * Union géométrique des parcelles (MultiPolygon si plusieurs polygones distincts).
 * Les lignes `Point` (aperçu carte) sont ignorées — préférer {@link parcelSearchContextForGoogleNearby}.
 */
export function buildParcelUnionGeometry(
  rows: ScoutMatchingV5Row[]
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const ctx = parcelSearchContextForGoogleNearby(rows);
  return ctx?.filterParcelGeometry ?? null;
}

/**
 * Emprise Google pour le combo effectif : filtre sur cadastre réel ;
 * tampon 50 m uniquement si la parcelle n’a pas encore de polygone (aperçu carte).
 */
export function parcelSearchContextForGoogleNearby(
  rows: ScoutMatchingV5Row[]
): GoogleNearbyParcelSearchContext | null {
  const parcelles = rows.filter((r) => r.grain === "parcelle");
  const cadastralParts: number[][][][] = [];
  const pointBufferParts: number[][][][] = [];

  for (const r of parcelles) {
    const g = r.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      cadastralParts.push(g.coordinates);
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) {
        cadastralParts.push(poly);
      }
    } else if (g.type === "Point") {
      const c = latLngFromMatchingGeometry(g);
      if (!c) continue;
      pointBufferParts.push(
        circlePolygonFromCenterRadiusM(
          c.lat,
          c.lng,
          POINT_PARCEL_FILTER_RADIUS_M
        ).coordinates
      );
    }
  }

  const filterParcelGeometry = polygonFromParts(
    cadastralParts.length > 0 ? cadastralParts : pointBufferParts
  );
  if (!filterParcelGeometry) return null;

  const searchExtentGeometry =
    polygonFromParts([...cadastralParts, ...pointBufferParts]) ?? filterParcelGeometry;

  return { filterParcelGeometry, searchExtentGeometry };
}

/**
 * Rayon Nearby : distance centroïde → sommet le plus éloigné + marge, plafonné
 * (évite d’aspirer tout le quartier sur les grands bbox multi-parcelles).
 */
export function nearbySearchRadiusMForGeometry(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  const centroid = centroidFromGeoJsonPolygonLike(g);
  if (!centroid) return MIN_RADIUS_M;

  let maxDistM = 0;
  forEachLngLatInGeometry(g, (lng, lat) => {
    const d = haversineMeters(centroid, { lat, lng });
    if (d > maxDistM) maxDistM = d;
  });

  const withMargin = maxDistM + RADIUS_MARGIN_M;
  return Math.min(Math.max(withMargin, MIN_RADIUS_M), MAX_NEARBY_RADIUS_M);
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
/** Conserve uniquement les entrées dont les coordonnées sont dans l’emprise parcelle. */
export function filterGoogleNearbyEntriesInParcel(
  entries: readonly V5GoogleNearbyRankedEntry[],
  parcelGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): V5GoogleNearbyRankedEntry[] {
  return entries.filter((e) => {
    const lat = e.lat;
    const lng = e.lng;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return false;
    }
    return pointInParcelGeometry(lng, lat, parcelGeometry);
  });
}

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
  filterParcelGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  searchExtentGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
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

  const filterParcelGeometry = params.filterParcelGeometry;
  const searchExtentGeometry = params.searchExtentGeometry ?? filterParcelGeometry;

  const centroid = centroidFromGeoJsonPolygonLike(filterParcelGeometry);
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

  const radiusM = nearbySearchRadiusMForGeometry(searchExtentGeometry);
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
    parcelGeometry: filterParcelGeometry,
  });

  return { ok: true, entries: rankedNearbyPlacesToV5Entries(ranked) };
}
