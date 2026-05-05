import type { Prospect } from "@/types";
import {
  findMatchingV5LinkedParcelleRowsTransitive,
  findMatchingV5ParcelleRowsForBuilding,
  type ScoutMatchingV5Row,
} from "@/lib/scout-matching-v5-map";

/**
 * Parcelles liées pour surbrillance / tiroir (même règle que `app/discovery/page.tsx`).
 */
export function linkedParcelleRowsForV5DrawerAnchor(
  anchor: ScoutMatchingV5Row,
  allRows: ScoutMatchingV5Row[]
): ScoutMatchingV5Row[] {
  if (anchor.grain === "building") {
    return findMatchingV5ParcelleRowsForBuilding(anchor, allRows);
  }
  return findMatchingV5LinkedParcelleRowsTransitive(anchor, allRows);
}

/**
 * La sélection courante en Découverte correspond-elle au prospect pipeline (matching V5) ?
 */
export function matchingV5SelectionMatchesProspect(
  anchor: ScoutMatchingV5Row,
  linkedParcellesForAnchor: ScoutMatchingV5Row[],
  allRows: ScoutMatchingV5Row[],
  prospect: Pick<Prospect, "pipelineEntrySource" | "matchingV5RowId">
): boolean {
  if (prospect.pipelineEntrySource !== "discovery_v5") return false;
  const sid = prospect.matchingV5RowId;
  if (!sid) return false;
  if (anchor.id === sid) return true;
  if (linkedParcellesForAnchor.some((r) => r.id === sid)) return true;

  const storedRow = allRows.find((r) => r.id === sid);
  if (!storedRow) return false;

  if (storedRow.grain === "building" && anchor.grain === "parcelle") {
    const forStored = findMatchingV5ParcelleRowsForBuilding(storedRow, allRows);
    if (forStored.some((p) => p.id === anchor.id)) return true;
    if (linkedParcellesForAnchor.some((p) => forStored.some((x) => x.id === p.id))) return true;
  }
  if (storedRow.grain === "parcelle" && anchor.grain === "building") {
    const forAnchor = findMatchingV5ParcelleRowsForBuilding(anchor, allRows);
    if (forAnchor.some((p) => p.id === storedRow.id)) return true;
  }
  return false;
}
