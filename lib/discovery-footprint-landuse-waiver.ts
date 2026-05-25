import type { DiscoveryBuildingPoint } from "@/lib/discovery-buildings-mv";
import { isValidOsmBuildingId } from "@/lib/discovery-buildings-mv";
import { DISCOVERY_SURFACE_SLIDER_MAX_M2 } from "@/lib/discovery-surface-defaults";
import {
  parseMatchingV5BuildingsJson,
  type ScoutMatchingV5Row,
  type V5BuildingsJsonEntry,
} from "@/lib/scout-matching-v5-map";

export type DiscoveryOsmBuildingSurfaceInfo = {
  footprintM2: number;
  hasProLanduseWaiver: boolean;
};

/** Aligné sur `LANDUSE_WAIVES_MIN_FOOTPRINT_M2` (pipeline V5). */
export const DISCOVERY_LANDUSE_WAIVES_MIN_FOOTPRINT_M2 = new Set([
  "commercial",
  "industrial",
  "retail",
]);

export function buildingHasProLanduseWaiver(entry: V5BuildingsJsonEntry): boolean {
  if (String(entry.zoneSource ?? "").trim() !== "landuse") return false;
  const tag = String(entry.zoneTag ?? "").trim().toLowerCase();
  return DISCOVERY_LANDUSE_WAIVES_MIN_FOOTPRINT_M2.has(tag);
}

/**
 * Somme d’empreinte pour le filtre UI : `footprint_sum_m2` exporté, sinon Σ `footprint_m2`
 * dédupliquée par `batiment_construction_id` dans `buildings_json`.
 */
export function rowDiscoveryFootprintSumM2(row: ScoutMatchingV5Row): number {
  if (row.footprintSumM2 > 0) return row.footprintSumM2;
  const buildings = parseMatchingV5BuildingsJson(row.buildingsJson);
  if (buildings.length === 0) return 0;
  const byBc = new Map<string, number>();
  for (const b of buildings) {
    const bc = b.batimentConstructionId.trim();
    if (!bc || byBc.has(bc)) continue;
    const fp = b.footprintM2;
    byBc.set(bc, fp != null && Number.isFinite(fp) && fp > 0 ? fp : 0);
  }
  let sum = 0;
  for (const fp of byBc.values()) sum += fp;
  return sum;
}

/** Plafond effectif du slider : au maximum UI, pas de borne haute. */
export function discoverySurfaceHiEffective(
  hiM2: number,
  sliderMaxM2: number = DISCOVERY_SURFACE_SLIDER_MAX_M2
): number {
  return hiM2 >= sliderMaxM2 ? Number.POSITIVE_INFINITY : hiM2;
}

export function isDiscoverySurfaceFilterDisabled(
  minM2: number,
  maxM2: number,
  sliderMaxM2: number = DISCOVERY_SURFACE_SLIDER_MAX_M2
): boolean {
  const lo = Math.min(minM2, maxM2);
  const hi = Math.max(minM2, maxM2);
  return lo <= 0 && hi >= sliderMaxM2;
}

/** Filtre slider parking Découverte — même logique que l’empreinte building. */
export const isDiscoveryParkingFilterDisabled = isDiscoverySurfaceFilterDisabled;

/** Filtre slider Découverte : somme d’empreintes uniquement (sans dérogation landuse de l’export matching). */
export function rowMeetsDiscoverySurfaceMinM2(row: ScoutMatchingV5Row, minM2: number): boolean {
  if (minM2 <= 0) return true;
  return rowDiscoveryFootprintSumM2(row) > minM2;
}

export function rowMeetsDiscoverySurfaceMaxM2(row: ScoutMatchingV5Row, maxM2: number): boolean {
  if (!Number.isFinite(maxM2)) return true;
  return rowDiscoveryFootprintSumM2(row) <= maxM2;
}

export function rowMeetsDiscoverySurfaceRange(
  row: ScoutMatchingV5Row,
  minM2: number,
  maxM2: number
): boolean {
  if (!rowMeetsDiscoverySurfaceMinM2(row, minM2)) return false;
  return rowMeetsDiscoverySurfaceMaxM2(row, maxM2);
}

/** Filtre surface sur les points `buildings-overview` (empreinte par bâtiment OSM). */
export function buildingPointMeetsDiscoverySurfaceRange(
  footprintM2: number | null,
  minM2: number,
  hiEffective: number
): boolean {
  if (minM2 <= 0 && hiEffective === Number.POSITIVE_INFINITY) return true;
  const fp = footprintM2 != null && Number.isFinite(footprintM2) ? Math.max(0, footprintM2) : 0;
  if (minM2 > 0 && fp < minM2) return false;
  if (Number.isFinite(hiEffective) && fp > hiEffective) return false;
  return true;
}

/**
 * Index `osm_building_id` → empreinte + dérogation landuse (depuis `buildings_json` des features).
 * Aligne clusters / MVT sur le libellé « Surface building » du panneau filtres.
 */
export function buildDiscoveryOsmBuildingSurfaceIndex(
  rows: readonly ScoutMatchingV5Row[]
): Map<string, DiscoveryOsmBuildingSurfaceInfo> {
  const index = new Map<string, DiscoveryOsmBuildingSurfaceInfo>();
  for (const row of rows) {
    if (row.grain !== "parcelle" && row.grain !== "building") continue;
    for (const b of parseMatchingV5BuildingsJson(row.buildingsJson)) {
      const osmId = String(b.osmBuildingId ?? "").trim();
      if (!osmId || !isValidOsmBuildingId(osmId)) continue;
      const fp =
        b.footprintM2 != null && Number.isFinite(b.footprintM2) && b.footprintM2 > 0
          ? b.footprintM2
          : 0;
      const waiver = buildingHasProLanduseWaiver(b);
      const prev = index.get(osmId);
      if (!prev) {
        index.set(osmId, { footprintM2: fp, hasProLanduseWaiver: waiver });
        continue;
      }
      index.set(osmId, {
        footprintM2: Math.max(prev.footprintM2, fp),
        hasProLanduseWaiver: prev.hasProLanduseWaiver || waiver,
      });
    }
  }
  return index;
}

function footprintM2ForDiscoveryBuildingPoint(
  point: DiscoveryBuildingPoint,
  index: Map<string, DiscoveryOsmBuildingSurfaceInfo>
): number {
  const fromIndex = index.get(point.osmBuildingId)?.footprintM2;
  if (fromIndex != null && fromIndex > 0) return fromIndex;
  if (point.footprintM2 != null && Number.isFinite(point.footprintM2)) {
    return Math.max(0, point.footprintM2);
  }
  return 0;
}

/** Surface par bâtiment OSM (filtre slider : empreinte seule, pas de dérogation landuse). */
export function discoveryBuildingPointMeetsSurfaceRange(
  point: DiscoveryBuildingPoint,
  surfaceIndex: Map<string, DiscoveryOsmBuildingSurfaceInfo>,
  minM2: number,
  hiEffective: number
): boolean {
  if (minM2 <= 0 && hiEffective === Number.POSITIVE_INFINITY) return true;
  const fp = footprintM2ForDiscoveryBuildingPoint(point, surfaceIndex);
  if (minM2 > 0 && fp <= minM2) return false;
  if (Number.isFinite(hiEffective) && fp > hiEffective) return false;
  return true;
}

export function filterDiscoveryBuildingPointsBySurface(
  points: readonly DiscoveryBuildingPoint[],
  surfaceIndex: Map<string, DiscoveryOsmBuildingSurfaceInfo>,
  minM2: number,
  hiEffective: number
): DiscoveryBuildingPoint[] {
  if (minM2 <= 0 && hiEffective === Number.POSITIVE_INFINITY) return [...points];
  return points.filter((p) =>
    discoveryBuildingPointMeetsSurfaceRange(p, surfaceIndex, minM2, hiEffective)
  );
}
