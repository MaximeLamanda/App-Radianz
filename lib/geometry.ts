import type { AddressCoordinates } from "@/types";
import type { Prospect } from "@/types";

/**
 * Calcule le centre (centroïde) d'un polygone à partir de ses sommets.
 */
export function getPolygonCenter(
  coordinates: Array<{ lat: number; lng: number }>
): AddressCoordinates | null {
  if (!coordinates || coordinates.length < 1) return null;
  const latSum = coordinates.reduce((sum, c) => sum + c.lat, 0);
  const lngSum = coordinates.reduce((sum, c) => sum + c.lng, 0);
  return {
    lat: latSum / coordinates.length,
    lng: lngSum / coordinates.length,
  };
}

/**
 * Retourne les coordonnées du centre de la forme dessinée (polygone(s) de toit)
 * pour l'aperçu satellite. Si des surfaces sont définies, utilise leur centroïde ;
 * sinon utilise les coordonnées de l'adresse.
 */
export function getProspectImageCenter(prospect: Prospect): AddressCoordinates {
  const surfaces = prospect.roofSurfaces ?? (prospect.roofSurface ? [prospect.roofSurface] : []);
  const allPoints: Array<{ lat: number; lng: number }> = [];
  for (const s of surfaces) {
    if (s?.polygon?.length) {
      allPoints.push(...s.polygon);
    }
  }
  const center = allPoints.length >= 1 ? getPolygonCenter(allPoints) : null;
  return center ?? prospect.coordinates;
}
