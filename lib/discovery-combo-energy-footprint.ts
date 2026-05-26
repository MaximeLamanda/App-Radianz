/**
 * Empreinte building unique pour dimensionnement PV, graphes prod/conso et pipeline Discovery.
 * Alignée table bâtiments (Σ cochés) · hero · onglet Solaire.
 */

import { discoveryComboFootprintSumM2 } from "@/lib/discovery-combo-building-labels";
import type { DiscoveryComboSqlSurfaceHint } from "@/lib/discovery-combo-hero-surfaces";
import {
  footprintSumTotalFromV5,
  getParcelleClusterForV5,
} from "@/lib/matching-v5-to-prospect";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";

export type ResolveDiscoveryComboEnergyFootprintInput = {
  anchorRow: ScoutMatchingV5Row;
  parcelleRows: readonly ScoutMatchingV5Row[];
  /** Filtre bâtiment actif (`Set`) vs tous les bâtiments (`undefined`). */
  selectedBuildingIds?: ReadonlySet<string> | null;
  sqlHint?: DiscoveryComboSqlSurfaceHint | null;
  /** `footprint_sum_m2` overview SQL / marqueur — repli combo complet uniquement. */
  comboFootprintFromOverview?: number;
};

/**
 * Surface (m²) pour consommation, kWp et production après dimensionnement.
 *
 * 1. Filtre bâtiment actif → Σ empreintes des bâtiments cochés (même logique que la table).
 * 2. Sinon → dédup BC sur les parcelles chargées, puis hint SQL si cluster incomplet, puis overview.
 */
export function resolveDiscoveryComboEnergyFootprintM2(
  input: ResolveDiscoveryComboEnergyFootprintInput
): number {
  const cluster = getParcelleClusterForV5(input.anchorRow, [...input.parcelleRows]);

  const filtered = discoveryComboFootprintSumM2(
    cluster,
    input.anchorRow,
    input.selectedBuildingIds
  );
  if (filtered != null) {
    return filtered;
  }

  const fromRows = footprintSumTotalFromV5(input.anchorRow, cluster);
  const hint = input.sqlHint;
  const parcellesIncomplete =
    hint != null &&
    hint.expectedParcelleCount > 0 &&
    cluster.length < hint.expectedParcelleCount;

  if (parcellesIncomplete && hint.footprintSumM2 > 0) {
    return hint.footprintSumM2;
  }
  if (fromRows > 0) return fromRows;

  const overview = input.comboFootprintFromOverview;
  if (overview != null && overview > 0) return overview;

  if (hint != null && hint.footprintSumM2 > 0) return hint.footprintSumM2;
  return fromRows;
}
