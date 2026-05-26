import type { DiscoveryComboMarker } from "@/lib/discovery-combo-markers";

/** IDs parcelles du combo SQL (overview), si connus sur le marqueur. */
export function parcelleScoutV5IdsFromComboMarker(
  comboId: string | null | undefined,
  markers: readonly DiscoveryComboMarker[]
): string[] | null {
  const cid = comboId?.trim();
  if (!cid) return null;
  const marker = markers.find((m) => m.comboId === cid);
  const ids = marker?.parcelleScoutV5Ids?.map((s) => s.trim()).filter(Boolean) ?? [];
  return ids.length > 0 ? ids : null;
}
