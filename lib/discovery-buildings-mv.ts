/**
 * Types et helpers pour la vue matérialisée `scout_matching_v5_buildings_mv`.
 *
 * Source DB : data-pipeline/sql/007_scout_matching_v5_buildings_mv.sql
 * Endpoints  : /api/matching-v5/buildings-overview, /api/matching-v5/buildings/[osmId]/parcelles
 */

export type DiscoveryBuildingPoint = {
  osmBuildingId: string;
  position: { lat: number; lng: number };
  footprintM2: number | null;
  matchingStatus: string;
  parcelleCount: number;
  /** Parcelles liées (MV) — permet le regroupement combo sans `building_geometries_json`. */
  parcelleScoutV5Ids: string[];
};

export type DiscoveryBuildingParcellesResolution = {
  osmBuildingId: string;
  parcelleScoutV5Ids: string[];
  batimentConstructionId: string | null;
  footprintM2: number | null;
  matchingStatus: string;
};

/** Valide le format pipeline `w:123`, `r:456`, `n:1` (un seul préfixe possible). */
export function isValidOsmBuildingId(raw: unknown): boolean {
  return typeof raw === "string" && /^[wnr]:\d{1,20}$/.test(raw);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asTrimmedString(v: unknown): string {
  return asString(v).trim();
}

function asFiniteNumberOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function asNonNegativeInt(v: unknown): number {
  const n = asFiniteNumberOrNull(v);
  if (n == null) return 0;
  const i = Math.trunc(n);
  return i > 0 ? i : 0;
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
 * Parse la réponse `/api/matching-v5/buildings-overview` (FeatureCollection de Points).
 */
export function parseDiscoveryBuildingsOverviewFeatureCollection(
  raw: unknown
): DiscoveryBuildingPoint[] {
  if (!raw || typeof raw !== "object") return [];
  const fc = raw as { type?: unknown; features?: unknown };
  if (fc.type !== "FeatureCollection") return [];
  if (!Array.isArray(fc.features)) return [];

  const out: DiscoveryBuildingPoint[] = [];
  for (const feat of fc.features as RawFeature[]) {
    if (!feat || typeof feat !== "object") continue;
    const props = (feat.properties ?? {}) as Record<string, unknown>;
    const idFromProp = asTrimmedString(props.osm_building_id);
    const idFromFeat = asTrimmedString(feat.id);
    const osmBuildingId = idFromProp || idFromFeat;
    if (!osmBuildingId) continue;
    const position = parsePointGeometry(feat.geometry);
    if (!position) continue;
    const idsRaw = props.parcelle_scout_v5_ids;
    const parcelleScoutV5Ids = Array.isArray(idsRaw)
      ? idsRaw.map((s) => asTrimmedString(s)).filter((s) => s.length > 0)
      : [];
    out.push({
      osmBuildingId,
      position,
      footprintM2: asFiniteNumberOrNull(props.footprint_m2),
      matchingStatus: asString(props.matching_status),
      parcelleCount: asNonNegativeInt(props.parcelle_count),
      parcelleScoutV5Ids,
    });
  }
  return out;
}

/**
 * Garde la première occurrence par `osmBuildingId`. Ignore les entrées sans id.
 * Pour les usages où l'API a déjà dédupliqué, cette fonction est un filet de sécurité.
 */
export function dedupBuildingPointsByOsmId(
  points: readonly DiscoveryBuildingPoint[]
): DiscoveryBuildingPoint[] {
  const seen = new Set<string>();
  const out: DiscoveryBuildingPoint[] = [];
  for (const p of points) {
    const id = (p.osmBuildingId ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(p);
  }
  return out;
}

/**
 * Parse la réponse `/api/matching-v5/buildings/[osmId]/parcelles`.
 * Renvoie `null` si la charge utile est inutilisable (id manquant).
 */
export function parseDiscoveryBuildingParcellesResolution(
  raw: unknown
): DiscoveryBuildingParcellesResolution | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const osmBuildingId = asTrimmedString(o.osm_building_id);
  if (!osmBuildingId) return null;
  const idsRaw = o.parcelle_scout_v5_ids;
  const parcelleScoutV5Ids = Array.isArray(idsRaw)
    ? idsRaw
        .map((s) => asTrimmedString(s))
        .filter((s) => s.length > 0)
    : [];
  return {
    osmBuildingId,
    parcelleScoutV5Ids,
    batimentConstructionId: asTrimmedString(o.batiment_construction_id) || null,
    footprintM2: asFiniteNumberOrNull(o.footprint_m2),
    matchingStatus: asString(o.matching_status),
  };
}
