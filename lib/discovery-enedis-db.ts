import {
  DISCOVERY_ENEDIS_MWH_SLIDER_MAX,
  discoveryEnedisHiEffective,
  isDiscoveryEnedisMwhFilterDisabled,
} from "@/lib/discovery-enedis-layer";

export const SCOUT_ENEDIS_CONSUMPTION_TABLE = "public.scout_enedis_consumption_sites";

export type QueryEnedisSitesInput = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  annee: number;
  mwhMin: number;
  mwhMax: number;
  limit: number;
};

export function buildEnedisSitesQuery(input: QueryEnedisSitesInput): {
  sql: string;
  params: (string | number)[];
} {
  const params: (string | number)[] = [
    input.annee,
    input.minLng,
    input.minLat,
    input.maxLng,
    input.maxLat,
    input.limit,
  ];
  let p = 7;
  const mwhParts: string[] = [];

  if (!isDiscoveryEnedisMwhFilterDisabled(input.mwhMin, input.mwhMax)) {
    mwhParts.push(`mwh >= $${p}`);
    params.push(input.mwhMin);
    p += 1;
    const hi = discoveryEnedisHiEffective(input.mwhMax);
    if (Number.isFinite(hi)) {
      mwhParts.push(`mwh <= $${p}`);
      params.push(hi);
      p += 1;
    }
  }

  const mwhSql = mwhParts.length > 0 ? ` AND ${mwhParts.join(" AND ")}` : "";

  const sql = `
    SELECT
      site_id AS id,
      lat,
      lng,
      mwh,
      annee::text AS annee,
      adresse_label AS adresse,
      code_commune,
      code_secteur_naf2,
      nombre_de_sites
    FROM ${SCOUT_ENEDIS_CONSUMPTION_TABLE}
    WHERE annee = $1
      AND geocode_status = 'ok'
      AND geom IS NOT NULL
      AND ST_Intersects(
        geom,
        ST_MakeEnvelope($2, $3, $4, $5, 4326)
      )
      ${mwhSql}
    ORDER BY mwh DESC
    LIMIT $6
  `;

  return { sql, params };
}

export function enedisSitesTableMissingMessage(): string {
  return (
    "Table scout_enedis_consumption_sites absente. " +
    "Exécuter : npm run pipeline:enedis:schema && npm run pipeline:enedis:import-dep-33"
  );
}

export function isEnedisSitesTableMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "42P01";
}
