const SCOUT_V5_ID = /^[a-zA-Z0-9_:\-|]{1,128}$/;
const MAX_ANCHOR_IDS = 50;
const MAX_EXCLUDE_IDS = 200;
const DEFAULT_BUFFER_M = 5;
const MAX_BUFFER_M = 50;
const MAX_RESULTS = 200;

export type ParcellesAdjacentParseResult =
  | { ok: true; parcelleIds: string[]; excludeIds: string[]; bufferM: number }
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

export function parseParcellesAdjacentRequest(
  searchParams: URLSearchParams
): ParcellesAdjacentParseResult {
  const parcelleIds = parseIdList(searchParams.get("parcelle_ids"), MAX_ANCHOR_IDS);
  if (parcelleIds === null) {
    return { ok: false, status: 400, error: "parcelle_ids invalide (max 50)" };
  }
  if (parcelleIds.length === 0) {
    return { ok: false, status: 400, error: "parcelle_ids requis" };
  }

  const excludeIds = parseIdList(searchParams.get("exclude_ids"), MAX_EXCLUDE_IDS);
  if (excludeIds === null) {
    return { ok: false, status: 400, error: "exclude_ids invalide" };
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

  return { ok: true, parcelleIds, excludeIds: excludeIds ?? [], bufferM };
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
