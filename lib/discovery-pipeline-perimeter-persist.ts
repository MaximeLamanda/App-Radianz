import { comboIdFromParcelleIds } from "@/lib/discovery-combo-markers";
import { getParcelleClusterForV5, type ScoutMatchingV5Row } from "@/lib/matching-v5-to-prospect";

/** Champs Firebase à mettre à jour quand le périmètre parcelle/bâtiment change en Découverte. */
export function discoveryPipelinePerimeterPersistFields(
  anchor: ScoutMatchingV5Row,
  linkedParcelleRows: readonly ScoutMatchingV5Row[],
  options?: { fallbackComboId?: string | null }
): {
  matchingV5ParcelleIds: string[];
  matchingV5ComboId: string | null;
} {
  const cluster = getParcelleClusterForV5(anchor, [...linkedParcelleRows]);
  const matchingV5ParcelleIds = cluster.map((r) => r.id);
  const matchingV5ComboId =
    matchingV5ParcelleIds.length > 0
      ? comboIdFromParcelleIds(matchingV5ParcelleIds)
      : options?.fallbackComboId?.trim() || null;
  return { matchingV5ParcelleIds, matchingV5ComboId };
}
