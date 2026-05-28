import type { MapBounds } from "@/lib/swr-hooks";

const SCOUT_V5_ID = /^[a-zA-Z0-9_:\-|]{1,128}$/;
const CODE_INSEE = /^\d{5}$/;
const MAX_ANCHOR_IDS = 50;
const MAX_EXCLUDE_IDS = 200;
const MAX_CODE_INSEE = 3;
const DEFAULT_BUFFER_M = 5;
const MAX_BUFFER_M = 50;
const MAX_RESULTS = 200;

/** Surface bbox max ~1000 m × 1000 m (zone visible / recherche édition). */
export const PARCELLES_ADJACENT_MAX_BBOX_AREA_M2 = 1_000_000;

/** Facteur d’élargissement de la bbox visible au lancement du mode édition (par axe). */
export const PARCELLES_EDIT_SEARCH_BBOX_EXPAND_RATIO = 1.5;

export type ParcellesAdjacentAnchorRequest = {
  mode: "anchor";
  parcelleIds: string[];
  excludeIds: string[];
  bufferM: number;
};

export type ParcellesAdjacentBboxRequest = {
  mode: "bbox";
  bounds: MapBounds;
  codeInsee: string[];
  excludeIds: string[];
};

/** Géométries cadastre exactes pour une liste de `scout_v5_id` (réhydratation pipeline). */
export type ParcellesAdjacentLookupRequest = {
  mode: "lookup";
  parcelleIds: string[];
};

export type ParcellesAdjacentParseResult =
  | {
      ok: true;
    } & (
      | ParcellesAdjacentAnchorRequest
      | ParcellesAdjacentBboxRequest
      | ParcellesAdjacentLookupRequest
    )
  | { ok: false; status: number; error: string };

function parseIdList(raw: string | null, max: number): string[] | null {
  const s = (raw ?? "").trim();
  if (!s) return [];
  const parts = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length > max) return null;
  for (const id of parts) {
    if (!SCOUT_V5_ID.test(id)) return null;
  }
  return [...new Set(parts)];
}

function parseCoord(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseCodeInseeList(raw: string | null): string[] | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const parts = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_CODE_INSEE) return null;
  for (const ci of parts) {
    if (!CODE_INSEE.test(ci)) return null;
  }
  return [...new Set(parts)];
}

/** Mode bbox : absent ou vide = toutes les communes intersectant la bbox. */
function parseCodeInseeListForBbox(raw: string | null): string[] | null {
  if (raw == null || raw.trim() === "") return [];
  return parseCodeInseeList(raw);
}

/** Approximation planaire de la surface bbox (m²) pour garde-fou client/serveur. */
export function approximateMapBoundsAreaM2(bounds: MapBounds): number {
  const latMid = (bounds.sw.lat + bounds.ne.lat) / 2;
  const latM = Math.abs(bounds.ne.lat - bounds.sw.lat) * 111_320;
  const lngM =
    Math.abs(bounds.ne.lng - bounds.sw.lng) * 111_320 * Math.cos((latMid * Math.PI) / 180);
  return latM * lngM;
}

export function isMapBoundsAreaAllowed(bounds: MapBounds): boolean {
  return approximateMapBoundsAreaM2(bounds) <= PARCELLES_ADJACENT_MAX_BBOX_AREA_M2;
}

/**
 * Bbox de recherche cadastrale en mode édition : élargit la zone visible autour de son centre,
 * plafonnée à {@link PARCELLES_ADJACENT_MAX_BBOX_AREA_M2}.
 */
export function expandMapBoundsForEditParcelSearch(bounds: MapBounds): MapBounds {
  const latMid = (bounds.sw.lat + bounds.ne.lat) / 2;
  const lngMid = (bounds.sw.lng + bounds.ne.lng) / 2;
  const halfLat = Math.abs(bounds.ne.lat - bounds.sw.lat) / 2;
  const halfLng = Math.abs(bounds.ne.lng - bounds.sw.lng) / 2;
  const baseArea = approximateMapBoundsAreaM2(bounds);
  const maxArea = PARCELLES_ADJACENT_MAX_BBOX_AREA_M2;
  let ratio = PARCELLES_EDIT_SEARCH_BBOX_EXPAND_RATIO;
  if (baseArea > 0 && baseArea * ratio * ratio > maxArea) {
    ratio = Math.sqrt(maxArea / baseArea);
  }
  return {
    sw: { lat: latMid - halfLat * ratio, lng: lngMid - halfLng * ratio },
    ne: { lat: latMid + halfLat * ratio, lng: lngMid + halfLng * ratio },
  };
}

function parseBboxMode(
  searchParams: URLSearchParams,
  excludeIds: string[]
): ParcellesAdjacentParseResult | null {
  const swLat = parseCoord(searchParams.get("swLat"));
  const swLng = parseCoord(searchParams.get("swLng"));
  const neLat = parseCoord(searchParams.get("neLat"));
  const neLng = parseCoord(searchParams.get("neLng"));
  const hasAny =
    searchParams.has("swLat") ||
    searchParams.has("swLng") ||
    searchParams.has("neLat") ||
    searchParams.has("neLng");
  if (!hasAny) return null;
  if (swLat == null || swLng == null || neLat == null || neLng == null) {
    return { ok: false, status: 400, error: "Paramètres bbox invalides." };
  }

  const codeInsee = parseCodeInseeListForBbox(searchParams.get("code_insee"));
  if (codeInsee === null) {
    return { ok: false, status: 400, error: "code_insee invalide (1–3 communes)." };
  }

  const bounds: MapBounds = {
    sw: { lat: Math.min(swLat, neLat), lng: Math.min(swLng, neLng) },
    ne: { lat: Math.max(swLat, neLat), lng: Math.max(swLng, neLng) },
  };
  if (!isMapBoundsAreaAllowed(bounds)) {
    return {
      ok: false,
      status: 400,
      error: "BBox trop grande — zoomez davantage sur le combo.",
    };
  }

  return { ok: true, mode: "bbox", bounds, codeInsee, excludeIds };
}

export function parseParcellesAdjacentRequest(
  searchParams: URLSearchParams
): ParcellesAdjacentParseResult {
  const excludeIds = parseIdList(searchParams.get("exclude_ids"), MAX_EXCLUDE_IDS);
  if (excludeIds === null) {
    return { ok: false, status: 400, error: "exclude_ids invalide" };
  }

  const bboxMode = parseBboxMode(searchParams, excludeIds ?? []);
  if (bboxMode) return bboxMode;

  const lookupMode =
    searchParams.get("mode") === "lookup" || searchParams.get("lookup") === "1";
  if (lookupMode) {
    const parcelleIds = parseIdList(searchParams.get("parcelle_ids"), MAX_ANCHOR_IDS);
    if (parcelleIds === null) {
      return { ok: false, status: 400, error: "parcelle_ids invalide (max 50)" };
    }
    if (parcelleIds.length === 0) {
      return { ok: false, status: 400, error: "parcelle_ids requis en mode lookup" };
    }
    return { ok: true, mode: "lookup", parcelleIds };
  }

  const parcelleIds = parseIdList(searchParams.get("parcelle_ids"), MAX_ANCHOR_IDS);
  if (parcelleIds === null) {
    return { ok: false, status: 400, error: "parcelle_ids invalide (max 50)" };
  }
  if (parcelleIds.length === 0) {
    return { ok: false, status: 400, error: "parcelle_ids ou bbox requis" };
  }

  const bufferRaw = searchParams.get("buffer_m");
  let bufferM = DEFAULT_BUFFER_M;
  if (bufferRaw != null && bufferRaw.trim() !== "") {
    const n = Number(bufferRaw);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, status: 400, error: "buffer_m invalide" };
    }
    bufferM = Math.min(MAX_BUFFER_M, Math.max(0, n));
  }

  return { ok: true, mode: "anchor", parcelleIds, excludeIds: excludeIds ?? [], bufferM };
}

export function buildParcellesAdjacentSearchParams(input: {
  parcelleIds: readonly string[];
  excludeIds?: readonly string[];
  bufferM?: number;
}): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("parcelle_ids", input.parcelleIds.join(","));
  if (input.excludeIds?.length) sp.set("exclude_ids", input.excludeIds.join(","));
  if (input.bufferM != null && Number.isFinite(input.bufferM)) {
    sp.set("buffer_m", String(input.bufferM));
  }
  return sp;
}

export function buildParcellesCadastreLookupSearchParams(parcelleIds: readonly string[]): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("mode", "lookup");
  sp.set("parcelle_ids", parcelleIds.join(","));
  return sp;
}

export function buildParcellesAdjacentBboxSearchParams(input: {
  bounds: MapBounds;
  /** Vide = toutes les communes dans la bbox (frontière intercommunale). */
  codeInsee?: readonly string[];
  excludeIds?: readonly string[];
}): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("swLat", String(input.bounds.sw.lat));
  sp.set("swLng", String(input.bounds.sw.lng));
  sp.set("neLat", String(input.bounds.ne.lat));
  sp.set("neLng", String(input.bounds.ne.lng));
  if (input.codeInsee?.length) sp.set("code_insee", input.codeInsee.join(","));
  if (input.excludeIds?.length) sp.set("exclude_ids", input.excludeIds.join(","));
  return sp;
}

export const PARCELLES_ADJACENT_MAX_RESULTS = MAX_RESULTS;

export type DiscoveryAdjacentParcelle = {
  scout_v5_id: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  code_insee: string;
  section: string;
  numero_norm: string;
  combo_id: string | null;
  /** Toutes les parcelles du combo matching si la parcelle est rattachée à un combo SQL. */
  combo_parcelle_scout_v5_ids: string[];
  cadastre_label: string;
  in_matching_v5: boolean;
};

export function cadastreLabelFromPropertiesJson(
  properties: Record<string, unknown> | null | undefined
): string {
  const section = String(properties?.section ?? "").trim();
  const numero = String(properties?.numero_norm ?? properties?.numero ?? "").trim();
  const codeInsee = String(properties?.code_insee ?? "").trim();
  if (section && numero) {
    return codeInsee ? `${section} ${numero} · ${codeInsee}` : `${section} ${numero}`;
  }
  return codeInsee || "";
}
