#!/usr/bin/env node
/**
 * Stats agrégées sur public.scout_leads (jointure SIRENE → BDNB).
 * Charge .env.local comme l’app Next (clés Radianz_DATABASE_URL, etc.).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const KEYS = [
  "RADIANZ_DATABASE_URL",
  "Radianz_DATABASE_URL",
  "RADIANZ_POSTGRES_URL",
  "Radianz_POSTGRES_URL",
  "POSTGRES_URL",
  "DATABASE_URL",
  "RADIANZ_DATABASE_URL_UNPOOLED",
  "Radianz_DATABASE_URL_UNPOOLED",
  "DATABASE_URL_UNPOOLED",
  "RADIANZ_POSTGRES_URL_NON_POOLING",
  "Radianz_POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL_NON_POOLING",
];

function loadDotEnvLocal() {
  const p = join(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      v.length >= 2 &&
      ((v[0] === v[v.length - 1] && v[0] === '"') ||
        (v[0] === v[v.length - 1] && v[0] === "'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

function databaseUrl() {
  for (const k of KEYS) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return null;
}

async function main() {
  loadDotEnvLocal();
  const url = databaseUrl();
  if (!url) {
    console.error(
      "Aucune URL Postgres (définir Radianz_DATABASE_URL ou DATABASE_URL dans .env.local)."
    );
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 15000,
    statement_timeout: 60000,
  });

  await client.connect();

  const exists = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'scout_leads'
    ) AS ok
  `);
  if (!exists.rows[0]?.ok) {
    console.log(JSON.stringify({ error: "Table public.scout_leads absente (schéma non appliqué ou pas d’import)." }, null, 2));
    await client.end();
    process.exit(0);
  }

  const [
    total,
    geo,
    byDept,
    effectif,
    dates,
    sirenDistinct,
  ] = await Promise.all([
    client.query(`SELECT COUNT(*)::bigint AS n FROM public.scout_leads`),
    client.query(`
      SELECT
        COUNT(*) FILTER (WHERE geom_wgs84 IS NOT NULL)::bigint AS avec_geom,
        COUNT(*) FILTER (WHERE geom_wgs84 IS NULL)::bigint AS sans_geom,
        COUNT(*) FILTER (WHERE poi_json IS NOT NULL)::bigint AS avec_poi_json
      FROM public.scout_leads
    `),
    client.query(`
      SELECT LEFT(code_commune_insee, 2) AS dep, COUNT(*)::bigint AS n
      FROM public.scout_leads
      WHERE code_commune_insee IS NOT NULL AND length(trim(code_commune_insee)) >= 2
      GROUP BY 1
      ORDER BY n DESC
      LIMIT 25
    `),
    client.query(`
      SELECT effectif_score, COUNT(*)::bigint AS n
      FROM public.scout_leads
      GROUP BY effectif_score
      ORDER BY effectif_score DESC NULLS LAST
    `),
    client.query(`
      SELECT
        MIN(created_at) AS premier_import,
        MAX(created_at) AS dernier_import
      FROM public.scout_leads
    `),
    client.query(`SELECT COUNT(DISTINCT siren)::bigint AS n FROM public.scout_leads WHERE siren IS NOT NULL AND siren <> ''`),
  ]);

  const out = {
    table: "public.scout_leads",
    total_leads: Number(total.rows[0].n),
    geometrie: {
      avec_geom_wgs84: Number(geo.rows[0].avec_geom),
      sans_geom_wgs84: Number(geo.rows[0].sans_geom),
      avec_poi_json: Number(geo.rows[0].avec_poi_json),
    },
    siren_distincts: Number(sirenDistinct.rows[0].n),
    par_departement_top25: byDept.rows.map((r) => ({
      departement: r.dep,
      leads: Number(r.n),
    })),
    par_effectif_score: effectif.rows.map((r) => ({
      effectif_score: r.effectif_score,
      leads: Number(r.n),
    })),
    created_at: {
      min: dates.rows[0]?.premier_import,
      max: dates.rows[0]?.dernier_import,
    },
  };

  console.log(JSON.stringify(out, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
