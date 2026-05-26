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

/** Bâtiment coché si son id `bc:` ou `osm:` est dans le filtre. */
export function isDiscoveryBuildingEntrySelected(
  selectedIds: ReadonlySet<string>,
  entry: V5BuildingsJsonEntry
): boolean {
  const primaryId = discoveryBuildingSelectionIdFromEntry(entry);
  if (primaryId && isDiscoveryBuildingSelected(selectedIds, primaryId)) return true;
  const osm = entry.osmBuildingId?.trim();
  if (osm && isDiscoveryBuildingSelected(selectedIds, `osm:${osm}`)) return true;
  const bc = entry.batimentConstructionId.trim();
  if (bc && bc !== "—" && isDiscoveryBuildingSelected(selectedIds, `bc:${bc}`)) return true;
  return false;
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

/** Filtre bâtiment actif (Set défini) vs « tous les bâtiments du combo » (`undefined`). */
export function isDiscoveryBuildingFilterActive(
  selectedIds: ReadonlySet<string> | null | undefined
): selectedIds is ReadonlySet<string> {
  return selectedIds != null;
}

/** Signature stable pour deps React (ordre des ids normalisé). */
export function discoveryBuildingSelectionSignature(
  ids: ReadonlySet<string> | undefined
): string {
  if (!ids || ids.size === 0) return "";
  return [...ids].sort().join("\u0001");
}

export function discoveryBuildingSelectionSetsEqual(
  a: ReadonlySet<string> | undefined,
  b: ReadonlySet<string> | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}
