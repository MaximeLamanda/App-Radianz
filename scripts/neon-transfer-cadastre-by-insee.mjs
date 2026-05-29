#!/usr/bin/env node
/**
 * Transfère `public.cadastre_france_feuilles_geom` pour un code INSEE
 * (parcelles adjacentes Discovery) depuis LOCAL vers Neon.
 *
 * Usage :
 *   node scripts/neon-transfer-cadastre-by-insee.mjs --code-insee=33318
 */

import fs from "node:fs";
import { Client } from "pg";
import { loadDotenvMap } from "./lib/resolve-database-url.mjs";

const NEON_HOST = "neon.tech";
const TABLE = "public.cadastre_france_feuilles_geom";
const SCHEMA_SQL = new URL("../data-pipeline/sql/001_scout_schema.sql", import.meta.url);

const SELECT_SQL = `
  SELECT
    source_id,
    code_insee,
    section,
    numero,
    numero_norm,
    ST_AsEWKT(geom) AS geom_ewkt,
    properties::text AS properties_text,
    created_at,
    updated_at
  FROM ${TABLE}
  WHERE code_insee = $1
  ORDER BY section, numero_norm
`;

const BATCH_SIZE = 200;

function buildBatchInsertValues(chunk) {
  const parts = [];
  const params = [];
  let n = 1;
  for (const r of chunk) {
    parts.push(
      `($${n++}, $${n++}, $${n++}, $${n++}, $${n++}, ST_GeomFromEWKT($${n++}::text), $${n++}::jsonb, $${n++}, $${n++})`
    );
    params.push(
      r.source_id,
      r.code_insee,
      r.section,
      r.numero,
      r.numero_norm,
      r.geom_ewkt,
      r.properties_text,
      r.created_at,
      r.updated_at
    );
  }
  return { sql: parts.join(",\n"), params };
}

function parseCodeInsee(argv) {
  const a = argv.find((x) => x.startsWith("--code-insee="));
  return a ? a.slice("--code-insee=".length).trim() : null;
}

function pickLocalUrl(dot) {
  return (process.env.LOCAL_DATABASE_URL ?? dot.LOCAL_DATABASE_URL ?? "").trim() || null;
}

function pickNeonUrl(dot) {
  const keys = [
    "Radianz_DATABASE_URL_UNPOOLED",
    "RADIANZ_DATABASE_URL_UNPOOLED",
    "Radianz_DATABASE_URL",
    "RADIANZ_DATABASE_URL",
  ];
  for (const k of keys) {
    const v = (process.env[k] ?? dot[k] ?? "").trim();
    if (v && v.includes(NEON_HOST)) return v;
  }
  return null;
}

async function ensureCadastreTable(client) {
  const raw = fs.readFileSync(SCHEMA_SQL, "utf8");
  const start = raw.indexOf("CREATE TABLE IF NOT EXISTS public.cadastre_france_feuilles_geom");
  const end = raw.indexOf("CREATE TABLE IF NOT EXISTS public.scout_etablissements");
  if (start < 0 || end < 0) {
    throw new Error("Bloc SQL cadastre introuvable dans 001_scout_schema.sql");
  }
  await client.query(raw.slice(start, end));
}

async function main() {
  const codeInsee = parseCodeInsee(process.argv.slice(2));
  if (!codeInsee) {
    console.error("Usage: node scripts/neon-transfer-cadastre-by-insee.mjs --code-insee=<INSEE>");
    process.exit(1);
  }

  const dry =
    process.env.DRY_RUN === "1" ||
    process.env.DRY_RUN === "true" ||
    process.argv.includes("--dry-run");

  const dot = loadDotenvMap(`${process.cwd()}/.env.local`);
  const localUrl = pickLocalUrl(dot);
  const neonUrl = pickNeonUrl(dot);

  if (!localUrl) throw new Error("LOCAL_DATABASE_URL manquante.");
  if (!neonUrl) throw new Error(`URL Neon manquante (host ${NEON_HOST}).`);
  if (localUrl === neonUrl) throw new Error("LOCAL et Neon identiques.");

  const local = new Client({ connectionString: localUrl });
  await local.connect();
  let rows;
  try {
    const res = await local.query(SELECT_SQL, [codeInsee]);
    rows = res.rows;
  } finally {
    await local.end();
  }

  console.error(`[neon-transfer-cadastre] source locale : ${rows.length} parcelle(s) pour code_insee=${codeInsee}`);
  if (rows.length === 0) {
    console.error("[neon-transfer-cadastre] Rien à transférer.");
    process.exitCode = 1;
    return;
  }

  if (dry) {
    console.error("[neon-transfer-cadastre] DRY_RUN : aucune écriture.");
    return;
  }

  const neon = new Client({ connectionString: neonUrl });
  await neon.connect();
  try {
    await ensureCadastreTable(neon);
    const del = await neon.query(`DELETE FROM ${TABLE} WHERE code_insee = $1`, [codeInsee]);
    console.error(`[neon-transfer-cadastre] Neon DELETE : ${del.rowCount} ligne(s).`);

    const cols = `source_id, code_insee, section, numero, numero_norm, geom, properties, created_at, updated_at`;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { sql: valuesSql, params } = buildBatchInsertValues(chunk);
      await neon.query(`INSERT INTO ${TABLE} (${cols}) VALUES ${valuesSql}`, params);
      inserted += chunk.length;
    }
    console.error(`[neon-transfer-cadastre] Neon INSERT : ${inserted} ligne(s).`);
  } finally {
    await neon.end();
  }
}

main().catch((err) => {
  console.error("[neon-transfer-cadastre]", err);
  process.exit(1);
});
