#!/usr/bin/env node
/**
 * Transfère les lignes `public.scout_matching_v5_features` pour un code INSEE
 * depuis le Postgres local (LOCAL_DATABASE_URL) vers Neon (Radianz_* unpooled).
 *
 * Idempotent : DELETE sur la cible pour ce INSEE, puis INSERT des lignes source.
 *
 * Usage :
 *   DRY_RUN=1 node scripts/neon-transfer-scout-v5-features-by-insee.mjs --code-insee=33318
 *   node scripts/neon-transfer-scout-v5-features-by-insee.mjs --code-insee=33318
 */

import { Client } from "pg";
import { loadDotenvMap } from "./lib/resolve-database-url.mjs";

const NEON_HOST = "neon.tech";
const TABLE = "public.scout_matching_v5_features";

const SELECT_SQL = `
  SELECT
    scout_v5_id,
    ST_AsEWKT(geom) AS geom_ewkt,
    grain,
    code_insee,
    section,
    numero_norm,
    nb_batiments,
    footprint_sum_m2,
    siret_count,
    status_technique,
    status_metier,
    matching_confidence,
    siren_status,
    building_geometries_json::text AS building_geometries_json_text,
    properties_json::text AS properties_json_text,
    source_run,
    imported_at
  FROM ${TABLE}
  WHERE code_insee = $1
  ORDER BY scout_v5_id
`;

const BATCH_SIZE = 80;

function buildBatchInsertValues(chunk) {
  const parts = [];
  const params = [];
  let n = 1;
  for (const r of chunk) {
    parts.push(
      `($${n++}, ST_GeomFromEWKT($${n++}::text), $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}::jsonb, $${n++}::jsonb, $${n++}, $${n++})`
    );
    params.push(
      r.scout_v5_id,
      r.geom_ewkt,
      r.grain,
      r.code_insee,
      r.section,
      r.numero_norm,
      r.nb_batiments,
      r.footprint_sum_m2,
      r.siret_count,
      r.status_technique,
      r.status_metier,
      r.matching_confidence,
      r.siren_status,
      r.building_geometries_json_text,
      r.properties_json_text,
      r.source_run,
      r.imported_at
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

async function main() {
  const codeInsee = parseCodeInsee(process.argv.slice(2));
  if (!codeInsee) {
    console.error("Usage: node scripts/neon-transfer-scout-v5-features-by-insee.mjs --code-insee=<INSEE>");
    process.exit(1);
  }

  const dry =
    process.env.DRY_RUN === "1" ||
    process.env.DRY_RUN === "true" ||
    process.argv.includes("--dry-run");

  const dot = loadDotenvMap(`${process.cwd()}/.env.local`);
  const localUrl = pickLocalUrl(dot);
  const neonUrl = pickNeonUrl(dot);

  if (!localUrl) {
    throw new Error("LOCAL_DATABASE_URL manquante (env ou .env.local).");
  }
  if (!neonUrl) {
    throw new Error(
      `URL Neon manquante (host doit contenir ${NEON_HOST}) : Radianz_DATABASE_URL_UNPOOLED ou Radianz_DATABASE_URL.`
    );
  }
  if (localUrl === neonUrl) {
    throw new Error("LOCAL et Neon identiques : vérifie les URLs.");
  }

  const local = new Client({ connectionString: localUrl });
  await local.connect();
  let rows;
  try {
    const res = await local.query(SELECT_SQL, [codeInsee]);
    rows = res.rows;
  } finally {
    await local.end();
  }

  console.error(`[neon-transfer-v5] source locale : ${rows.length} ligne(s) pour code_insee=${codeInsee}`);

  if (rows.length === 0) {
    console.error("[neon-transfer-v5] Rien à transférer. Vérifie le matching local et le code INSEE.");
    process.exitCode = 1;
    return;
  }

  if (dry) {
    console.error("[neon-transfer-v5] DRY_RUN : aucune écriture sur Neon.");
    return;
  }

  const neon = new Client({ connectionString: neonUrl });
  await neon.connect();
  try {
    const del = await neon.query(`DELETE FROM ${TABLE} WHERE code_insee = $1`, [codeInsee]);
    console.error(`[neon-transfer-v5] Neon DELETE code_insee=${codeInsee} : ${del.rowCount} ligne(s) supprimée(s).`);

    const cols = `scout_v5_id, geom, grain, code_insee, section, numero_norm, nb_batiments, footprint_sum_m2, siret_count, status_technique, status_metier, matching_confidence, siren_status, building_geometries_json, properties_json, source_run, imported_at`;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { sql: valuesSql, params } = buildBatchInsertValues(chunk);
      await neon.query(
        `INSERT INTO ${TABLE} (${cols}) VALUES ${valuesSql}`,
        params
      );
      inserted += chunk.length;
    }
    console.error(`[neon-transfer-v5] Neon INSERT : ${inserted} ligne(s).`);
  } finally {
    await neon.end();
  }
}

main().catch((err) => {
  console.error("[neon-transfer-v5]", err);
  process.exit(1);
});
