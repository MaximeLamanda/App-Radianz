import { buildParcelleComboIndex, resolveComboMarkerSelection } from "@/lib/discovery-combo-markers";
import type { DiscoveryComboMarker, DiscoveryComboSelection } from "@/lib/discovery-combo-markers";
import { legacyComboIdFromProspect } from "@/lib/discovery-pipeline-match";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";
import type { Prospect } from "@/types";

/** Paramètres d’URL pour centrer la Découverte sur une emprise pipeline (matching V5). */
export const DISCOVERY_FOCUS_QUERY = {
  focusRow: "focusRow",
  focusCombo: "focusCombo",
  lat: "lat",
  lng: "lng",
} as const;

/**
 * Combo à sélectionner après deep link : paramètre URL, sinon index parcelle, sinon marqueur.
 */
export function comboIdForDiscoveryFocusRow(
  rowId: string,
  rows: readonly ScoutMatchingV5Row[],
  markers: readonly DiscoveryComboMarker[]
): string | null {
  const trimmed = rowId.trim();
  if (!trimmed) return null;
  const fromMarker = markers.find(
    (m) =>
      m.anchorParcelleId === trimmed || (m.parcelleScoutV5Ids?.includes(trimmed) ?? false)
  );
  if (fromMarker?.comboId) return fromMarker.comboId;
  return buildParcelleComboIndex(rows).get(trimmed) ?? null;
}

/**
 * Sélection carte (combo + ancre + bâtiment OSM) pour un focus URL pipeline.
 */
export function selectionFromDiscoveryUrlFocus(args: {
  focusComboId: string | null;
  focusRowId: string | null;
  rows: readonly ScoutMatchingV5Row[];
  markers: readonly DiscoveryComboMarker[];
}): DiscoveryComboSelection | null {
  const comboFromUrl = args.focusComboId?.trim() || null;
  const rowId = args.focusRowId?.trim() || null;
  const comboId =
    comboFromUrl ||
    (rowId ? comboIdForDiscoveryFocusRow(rowId, args.rows, args.markers) : null);
  if (!comboId) return null;
  const fromMarker = resolveComboMarkerSelection(comboId, args.markers);
  if (fromMarker) return fromMarker;
  if (!rowId || !args.rows.some((r) => r.id === rowId)) return null;
  return {
    comboId,
    anchorParcelleId: rowId,
    representativeOsmBuildingId: "",
  };
}

/**
 * Lien vers `/discovery` avec focus carte + sélection combo quand le prospect vient du matching V5.
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
  const comboId = legacyComboIdFromProspect(prospect);
  if (comboId) q.set(DISCOVERY_FOCUS_QUERY.focusCombo, comboId);
  q.set(DISCOVERY_FOCUS_QUERY.lat, String(lat));
  q.set(DISCOVERY_FOCUS_QUERY.lng, String(lng));
  return `/discovery?${q.toString()}`;
}
