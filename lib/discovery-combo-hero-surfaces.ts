import { resolveDiscoveryComboEnergyFootprintM2 } from "@/lib/discovery-combo-energy-footprint";
import {
  getParcelleClusterForV5,
  parcelContourAreaM2FromV5Row,
} from "@/lib/matching-v5-to-prospect";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";

export type DiscoveryComboSqlSurfaceHint = {
  footprintSumM2: number;
  parcelContourSumM2: number;
  /** Nombre de parcelles du combo SQL (`parcelle_scout_v5_ids`). */
  expectedParcelleCount: number;
};

export function discoveryComboHeroSurfaces(input: {
  anchorRow: ScoutMatchingV5Row;
  parcelleRows: readonly ScoutMatchingV5Row[];
  selectedBuildingIds?: ReadonlySet<string> | null;
  sqlHint?: DiscoveryComboSqlSurfaceHint | null;
  comboFootprintFromOverview?: number;
}): { footprintM2: number; parcelM2: number } {
  const cluster = getParcelleClusterForV5(input.anchorRow, [...input.parcelleRows]);
  const parcelFromRows = parcelContourAreaM2FromV5Row(input.anchorRow, cluster);

  const hint = input.sqlHint;
  const parcellesIncomplete =
    hint != null &&
    hint.expectedParcelleCount > 0 &&
    cluster.length < hint.expectedParcelleCount;

  const footprintM2 = resolveDiscoveryComboEnergyFootprintM2({
    anchorRow: input.anchorRow,
    parcelleRows: input.parcelleRows,
    selectedBuildingIds: input.selectedBuildingIds,
    sqlHint: input.sqlHint,
    comboFootprintFromOverview: input.comboFootprintFromOverview,
  });

  const parcelM2 =
    parcellesIncomplete && hint != null && hint.parcelContourSumM2 > 0
      ? hint.parcelContourSumM2
      : parcelFromRows;

  return { footprintM2, parcelM2 };
}

/** Σ empreintes building du combo (sans filtre bâtiment) — repli SQL / overview si besoin. */
export function discoveryComboBuildingFootprintM2(
  input: Omit<Parameters<typeof discoveryComboHeroSurfaces>[0], "selectedBuildingIds">
): number {
  return discoveryComboHeroSurfaces({ ...input, selectedBuildingIds: undefined }).footprintM2;
}
