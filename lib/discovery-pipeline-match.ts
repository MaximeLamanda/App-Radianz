import { comboIdFromParcelleIds } from "@/lib/discovery-combo-markers";
import type { Prospect } from "@/types";
import {
  findMatchingV5LinkedParcelleRowsTransitive,
  findMatchingV5ParcelleRowsForBuilding,
  type ScoutMatchingV5Row,
} from "@/lib/scout-matching-v5-map";

/**
 * Rattachement prospect pipeline ↔ combo Discovery : lookup strict par `matchingV5ComboId`
 * (`findDiscoveryProspectByComboId`), pas par parcelle partagée.
 *
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

/** Parcelles du combo persisté en pipeline, sinon cluster matching autour de l’ancre. */
export function parcelleRowsForDiscoveryProspect(
  prospect: Pick<Prospect, "matchingV5ParcelleIds">,
  anchor: ScoutMatchingV5Row,
  allRows: ScoutMatchingV5Row[]
): ScoutMatchingV5Row[] {
  const ids = prospect.matchingV5ParcelleIds?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (ids.length === 0) return linkedParcelleRowsForV5DrawerAnchor(anchor, allRows);
  const rows: ScoutMatchingV5Row[] = [];
  for (const id of ids) {
    const r = allRows.find((x) => x.id === id && x.grain === "parcelle");
    if (r) rows.push(r);
  }
  return rows.length > 0 ? rows : linkedParcelleRowsForV5DrawerAnchor(anchor, allRows);
}

/** IDs bâtiments cochés à l’ajout pipeline (`undefined` = tous cochés par défaut). */
export function buildingSelectionIdsForDiscoveryProspect(
  prospect: Pick<Prospect, "matchingV5BuildingSelectionIds">
): string[] | undefined {
  const ids = prospect.matchingV5BuildingSelectionIds?.map((s) => s.trim()).filter(Boolean) ?? [];
  return ids.length > 0 ? ids : undefined;
}

/** Clé combo pour lookup pipeline : champ explicite ou dérivé des parcelles persistées. */
export function legacyComboIdFromProspect(
  p: Pick<Prospect, "matchingV5ComboId" | "matchingV5ParcelleIds">
): string | null {
  const direct = p.matchingV5ComboId?.trim();
  if (direct) return direct;
  const ids = p.matchingV5ParcelleIds?.map((s) => s.trim()).filter(Boolean) ?? [];
  return ids.length > 0 ? comboIdFromParcelleIds(ids) : null;
}

/** Prospect Discovery en pipeline pour ce combo (`matchingV5ComboId` strict). Premier trouvé en cas de doublon. */
export function findDiscoveryProspectByComboId(
  comboId: string | null | undefined,
  prospects: readonly Prospect[]
): Prospect | null {
  const cid = comboId?.trim();
  if (!cid) return null;
  for (const p of prospects) {
    if (p.pipelineEntrySource !== "discovery_v5") continue;
    const key = legacyComboIdFromProspect(p);
    if (key === cid) return p;
  }
  return null;
}

/**
 * La sélection courante en Découverte correspond-elle au prospect pipeline (matching V5) ?
 * @deprecated Préférer `findDiscoveryProspectByComboId` (évite faux positifs parcelle partagée).
 */
function parcelleIdsMatchKey(ids: readonly string[]): string {
  return [...ids]
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join("|");
}

export function matchingV5SelectionMatchesProspect(
  anchor: ScoutMatchingV5Row,
  linkedParcellesForAnchor: ScoutMatchingV5Row[],
  allRows: ScoutMatchingV5Row[],
  prospect: Pick<
    Prospect,
    "pipelineEntrySource" | "matchingV5RowId" | "matchingV5ParcelleIds"
  >,
  options?: { effectiveParcelleIds?: readonly string[] }
): boolean {
  if (prospect.pipelineEntrySource !== "discovery_v5") return false;
  const persisted = prospect.matchingV5ParcelleIds?.filter(Boolean) ?? [];
  if (persisted.length > 0) {
    const currentIds =
      options?.effectiveParcelleIds?.length
        ? options.effectiveParcelleIds
        : linkedParcellesForAnchor.map((r) => r.id);
    const persistedKey = parcelleIdsMatchKey(persisted);
    const currentKey = parcelleIdsMatchKey(currentIds);
    if (persistedKey === currentKey) return true;
    if (persisted.includes(anchor.id)) return true;
    if (currentIds.includes(anchor.id)) return true;
  }
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
