import type { DiscoveryBuildingPoint } from "@/lib/discovery-buildings-mv";
import { zoneTagsFromMatchingV5Row } from "@/lib/discovery-osm-activity-tags";

function constructionYearsFromParcelleRows(rows: readonly ScoutMatchingV5Row[]): number[] {
  const years = new Set<number>();
  for (const r of rows) {
    for (const b of parseMatchingV5BuildingsJson(r.buildingsJson)) {
      const y = b.anneeConstruction;
      if (y != null && Number.isFinite(y) && y >= 1000 && y <= 2100) years.add(Math.trunc(y));
    }
  }
  return [...years].sort((a, b) => a - b);
}
import {
  discoverySurfaceHiEffective,
  isDiscoverySurfaceFilterDisabled,
} from "@/lib/discovery-footprint-landuse-waiver";
import { footprintSumTotalFromV5 } from "@/lib/matching-v5-to-prospect";
import {
  collectPartageBatimentConstructionIds,
  listValidOsmBuildingIdsInBuildingGeometriesJson,
  listValidOsmBuildingIdsInBuildingsJson,
  parseMatchingV5BuildingsJson,
  sortMatchingV5ParcelleRowsByCadastre,
  type ScoutMatchingV5Row,
} from "@/lib/scout-matching-v5-map";

export type DiscoveryComboMarker = {
  comboId: string;
  position: { lat: number; lng: number };
  anchorParcelleId: string;
  /** Parcelles du combo (`scout_matching_v5_combos.parcelle_scout_v5_ids`), si overview SQL. */
  parcelleScoutV5Ids?: string[];
  osmBuildingIds: string[];
  /** Σ empreintes OSM du combo (aligné tiroir `footprintSumTotalFromV5`). */
  footprintSumM2: number;
  /** Σ contours parcelle (`parcel_contour_sum_m2`), si overview SQL. */
  parcelContourSumM2?: number;
  /** Tags activité OSM agrégés (table `scout_matching_v5_combos.zone_tags`). */
  zoneTags: string[];
  /** Années de construction connues (table `scout_matching_v5_combos.construction_years`). */
  constructionYears: number[];
  /** Divisions NAF 2 chiffres (`scout_matching_v5_combos.naf_divisions`). */
  nafDivisions: string[];
};

export type DiscoveryComboSelection = {
  comboId: string;
  anchorParcelleId: string;
  representativeOsmBuildingId: string;
};

/** Identifiant stable d’un combo = ensemble de parcelles (tri lexicographic sur scout_v5_id). */
export function comboIdFromParcelleIds(parcelleIds: readonly string[]): string {
  const sorted = [...parcelleIds]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort((a, b) => a.localeCompare(b));
  if (sorted.length === 0) return "";
  return `combo:${sorted.join("|")}`;
}

/**
 * Index `parcelle scout_v5_id → comboId` (composantes connexes « partage », sinon singleton).
 * Aligné sur `findMatchingV5LinkedParcelleRowsTransitive`.
 */
export function buildParcelleComboIndex(
  rows: readonly ScoutMatchingV5Row[]
): Map<string, string> {
  const parcelleRows = rows.filter((r) => r.grain === "parcelle");
  const partageByParcelId = new Map<string, Set<string>>();
  for (const r of parcelleRows) {
    partageByParcelId.set(r.id, collectPartageBatimentConstructionIds(r));
  }

  const bidToParcelIds = new Map<string, Set<string>>();
  for (const r of parcelleRows) {
    const bids = partageByParcelId.get(r.id);
    if (!bids) continue;
    for (const bid of bids) {
      if (!bidToParcelIds.has(bid)) bidToParcelIds.set(bid, new Set());
      bidToParcelIds.get(bid)!.add(r.id);
    }
  }

  const parcelleToCombo = new Map<string, string>();
  const visited = new Set<string>();

  for (const r of parcelleRows) {
    if (visited.has(r.id)) continue;
    const partage = partageByParcelId.get(r.id);
    if (!partage || partage.size === 0) {
      visited.add(r.id);
      parcelleToCombo.set(r.id, comboIdFromParcelleIds([r.id]));
      continue;
    }
    const component = new Set<string>();
    const stack = [r.id];
    while (stack.length > 0) {
      const pid = stack.pop()!;
      if (visited.has(pid)) continue;
      visited.add(pid);
      component.add(pid);
      const bids = partageByParcelId.get(pid);
      if (!bids) continue;
      for (const bid of bids) {
        const neigh = bidToParcelIds.get(bid);
        if (!neigh) continue;
        for (const nid of neigh) {
          if (!visited.has(nid)) stack.push(nid);
        }
      }
    }
    const comboId = comboIdFromParcelleIds([...component]);
    for (const pid of component) parcelleToCombo.set(pid, comboId);
  }

  return parcelleToCombo;
}

function buildComboToParcelleIds(parcelleToCombo: Map<string, string>): Map<string, string[]> {
  const comboToParcelles = new Map<string, string[]>();
  for (const [pid, cid] of parcelleToCombo) {
    const list = comboToParcelles.get(cid);
    if (list) list.push(pid);
    else comboToParcelles.set(cid, [pid]);
  }
  return comboToParcelles;
}

function registerOsmCombo(
  osmToCombo: Map<string, string>,
  osmId: string,
  comboId: string
): void {
  const prev = osmToCombo.get(osmId);
  if (!prev) {
    osmToCombo.set(osmId, comboId);
    return;
  }
  if (prev !== comboId && comboId.localeCompare(prev) < 0) {
    osmToCombo.set(osmId, comboId);
  }
}

function buildOsmBuildingToComboId(
  parcelleRows: readonly ScoutMatchingV5Row[],
  parcelleToCombo: Map<string, string>
): Map<string, string> {
  const osmToCombo = new Map<string, string>();
  for (const row of parcelleRows) {
    const comboId = parcelleToCombo.get(row.id);
    if (!comboId) continue;
    for (const osmId of listValidOsmBuildingIdsInBuildingGeometriesJson(
      row.buildingGeometriesJson
    )) {
      registerOsmCombo(osmToCombo, osmId, comboId);
    }
    for (const osmId of listValidOsmBuildingIdsInBuildingsJson(row.buildingsJson)) {
      registerOsmCombo(osmToCombo, osmId, comboId);
    }
  }
  return osmToCombo;
}

/** Résout le combo d’un point overview (MV parcelles + index partage des features). */
export function comboIdForBuildingPoint(
  osmBuildingId: string,
  parcelleScoutV5Ids: readonly string[],
  parcelleToCombo: Map<string, string>,
  osmToCombo: Map<string, string>
): string {
  const fromOsm = osmToCombo.get(osmBuildingId);
  if (fromOsm) return fromOsm;
  if (parcelleScoutV5Ids.length > 0) {
    const comboIds = new Set(
      parcelleScoutV5Ids
        .map((pid) => parcelleToCombo.get(pid))
        .filter((c): c is string => Boolean(c))
    );
    if (comboIds.size === 1) return [...comboIds][0]!;
    const parcelleKeys = [...new Set(parcelleScoutV5Ids)].sort((a, b) => a.localeCompare(b));
    return comboIdFromParcelleIds(parcelleKeys);
  }
  return osmBuildingId;
}

function anchorParcelleIdForCombo(
  comboId: string,
  comboToParcelles: Map<string, string[]>,
  idToRow: Map<string, ScoutMatchingV5Row>
): string {
  const parcelleIds = comboToParcelles.get(comboId) ?? [];
  const parcelleRowsForCombo = parcelleIds
    .map((id) => idToRow.get(id))
    .filter((r): r is ScoutMatchingV5Row => r != null);
  if (parcelleRowsForCombo.length === 0) return "";
  return sortMatchingV5ParcelleRowsByCadastre(parcelleRowsForCombo)[0]!.id;
}

/** Parcelles du combo (tri cadastral), pour surface agrégée et filtres. */
function zoneTagsForParcelleRows(rows: readonly ScoutMatchingV5Row[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    for (const tag of zoneTagsFromMatchingV5Row(r)) out.add(tag);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export function parcelleRowsForComboId(
  comboId: string,
  rows: readonly ScoutMatchingV5Row[]
): ScoutMatchingV5Row[] {
  const parcelleToCombo = buildParcelleComboIndex(rows);
  const comboToParcelles = buildComboToParcelleIds(parcelleToCombo);
  const parcelleIds = comboToParcelles.get(comboId) ?? [];
  if (parcelleIds.length === 0 && comboId.startsWith("combo:")) {
    const ids = comboId.slice("combo:".length).split("|").filter(Boolean);
    const idToRow = new Map(
      rows.filter((r) => r.grain === "parcelle").map((r) => [r.id, r])
    );
    return sortMatchingV5ParcelleRowsByCadastre(
      ids.map((id) => idToRow.get(id)).filter((r): r is ScoutMatchingV5Row => r != null)
    );
  }
  const idToRow = new Map(rows.filter((r) => r.grain === "parcelle").map((r) => [r.id, r]));
  return sortMatchingV5ParcelleRowsByCadastre(
    parcelleIds.map((id) => idToRow.get(id)).filter((r): r is ScoutMatchingV5Row => r != null)
  );
}

function comboFootprintSumM2FromOsmPoints(
  osmBuildingIds: readonly string[],
  buildingPoints: readonly DiscoveryBuildingPoint[]
): number {
  const byOsm = new Map(buildingPoints.map((p) => [p.osmBuildingId, p]));
  let sum = 0;
  for (const osmId of osmBuildingIds) {
    const fp = byOsm.get(osmId)?.footprintM2;
    if (fp != null && Number.isFinite(fp) && fp > 0) sum += fp;
  }
  return sum;
}

/**
 * Surface building du combo : même logique que le tiroir (`footprintSumTotalFromV5`),
 * repli Σ `footprint_m2` des points overview si pas de parcelles en features.
 */
export function discoveryComboFootprintSumM2(
  marker: DiscoveryComboMarker,
  rows: readonly ScoutMatchingV5Row[],
  buildingPoints: readonly DiscoveryBuildingPoint[]
): number {
  const parcelleRows = parcelleRowsForComboId(marker.comboId, rows);
  if (parcelleRows.length > 0) {
    return footprintSumTotalFromV5(parcelleRows[0]!, parcelleRows);
  }
  return comboFootprintSumM2FromOsmPoints(marker.osmBuildingIds, buildingPoints);
}

/** Filtre surface sur la somme d’empreintes du combo (pas par bâtiment isolé). */
export function comboMeetsDiscoverySurfaceRange(
  marker: DiscoveryComboMarker,
  rows: readonly ScoutMatchingV5Row[],
  buildingPoints: readonly DiscoveryBuildingPoint[],
  minM2: number,
  hiEffective: number
): boolean {
  if (minM2 <= 0 && hiEffective === Number.POSITIVE_INFINITY) return true;
  const sum = discoveryComboFootprintSumM2(marker, rows, buildingPoints);
  if (minM2 > 0 && sum <= minM2) return false;
  if (Number.isFinite(hiEffective) && sum > hiEffective) return false;
  return true;
}

export function filterDiscoveryComboMarkersBySurface(
  markers: readonly DiscoveryComboMarker[],
  rows: readonly ScoutMatchingV5Row[],
  buildingPoints: readonly DiscoveryBuildingPoint[],
  minM2: number,
  maxM2: number,
  sliderMaxM2?: number
): DiscoveryComboMarker[] {
  if (isDiscoverySurfaceFilterDisabled(minM2, maxM2, sliderMaxM2)) return [...markers];
  const hiEffective = discoverySurfaceHiEffective(maxM2, sliderMaxM2);
  return markers.filter((m) =>
    comboMeetsDiscoverySurfaceRange(m, rows, buildingPoints, minM2, hiEffective)
  );
}

/**
 * Un marqueur par combo (centroïde des buildingPoints du groupe).
 * Fallback sans `rows` : 1 marqueur / `osm_building_id` (chargement initial).
 */
export function buildDiscoveryComboMarkers(
  rows: readonly ScoutMatchingV5Row[],
  buildingPoints: readonly DiscoveryBuildingPoint[]
): DiscoveryComboMarker[] {
  if (rows.length === 0) {
    return buildingPoints.map((p) => {
      const comboId = comboIdFromParcelleIds(p.parcelleScoutV5Ids) || p.osmBuildingId;
      const osmBuildingIds = [p.osmBuildingId];
      const footprintSumM2 = comboFootprintSumM2FromOsmPoints(osmBuildingIds, buildingPoints);
      return {
        comboId,
        position: { lat: p.position.lat, lng: p.position.lng },
        anchorParcelleId: p.parcelleScoutV5Ids[0] ?? "",
        osmBuildingIds,
        footprintSumM2,
        zoneTags: [],
        constructionYears: [],
        nafDivisions: [],
      };
    });
  }

  const parcelleRows = rows.filter((r) => r.grain === "parcelle");
  const parcelleToCombo = buildParcelleComboIndex(rows);
  const comboToParcelles = buildComboToParcelleIds(parcelleToCombo);
  const idToRow = new Map(parcelleRows.map((r) => [r.id, r]));
  const osmToCombo = buildOsmBuildingToComboId(parcelleRows, parcelleToCombo);

  const comboAgg = new Map<
    string,
    { lats: number[]; lngs: number[]; osmIds: Set<string> }
  >();

  for (const p of buildingPoints) {
    const comboId = comboIdForBuildingPoint(
      p.osmBuildingId,
      p.parcelleScoutV5Ids,
      parcelleToCombo,
      osmToCombo
    );
    if (!comboAgg.has(comboId)) {
      comboAgg.set(comboId, { lats: [], lngs: [], osmIds: new Set() });
    }
    const agg = comboAgg.get(comboId)!;
    agg.lats.push(p.position.lat);
    agg.lngs.push(p.position.lng);
    agg.osmIds.add(p.osmBuildingId);
  }

  const markers: DiscoveryComboMarker[] = [];
  for (const [comboId, agg] of comboAgg) {
    if (agg.lats.length === 0) continue;
    const osmBuildingIds = [...agg.osmIds].sort((a, b) => a.localeCompare(b));
    const anchorParcelleId = anchorParcelleIdForCombo(comboId, comboToParcelles, idToRow);
    const parcelleRowsForMarker = (comboToParcelles.get(comboId) ?? [])
      .map((id) => idToRow.get(id))
      .filter((r): r is ScoutMatchingV5Row => r != null);
    const draft: DiscoveryComboMarker = {
      comboId,
      position: {
        lat: agg.lats.reduce((a, b) => a + b, 0) / agg.lats.length,
        lng: agg.lngs.reduce((a, b) => a + b, 0) / agg.lngs.length,
      },
      anchorParcelleId,
      osmBuildingIds,
      footprintSumM2: 0,
      zoneTags: zoneTagsForParcelleRows(parcelleRowsForMarker),
      constructionYears: constructionYearsFromParcelleRows(parcelleRowsForMarker),
      nafDivisions: [],
    };
    draft.footprintSumM2 = discoveryComboFootprintSumM2(draft, rows, buildingPoints);
    markers.push(draft);
  }

  return markers.sort((a, b) => a.comboId.localeCompare(b.comboId));
}

/** Résout le combo et l’ancre parcelle pour un clic MVT (zoom détail). */
export function findComboAnchorForOsmBuilding(
  rows: readonly ScoutMatchingV5Row[],
  osmBuildingId: string
): DiscoveryComboSelection | null {
  const id = osmBuildingId.trim();
  if (!id) return null;
  const parcelleRows = rows.filter((r) => r.grain === "parcelle");
  const parcelleToCombo = buildParcelleComboIndex(rows);
  const comboToParcelles = buildComboToParcelleIds(parcelleToCombo);
  const idToRow = new Map(parcelleRows.map((r) => [r.id, r]));
  const osmToCombo = buildOsmBuildingToComboId(parcelleRows, parcelleToCombo);
  const comboId = osmToCombo.get(id);
  if (!comboId) return null;
  const anchorParcelleId = anchorParcelleIdForCombo(comboId, comboToParcelles, idToRow);
  if (!anchorParcelleId) return null;
  return { comboId, anchorParcelleId, representativeOsmBuildingId: id };
}

export function resolveComboMarkerSelection(
  comboId: string,
  markers: readonly DiscoveryComboMarker[]
): DiscoveryComboSelection | null {
  const cid = comboId.trim();
  if (!cid) return null;
  const marker = markers.find((m) => m.comboId === cid);
  if (!marker || !marker.anchorParcelleId) return null;
  return {
    comboId: marker.comboId,
    anchorParcelleId: marker.anchorParcelleId,
    representativeOsmBuildingId: marker.osmBuildingIds[0] ?? "",
  };
}
