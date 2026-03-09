import type { AddressCoordinates } from "@/types";

/** Types à exclure des résultats (adresses, zones géographiques, pas des POI nommés) */
const EXCLUDED_TYPES = new Set([
  "geocode",
  "route",
  "street_address",
  "premise",
  "subpremise",
  "locality",
  "political",
]);

/** Rayon minimum en mètres pour Nearby Search */
const MIN_RADIUS_M = 30;

/**
 * Calcule la distance Haversine entre deux points en mètres.
 */
function haversineMeters(
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

/**
 * Calcule la diagonale du bounding box du polygone en mètres.
 */
function polygonBoundingBoxDiagonalMeters(
  polygon: Array<{ lat: number; lng: number }>
): number {
  if (polygon.length === 0) return MIN_RADIUS_M * 2;
  const lats = polygon.map((p) => p.lat);
  const lngs = polygon.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return haversineMeters(minLat, minLng, maxLat, maxLng);
}

/**
 * Vérifie si un point est à l'intérieur d'un polygone (ray casting).
 */
function pointInPolygon(
  lat: number,
  lng: number,
  polygon: Array<{ lat: number; lng: number }>
): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calcule le centroïde d'un polygone.
 */
function polygonCentroid(polygon: Array<{ lat: number; lng: number }>): { lat: number; lng: number } | null {
  if (polygon.length === 0) return null;
  const n = polygon.length;
  let sumLat = 0;
  let sumLng = 0;
  for (const p of polygon) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  return { lat: sumLat / n, lng: sumLng / n };
}

/**
 * Calcule la distance au centroïde en mètres.
 */
function distanceToCentroid(
  lat: number,
  lng: number,
  centroid: AddressCoordinates
): number {
  return haversineMeters(lat, lng, centroid.lat, centroid.lng);
}

export interface PoiNearPolygonResult {
  name: string;
  /** place_id Google Places pour appeler getPlaceDetailsNew et déclencher le même enrichissement que le clic POI */
  placeId?: string;
  /** Coordonnées du POI (pour le prospect) */
  coordinates?: { lat: number; lng: number };
}

/**
 * Recherche un POI Google dans ou près d'un polygone.
 * Priorité : POI à l'intérieur du polygone, sinon le plus proche du centroïde.
 * Filtrage : type "establishment" + exclusion des types adresse.
 *
 * @returns Le POI trouvé avec son nom, ou null si aucun
 */
export async function searchPoiForPolygon(
  centroid: AddressCoordinates,
  polygon: Array<{ lat: number; lng: number }>
): Promise<PoiNearPolygonResult | null> {
  if (!window.google?.maps?.places) return null;

  const maps = window.google.maps;
  let service: google.maps.places.PlacesService;
  try {
    service = new maps.places.PlacesService(document.createElement("div"));
  } catch {
    return null;
  }

  const diagonal = polygonBoundingBoxDiagonalMeters(polygon);
  const radius = Math.max(diagonal / 2, MIN_RADIUS_M);

  return new Promise((resolve) => {
    const request: google.maps.places.PlaceSearchRequest = {
      location: new maps.LatLng(centroid.lat, centroid.lng),
      radius,
      type: "establishment",
    };

    service.nearbySearch(request, (results, status) => {
      if (status !== maps.places.PlacesServiceStatus.OK || !results?.length) {
        resolve(null);
        return;
      }

      // 1. Exclure les résultats avec types non désirés
      const filtered = results.filter((place) => {
        const types = place.types || [];
        const hasExcluded = types.some((t) => EXCLUDED_TYPES.has(t));
        return !hasExcluded && place.name;
      });

      if (filtered.length === 0) {
        resolve(null);
        return;
      }

      // 2. Priorité aux POI à l'intérieur du polygone
      const inside = filtered.filter((place) => {
        const loc = place.geometry?.location;
        if (!loc) return false;
        return pointInPolygon(loc.lat(), loc.lng(), polygon);
      });

      let chosen: google.maps.places.PlaceResult;
      if (inside.length > 0) {
        chosen =
          inside.reduce((a, b) => {
            const distA = distanceToCentroid(
              a.geometry!.location!.lat(),
              a.geometry!.location!.lng(),
              centroid
            );
            const distB = distanceToCentroid(
              b.geometry!.location!.lat(),
              b.geometry!.location!.lng(),
              centroid
            );
            return distA <= distB ? a : b;
          });
      } else {
        chosen = filtered.reduce((a, b) => {
          const locA = a.geometry?.location;
          const locB = b.geometry?.location;
          if (!locA) return b;
          if (!locB) return a;
          const distA = distanceToCentroid(locA.lat(), locA.lng(), centroid);
          const distB = distanceToCentroid(locB.lat(), locB.lng(), centroid);
          return distA <= distB ? a : b;
        });
      }

      const name = chosen.name?.trim();
      if (!name) {
        resolve(null);
        return;
      }
      const loc = chosen.geometry?.location;
      resolve({
        name,
        placeId: chosen.place_id ?? undefined,
        coordinates: loc ? { lat: loc.lat(), lng: loc.lng() } : undefined,
      });
    });
  });
}

/** Bâtiment OSM minimal pour findNearestOsmBuildingToPoint */
export interface OsmBuildingForSearch {
  id: string;
  polygonSurfaces: Array<{
    polygon: Array<{ lat: number; lng: number }>;
    areaM2: number;
    orientation: number | null;
  }>;
}

/**
 * Trouve le bâtiment OSM le plus proche d'un point.
 * Priorité : polygone qui contient le point, sinon le centroïde le plus proche.
 */
export function findNearestOsmBuildingToPoint(
  point: { lat: number; lng: number },
  osmBuildings: OsmBuildingForSearch[]
): OsmBuildingForSearch | null {
  if (osmBuildings.length === 0) return null;

  let best: OsmBuildingForSearch | null = null;
  let bestDist = Infinity;
  let bestInside = false;

  for (const building of osmBuildings) {
    for (const surf of building.polygonSurfaces) {
      if (!surf.polygon || surf.polygon.length === 0) continue;
      const inside = pointInPolygon(point.lat, point.lng, surf.polygon);
      const centroid = polygonCentroid(surf.polygon);
      if (!centroid) continue;
      const dist = haversineMeters(point.lat, point.lng, centroid.lat, centroid.lng);
      const isBetter =
        inside && !bestInside
          ? true
          : inside && bestInside
            ? dist < bestDist
            : !inside && bestInside
              ? false
              : dist < bestDist;
      if (isBetter) {
        best = building;
        bestDist = dist;
        bestInside = inside;
      }
    }
  }

  return best;
}
