import type { AddressCoordinates } from "@/types";

/**
 * URL d’image statique Mapbox (satellite ou streets).
 * Utilisable en EEA pour avoir une vraie vue satellite dans les previews.
 */
export function getMapboxStaticUrl(
  coordinates: AddressCoordinates,
  width: number = 400,
  height: number = 300,
  zoom: number = 15,
  style: "satellite-v9" | "streets-v12" = "satellite-v9"
): string {
  if (!coordinates?.lat || !coordinates?.lng) return "";
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();
  if (!token) return "";

  const lng = Number(coordinates.lng.toFixed(6));
  const lat = Number(coordinates.lat.toFixed(6));
  const w = Math.min(1280, Math.max(1, width));
  const h = Math.min(1280, Math.max(1, height));
  const z = Math.min(22, Math.max(0, Math.round(zoom)));

  return `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${lng},${lat},${z}/${w}x${h}?access_token=${token}`;
}

export function hasMapboxToken(): boolean {
  return !!process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();
}
