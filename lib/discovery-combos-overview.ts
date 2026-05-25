/**
 * Types et helpers pour `scout_matching_v5_combos` / endpoint combos-overview.
 *
 * Source DB : data-pipeline/sql/010_scout_matching_v5_combos.sql
 * Endpoint  : /api/matching-v5/combos-overview
 */

import type { DiscoveryComboMarker } from "@/lib/discovery-combo-markers";
import { discoverySelectableZoneTag } from "@/lib/discovery-osm-activity-tags";

export type DiscoveryComboOverviewPoint = {
  comboId: string;
  position: { lat: number; lng: number };
  footprintSumM2: number;
  parkingSumM2: number;
  hasLanduseWaiver: boolean;
  anchorParcelleId: string;
  parcelleScoutV5Ids: string[];
  osmBuildingIds: string[];
  zoneTags: string[];
  constructionYears: number[];
  nafDivisions: string[];
};

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asTrimmedString(v: unknown): string {
  return asString(v).trim();
}

function asFiniteNumber(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => asTrimmedString(s)).filter((s) => s.length > 0);
}

function asIntArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const item of v) {
    const n = typeof item === "number" ? item : Number(String(item));
    if (Number.isFinite(n)) {
      const y = Math.trunc(n);
      if (y >= 1000 && y <= 2100) out.push(y);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

type RawFeature = {
  type?: unknown;
  id?: unknown;
  geometry?: unknown;
  properties?: unknown;
};

function parsePointGeometry(v: unknown): { lat: number; lng: number } | null {
  if (!v || typeof v !== "object") return null;
  const g = v as { type?: unknown; coordinates?: unknown };
  if (g.type !== "Point") return null;
  if (!Array.isArray(g.coordinates) || g.coordinates.length < 2) return null;
  const lng = Number(g.coordinates[0]);
  const lat = Number(g.coordinates[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lat, lng };
}

/**
 * Parse la réponse `/api/matching-v5/combos-overview` (FeatureCollection de Points).
 */
export function parseDiscoveryCombosOverviewFeatureCollection(
  raw: unknown
): DiscoveryComboOverviewPoint[] {
  if (!raw || typeof raw !== "object") return [];
  const fc = raw as { type?: unknown; features?: unknown };
  if (fc.type !== "FeatureCollection") return [];
  if (!Array.isArray(fc.features)) return [];

  const out: DiscoveryComboOverviewPoint[] = [];
  for (const feat of fc.features as RawFeature[]) {
    if (!feat || typeof feat !== "object") continue;
    const props = (feat.properties ?? {}) as Record<string, unknown>;
    const comboId =
      asTrimmedString(props.combo_id) || asTrimmedString(feat.id);
    if (!comboId) continue;
    const position = parsePointGeometry(feat.geometry);
    if (!position) continue;
    const zoneTags = asStringArray(props.zone_tags)
      .map((t) => discoverySelectableZoneTag(t))
      .filter((t): t is string => t != null)
      .sort((a, b) => a.localeCompare(b));
    out.push({
      comboId,
      position,
      footprintSumM2: asFiniteNumber(props.footprint_sum_m2, 0),
      parkingSumM2: asFiniteNumber(props.parking_sum_m2, 0),
      hasLanduseWaiver: asBool(props.has_landuse_waiver),
      anchorParcelleId: asTrimmedString(props.anchor_parcelle_id),
      parcelleScoutV5Ids: asStringArray(props.parcelle_scout_v5_ids),
      osmBuildingIds: asStringArray(props.osm_building_ids),
      zoneTags,
      constructionYears: asIntArray(props.construction_years),
      nafDivisions: asStringArray(props.naf_divisions),
    });
  }
  return out;
}

/** Mappe les points overview SQL vers les marqueurs carte Discovery. */
export function discoveryComboMarkersFromOverview(
  points: readonly DiscoveryComboOverviewPoint[]
): DiscoveryComboMarker[] {
  return points.map((p) => ({
    comboId: p.comboId,
    position: p.position,
    anchorParcelleId: p.anchorParcelleId,
    osmBuildingIds: [...p.osmBuildingIds],
    footprintSumM2: p.footprintSumM2,
    zoneTags: [...p.zoneTags],
    constructionYears: [...p.constructionYears],
    nafDivisions: [...p.nafDivisions],
  }));
}
