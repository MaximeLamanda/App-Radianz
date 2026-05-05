import type { Prospect } from "@/types";

/** Paramètres d’URL pour centrer la Découverte sur une emprise pipeline (matching V5). */
export const DISCOVERY_FOCUS_QUERY = {
  focusRow: "focusRow",
  lat: "lat",
  lng: "lng",
} as const;

/**
 * Lien vers `/discovery` avec focus carte + sélection de ligne quand le prospect vient du matching V5.
 * Retourne `null` si les données ne permettent pas un focus fiable.
 */
export function buildDiscoveryFocusHref(prospect: Prospect): string | null {
  if (prospect.pipelineEntrySource !== "discovery_v5") return null;
  const rowId = String(prospect.matchingV5RowId ?? "").trim();
  if (!rowId) return null;
  const { lat, lng } = prospect.coordinates ?? {};
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const q = new URLSearchParams();
  q.set(DISCOVERY_FOCUS_QUERY.focusRow, rowId);
  q.set(DISCOVERY_FOCUS_QUERY.lat, String(lat));
  q.set(DISCOVERY_FOCUS_QUERY.lng, String(lng));
  return `/discovery?${q.toString()}`;
}
