/**
 * Helpers partagés — reset des tables résultat Matching V5 (features + combos).
 * N’efface pas : cadastre, BDNB, OSM, PPM, scout_etablissements, etc.
 */

import { Client } from "pg";
import { loadDotenvMap, pickDatabaseUrlFromEnvObject } from "./resolve-database-url.mjs";

export const NEON_HOST = "neon.tech";
export const FEATURES_TABLE = "public.scout_matching_v5_features";
export const COMBOS_TABLE = "public.scout_matching_v5_combos";
export const BUILDINGS_MV = "public.scout_matching_v5_buildings_mv";

export function parseTargets(argv) {
  const a = argv.find((x) => x.startsWith("--targets="));
  const raw = a ? a.slice("--targets=".length) : "local,neon";
  return new Set(
    raw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function pickLocalUrl(dot) {
  const v = process.env.LOCAL_DATABASE_URL ?? dot.LOCAL_DATABASE_URL;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function pickNeonUrl(dot) {
  const keys = [
    "NEON_ARTIFACT_DROP_URL",
    "Radianz_DATABASE_URL_UNPOOLED",
    "RADIANZ_DATABASE_URL_UNPOOLED",
    "Radianz_DATABASE_URL",
    "RADIANZ_DATABASE_URL",
  ];
  for (const k of keys) {
    const v = process.env[k] ?? dot[k];
    if (typeof v === "string" && v.trim() && v.includes(NEON_HOST)) {
      return { url: v.trim(), source: k };
    }
  }
  const fallback = pickDatabaseUrlFromEnvObject({ ...process.env, ...dot });
  if (fallback && fallback.includes(NEON_HOST)) {
    return { url: fallback, source: "resolve-database-url" };
  }
  return null;
}

export async function tableExists(client, qualifiedName) {
  const [schema, table] = qualifiedName.split(".");
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = $1 AND table_name = $2 LIMIT 1`,
    [schema, table]
  );
  return r.rowCount > 0;
}

export async function matviewExists(client, qualifiedName) {
  const [schema, name] = qualifiedName.split(".");
  const r = await client.query(
    `SELECT 1 FROM pg_matviews WHERE schemaname = $1 AND matviewname = $2 LIMIT 1`,
    [schema, name]
  );
  return r.rowCount > 0;
}

export async function countTable(client, table, whereSql = "", params = []) {
  if (!(await tableExists(client, table))) return null;
  const r = await client.query(
    `SELECT COUNT(*)::bigint AS n FROM ${table}${whereSql ? ` WHERE ${whereSql}` : ""}`,
    params
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Répartition par commune (aperçu dry-run). */
export async function countByCodeInsee(client, table, limit = 15) {
  if (!(await tableExists(client, table))) return [];
  const r = await client.query(
    `SELECT code_insee, COUNT(*)::bigint AS n
     FROM ${table}
     GROUP BY code_insee
     ORDER BY n DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows.map((row) => ({
    codeInsee: String(row.code_insee ?? ""),
    n: Number(row.n ?? 0),
  }));
}

export async function countDistinctInsee(client, table) {
  if (!(await tableExists(client, table))) return null;
  const r = await client.query(
    `SELECT COUNT(DISTINCT code_insee)::bigint AS n FROM ${table}`
  );
  return Number(r.rows[0]?.n ?? 0);
}

export function fmtTableCount(table, n) {
  return n == null ? `${table}=absent` : `${table}=${n}`;
}

/**
 * Vide features + combos (TRUNCATE). Rafraîchit la MV bâtiments si présente.
 */
export async function truncateMatchingV5Tables(client, { refreshMv = true } = {}) {
  const counts = {
    [COMBOS_TABLE]: await countTable(client, COMBOS_TABLE),
    [FEATURES_TABLE]: await countTable(client, FEATURES_TABLE),
  };

  await client.query("BEGIN");
  try {
    if (counts[COMBOS_TABLE] != null) {
      await client.query(`TRUNCATE TABLE ${COMBOS_TABLE}`);
    }
    if (counts[FEATURES_TABLE] != null) {
      await client.query(`TRUNCATE TABLE ${FEATURES_TABLE}`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }

  if (refreshMv && (await matviewExists(client, BUILDINGS_MV))) {
    try {
      await client.query(
        `REFRESH MATERIALIZED VIEW CONCURRENTLY ${BUILDINGS_MV}`
      );
    } catch {
      await client.query(`REFRESH MATERIALIZED VIEW ${BUILDINGS_MV}`);
    }
  }

  return counts;
}

/**
 * Suppression par code INSEE (pas de reliquat sur la commune ciblée).
 */
export async function deleteMatchingV5ByInsee(client, codeInsee) {
  const counts = {
    [COMBOS_TABLE]: await countTable(client, COMBOS_TABLE, "code_insee = $1", [
      codeInsee,
    ]),
    [FEATURES_TABLE]: await countTable(client, FEATURES_TABLE, "code_insee = $1", [
      codeInsee,
    ]),
  };

  await client.query("BEGIN");
  try {
    if (counts[COMBOS_TABLE] != null) {
      await client.query(`DELETE FROM ${COMBOS_TABLE} WHERE code_insee = $1`, [
        codeInsee,
      ]);
    }
    if (counts[FEATURES_TABLE] != null) {
      await client.query(`DELETE FROM ${FEATURES_TABLE} WHERE code_insee = $1`, [
        codeInsee,
      ]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
  return counts;
}

export async function auditTarget(client, { codeInsee = null } = {}) {
  const where = codeInsee ? "code_insee = $1" : "";
  const params = codeInsee ? [codeInsee] : [];
  const features = await countTable(client, FEATURES_TABLE, where, params);
  const combos = await countTable(client, COMBOS_TABLE, where, params);
  const inseeFeatures = codeInsee
    ? 1
    : await countDistinctInsee(client, FEATURES_TABLE);
  const inseeCombos = codeInsee ? 1 : await countDistinctInsee(client, COMBOS_TABLE);
  const byInsee =
    codeInsee == null
      ? {
          features: await countByCodeInsee(client, FEATURES_TABLE),
          combos: await countByCodeInsee(client, COMBOS_TABLE),
        }
      : null;
  let mvRows = null;
  if (await matviewExists(client, BUILDINGS_MV)) {
    const r = await client.query(`SELECT COUNT(*)::bigint AS n FROM ${BUILDINGS_MV}`);
    mvRows = Number(r.rows[0]?.n ?? 0);
  }
  return { features, combos, inseeFeatures, inseeCombos, byInsee, mvRows };
}

export function loadEnvLocal() {
  return loadDotenvMap(`${process.cwd()}/.env.local`);
}

export async function withClient(url, fn) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}
