import { haversineMeters } from "./haversine";
import { pointInParcelGeometry } from "./point-in-geojson-polygon";
import { scorePlaceTypes } from "./type-weights";
import type { NearbyPlaceResult, RankedNearbyPlace } from "./types";

const MAX_DISTANCE_M = 500;

/** Bonus de score quand le POI est dans l’emprise parcelle (filtre actif). */
const PARCEL_INSIDE_BONUS = 0.2;

export type RankNearbyPlacesResult = {
  ranked: RankedNearbyPlace[];
  /** POI avec position valide dans le rayon, mais hors polygone parcelle. */
  excludedOutsideParcel: number;
};

/**
 * Combine distance, types Google, et bonus si le POI est dans la géométrie parcelle.
 * Si `parcelGeometry` est fourni, les POI hors emprise sont exclus (pas de classement).
 */
export function rankNearbyPlaces(
  centroid: { lat: number; lng: number },
  places: NearbyPlaceResult[],
  opts?: {
    maxRanked?: number;
    parcelGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  }
): RankNearbyPlacesResult {
  const maxRanked = opts?.maxRanked ?? 20;
  const parcel = opts?.parcelGeometry;
  const ranked: RankedNearbyPlace[] = [];
  let excludedOutsideParcel = 0;

  for (const p of places) {
    const loc = p.geometry?.location;
    const lat = loc?.lat;
    const lng = loc?.lng;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const distanceM = haversineMeters(centroid, { lat, lng });
    if (distanceM > MAX_DISTANCE_M) continue;

    let insideParcel = false;
    if (parcel) {
      insideParcel = pointInParcelGeometry(lng, lat, parcel);
      if (!insideParcel) {
        excludedOutsideParcel += 1;
        continue;
      }
    }

    const typeScore = scorePlaceTypes(p.types);
    const distNorm = 1 / (1 + distanceM / 30);
    let relevanceScore = 0.62 * distNorm + 0.38 * typeScore;
    if (parcel && insideParcel) {
      relevanceScore += PARCEL_INSIDE_BONUS;
    }

    ranked.push({
      ...p,
      distanceM,
      typeScore,
      relevanceScore,
      insideParcel: Boolean(parcel && insideParcel),
    });
  }

  ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return {
    ranked: ranked.slice(0, maxRanked),
    excludedOutsideParcel,
  };
}
