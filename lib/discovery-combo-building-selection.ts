import type { V5BuildingsJsonEntry } from "@/lib/scout-matching-v5-map";

/** Clé stable pour inclure / exclure un bâtiment du combo personnalisé. */
export function discoveryBuildingSelectionIdFromEntry(entry: V5BuildingsJsonEntry): string {
  const bc = entry.batimentConstructionId.trim();
  if (bc && bc !== "—") return `bc:${bc}`;
  const osm = entry.osmBuildingId?.trim();
  if (osm) return `osm:${osm}`;
  return "";
}

export function discoveryBuildingSelectionIdFromFeature(feature: GeoJSON.Feature): string {
  const props = feature.properties as Record<string, unknown> | undefined;
  const bc = String(props?.batiment_construction_id ?? "").trim();
  if (bc && bc !== "—") return `bc:${bc}`;
  const osm = String(props?.osm_building_id ?? "").trim();
  if (osm) return `osm:${osm}`;
  return "";
}

export function isDiscoveryBuildingSelected(
  selectedIds: ReadonlySet<string>,
  selectionId: string
): boolean {
  if (!selectionId) return true;
  return selectedIds.has(selectionId);
}

export function toggleDiscoveryBuildingSelection(
  selectedIds: ReadonlySet<string>,
  selectionId: string
): Set<string> {
  const next = new Set(selectedIds);
  if (!selectionId) return next;
  if (next.has(selectionId)) next.delete(selectionId);
  else next.add(selectionId);
  return next;
}
