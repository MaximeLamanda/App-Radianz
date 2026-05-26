import {
  findMatchingV5LinkedParcelleRowsTransitive,
  sortMatchingV5ParcelleRowsByCadastre,
  type ScoutMatchingV5Row,
} from "@/lib/scout-matching-v5-map";

export type DiscoveryComboParcelleEditState = {
  customParcelleIds: ReadonlySet<string>;
  removedParcelleIds: ReadonlySet<string>;
};

export function emptyDiscoveryComboParcelleEditState(): DiscoveryComboParcelleEditState {
  return { customParcelleIds: new Set(), removedParcelleIds: new Set() };
}

export function cloneDiscoveryComboParcelleEditState(
  edit: DiscoveryComboParcelleEditState
): DiscoveryComboParcelleEditState {
  return {
    customParcelleIds: new Set(edit.customParcelleIds),
    removedParcelleIds: new Set(edit.removedParcelleIds),
  };
}

/**
 * Reconstruit l’état d’édition à partir du périmètre persisté en pipeline
 * (`matchingV5ParcelleIds`) vs le cluster matching d’origine.
 */
export function parcelleEditStateFromPersistedParcelleIds(
  persistedParcelleIds: readonly string[],
  matchingLinkedParcelleIds: readonly string[]
): DiscoveryComboParcelleEditState {
  const matching = new Set(
    matchingLinkedParcelleIds.map((id) => id.trim()).filter(Boolean)
  );
  const persisted = new Set(
    persistedParcelleIds.map((id) => id.trim()).filter(Boolean)
  );
  const customParcelleIds = new Set<string>();
  const removedParcelleIds = new Set<string>();
  for (const id of persisted) {
    if (!matching.has(id)) customParcelleIds.add(id);
  }
  for (const id of matching) {
    if (!persisted.has(id)) removedParcelleIds.add(id);
  }
  return { customParcelleIds, removedParcelleIds };
}

/**
 * Identifiants parcelle à ajouter quand l’utilisateur sélectionne une parcelle (fusion combo si partage).
 */
export function parcelleIdsForComboMerge(
  parcelleId: string,
  allRows: ScoutMatchingV5Row[]
): string[] {
  const id = parcelleId.trim();
  if (!id) return [];
  const row = allRows.find((r) => r.id === id);
  if (!row || row.grain !== "parcelle") return [id];
  return findMatchingV5LinkedParcelleRowsTransitive(row, allRows).map((r) => r.id);
}

/**
 * Parcelles affichées / agrégées : cluster matching ± édition session.
 */
export function resolveDiscoveryEffectiveParcelleRows(
  matchingLinkedRows: readonly ScoutMatchingV5Row[],
  allRows: readonly ScoutMatchingV5Row[],
  edit: DiscoveryComboParcelleEditState
): ScoutMatchingV5Row[] {
  const idToRow = new Map(allRows.filter((r) => r.grain === "parcelle").map((r) => [r.id, r]));
  const ids = new Set<string>();

  for (const r of matchingLinkedRows) {
    if (r.grain === "parcelle" && !edit.removedParcelleIds.has(r.id)) {
      ids.add(r.id);
    }
  }
  for (const pid of Array.from(edit.customParcelleIds)) {
    if (!edit.removedParcelleIds.has(pid)) ids.add(pid);
  }

  const rows: ScoutMatchingV5Row[] = [];
  for (const id of Array.from(ids)) {
    const row = idToRow.get(id);
    if (row) rows.push(row);
  }
  return sortMatchingV5ParcelleRowsByCadastre(rows);
}

/**
 * Bascule inclusion d’une parcelle en mode édition (ajout = fusion combo si nécessaire).
 */
export function applyDiscoveryParcelleEditToggle(
  edit: DiscoveryComboParcelleEditState,
  effectiveParcelleIds: ReadonlySet<string>,
  allRows: ScoutMatchingV5Row[],
  parcelleId: string,
  include: boolean,
  mergeIdsOverride?: readonly string[]
): DiscoveryComboParcelleEditState {
  const custom = new Set(edit.customParcelleIds);
  const removed = new Set(edit.removedParcelleIds);

  if (include) {
    const mergeIds =
      mergeIdsOverride && mergeIdsOverride.length > 0
        ? [...mergeIdsOverride]
        : parcelleIdsForComboMerge(parcelleId, allRows);
    const alreadyEffective = mergeIds.every((id) => effectiveParcelleIds.has(id));
    if (alreadyEffective) return edit;

    for (const id of mergeIds) {
      removed.delete(id);
      if (!effectiveParcelleIds.has(id)) {
        custom.add(id);
      }
    }
    return { customParcelleIds: custom, removedParcelleIds: removed };
  }

  const targetIds =
    effectiveParcelleIds.has(parcelleId) && !custom.has(parcelleId)
      ? [parcelleId]
      : parcelleIdsForComboMerge(parcelleId, allRows).filter((id) => effectiveParcelleIds.has(id));

  for (const id of targetIds.length > 0 ? targetIds : [parcelleId]) {
    custom.delete(id);
    removed.add(id);
  }
  return { customParcelleIds: custom, removedParcelleIds: removed };
}
