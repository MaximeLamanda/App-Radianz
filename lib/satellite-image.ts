import type { AddressCoordinates } from "@/types";

/**
 * Génère l’URL d’une image statique via Maps Static API.
 *
 * En EEA (ex. France), depuis le 8 juillet 2025, satellite/hybrid ne sont plus
 * disponibles pour Maps Static API. On n’utilise donc que maptype=roadmap pour
 * l’image statique. La vue satellite reste disponible sur la carte interactive
 * (Maps JavaScript API).
 */
export function getSatelliteImageUrl(
  coordinates: AddressCoordinates,
  _address: string,
  width: number = 400,
  height: number = 300,
  zoom: number = 20,
  mapType: "satellite" | "hybrid" | "roadmap" = "roadmap"
): string {
  if (!coordinates?.lat || !coordinates?.lng) return "";
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key?.trim()) return "";

  // EEA : Static API ne fournit que roadmap pour l’image statique
  const staticMapType = mapType === "satellite" || mapType === "hybrid" ? "roadmap" : mapType;

  const lat = Number(coordinates.lat.toFixed(4));
  const lng = Number(coordinates.lng.toFixed(4));
  const base = "https://maps.googleapis.com/maps/api/staticmap";
  return `${base}?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&maptype=${staticMapType}&key=${key}`;
}
