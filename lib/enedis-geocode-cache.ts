import type { PoolClient } from "pg";
import {
  DISCOVERY_ENEDIS_GEOCODE_MIN_SCORE,
  type DiscoveryEnedisPoint,
} from "@/lib/discovery-enedis-layer";
import {
  acceptGeoplateformeHitForCommune,
  geoplateformeSearch,
} from "@/lib/geoplateforme-geocode";
import {
  enedisRecordStableId,
  formatEnedisAddressLabel,
  normalizeEnedisAddressKey,
  type EnedisOpenDataRecord,
} from "@/lib/enedis-opendata-client";

export const ENEDIS_GEOCODE_CACHE_TABLE = "public.scout_enedis_geocode_cache";

function isMissingGeocodeCacheTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "42P01";
}

export type EnedisGeocodeCacheRow = {
  address_key: string;
  code_commune: string;
  lat: number;
  lng: number;
  geocode_score: number;
  geocode_label: string | null;
};

/** Coordonnées WGS84 exploitables (évite INSERT NULL si API ou cache corrompu). */
export function isValidEnedisGeocodeCoords(lat: unknown, lng: unknown): boolean {
  const la = typeof lat === "number" ? lat : Number(lat);
  const ln = typeof lng === "number" ? lng : Number(lng);
  return (
    Number.isFinite(la) &&
    Number.isFinite(ln) &&
    la >= -90 &&
    la <= 90 &&
    ln >= -180 &&
    ln <= 180
  );
}

export async function lookupEnedisGeocodeCache(
  client: PoolClient,
  keys: readonly { addressKey: string; codeCommune: string }[]
): Promise<Map<string, EnedisGeocodeCacheRow>> {
  const out = new Map<string, EnedisGeocodeCacheRow>();
  if (keys.length === 0) return out;

  const tuples = keys.map((k) => [k.addressKey, k.codeCommune] as const);
  const values: string[] = [];
  const params: string[] = [];
  let p = 1;
  for (const [ak, cc] of tuples) {
    values.push(`($${p}, $${p + 1})`);
    params.push(ak, cc);
    p += 2;
  }
  const sql = `
    SELECT address_key, code_commune, lat, lng, geocode_score, geocode_label
    FROM ${ENEDIS_GEOCODE_CACHE_TABLE}
    WHERE (address_key, code_commune) IN (${values.join(", ")})
  `;
  try {
    const res = await client.query<EnedisGeocodeCacheRow>(sql, params);
    for (const row of res.rows) {
      if (!isValidEnedisGeocodeCoords(row.lat, row.lng)) continue;
      out.set(`${row.address_key}\0${row.code_commune}`, row);
    }
  } catch (err) {
    if (!isMissingGeocodeCacheTableError(err)) throw err;
  }
  return out;
}

export async function upsertEnedisGeocodeCache(
  client: PoolClient,
  rows: readonly EnedisGeocodeCacheRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const valid = rows.filter((row) => isValidEnedisGeocodeCoords(row.lat, row.lng));
  if (valid.length === 0) return;
  try {
    for (const row of valid) {
      await client.query(
      `
      INSERT INTO ${ENEDIS_GEOCODE_CACHE_TABLE}
        (address_key, code_commune, lat, lng, geocode_score, geocode_label)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (address_key, code_commune) DO UPDATE SET
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        geocode_score = EXCLUDED.geocode_score,
        geocode_label = EXCLUDED.geocode_label,
        updated_at = now()
      `,
      [
        row.address_key,
        row.code_commune,
        row.lat,
        row.lng,
        row.geocode_score,
        row.geocode_label,
      ]
      );
    }
  } catch (err) {
    if (!isMissingGeocodeCacheTableError(err)) throw err;
  }
}

export type GeocodeEnedisRecordsResult = {
  points: DiscoveryEnedisPoint[];
  skippedNoAddress: number;
  skippedGeocode: number;
  geocodedNew: number;
};

export async function geocodeEnedisRecordsToPoints(
  client: PoolClient,
  records: readonly EnedisOpenDataRecord[],
  options: {
    maxNewGeocodes: number;
    minScore?: number;
    fetchFn?: typeof fetch;
  }
): Promise<GeocodeEnedisRecordsResult> {
  const minScore = options.minScore ?? DISCOVERY_ENEDIS_GEOCODE_MIN_SCORE;
  const prepared: {
    record: EnedisOpenDataRecord;
    id: string;
    addressKey: string;
    codeCommune: string;
    label: string;
    mwh: number;
  }[] = [];

  let skippedNoAddress = 0;
  for (const record of records) {
    const label = formatEnedisAddressLabel(record);
    const codeCommune = String(record.code_commune ?? "").trim();
    const mwh = Number(record.consommation_annuelle_totale_de_ladresse_mwh);
    if (!label || !/^\d{5}$/.test(codeCommune) || !Number.isFinite(mwh) || mwh <= 0) {
      skippedNoAddress += 1;
      continue;
    }
    prepared.push({
      record,
      id: enedisRecordStableId(record),
      addressKey: normalizeEnedisAddressKey(label),
      codeCommune,
      label,
      mwh,
    });
  }

  const cacheKeys = prepared.map((p) => ({
    addressKey: p.addressKey,
    codeCommune: p.codeCommune,
  }));
  const cache = await lookupEnedisGeocodeCache(client, cacheKeys);

  const points: DiscoveryEnedisPoint[] = [];
  let skippedGeocode = 0;
  let geocodedNew = 0;
  const toUpsert: EnedisGeocodeCacheRow[] = [];

  for (const item of prepared) {
    const cacheKey = `${item.addressKey}\0${item.codeCommune}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      points.push(recordToPoint(item, cached.lat, cached.lng, cached.geocode_label ?? item.label));
      continue;
    }
    if (geocodedNew >= options.maxNewGeocodes) {
      skippedGeocode += 1;
      continue;
    }
    const hit = await geoplateformeSearch(item.label, { fetchFn: options.fetchFn });
    geocodedNew += 1;
    if (
      !hit ||
      !acceptGeoplateformeHitForCommune(hit, item.codeCommune, minScore) ||
      !isValidEnedisGeocodeCoords(hit.lat, hit.lon)
    ) {
      skippedGeocode += 1;
      continue;
    }
    toUpsert.push({
      address_key: item.addressKey,
      code_commune: item.codeCommune,
      lat: hit.lat,
      lng: hit.lon,
      geocode_score: hit.score,
      geocode_label: hit.label,
    });
    points.push(recordToPoint(item, hit.lat, hit.lon, hit.label));
  }

  if (toUpsert.length > 0) {
    await upsertEnedisGeocodeCache(client, toUpsert);
  }

  return { points, skippedNoAddress, skippedGeocode, geocodedNew };
}

function recordToPoint(
  item: {
    id: string;
    record: EnedisOpenDataRecord;
    label: string;
    mwh: number;
    codeCommune: string;
  },
  lat: number,
  lng: number,
  adresse: string
): DiscoveryEnedisPoint {
  return {
    id: item.id,
    lat,
    lng,
    mwh: item.mwh,
    annee: String(item.record.annee ?? "").trim(),
    adresse,
    code_commune: item.codeCommune,
    code_secteur_naf2: item.record.code_secteur_naf2
      ? String(item.record.code_secteur_naf2).trim()
      : null,
    nombre_de_sites: Number(item.record.nombre_de_sites) || 1,
  };
}
