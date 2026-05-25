export const GEOPLATEFORME_GEOCODE_BASE = "https://data.geopf.fr/geocodage";

export type GeoplateformeAddressHit = {
  label: string;
  score: number;
  distanceM: number | null;
  citycode: string;
  resultType: string;
  lon: number;
  lat: number;
};

function safeFloat(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseGeoplateformeFeature(
  feature: Record<string, unknown> | null | undefined
): GeoplateformeAddressHit | null {
  if (!feature || typeof feature !== "object") return null;
  const props = feature.properties;
  const geom = feature.geometry;
  if (!props || typeof props !== "object" || !geom || typeof geom !== "object") {
    return null;
  }
  const p = props as Record<string, unknown>;
  const g = geom as { coordinates?: unknown };
  const coords = g.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = safeFloat(coords[0]);
  const lat = safeFloat(coords[1]);
  if (lon == null || lat == null) return null;
  const label = String(p.label ?? p.name ?? "").trim();
  if (!label) return null;
  const score = safeFloat(p.score);
  if (score == null) return null;
  return {
    label,
    score,
    distanceM: safeFloat(p.distance),
    citycode: String(p.citycode ?? "").trim(),
    resultType: String(p.type ?? p._type ?? "").trim().toLowerCase(),
    lon,
    lat,
  };
}

function firstFeature(payload: Record<string, unknown>): Record<string, unknown> | null {
  const feats = payload.features;
  if (!Array.isArray(feats) || feats.length === 0) return null;
  const first = feats[0];
  return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
}

export async function geoplateformeSearch(
  query: string,
  options?: { limit?: number; fetchFn?: typeof fetch }
): Promise<GeoplateformeAddressHit | null> {
  const q = String(query ?? "").trim();
  if (q.length < 5) return null;
  const fetchImpl = options?.fetchFn ?? fetch;
  const params = new URLSearchParams({
    q,
    limit: String(options?.limit ?? 1),
  });
  const url = `${GEOPLATEFORME_GEOCODE_BASE}/search?${params.toString()}`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const payload = (await res.json()) as Record<string, unknown>;
  return parseGeoplateformeFeature(firstFeature(payload));
}

export function acceptGeoplateformeHitForCommune(
  hit: GeoplateformeAddressHit,
  codeCommune: string,
  minScore: number
): boolean {
  const cc = String(codeCommune).trim();
  if (!/^\d{5}$/.test(cc)) return false;
  if (hit.score < minScore) return false;
  if (
    !Number.isFinite(hit.lat) ||
    !Number.isFinite(hit.lon) ||
    hit.lat < -90 ||
    hit.lat > 90 ||
    hit.lon < -180 ||
    hit.lon > 180
  ) {
    return false;
  }
  return hit.citycode === cc;
}
