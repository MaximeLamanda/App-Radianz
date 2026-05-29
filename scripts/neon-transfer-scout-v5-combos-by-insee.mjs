#!/usr/bin/env node
/**
 * Transfère `public.scout_matching_v5_combos` pour un code INSEE
 * depuis LOCAL_DATABASE_URL vers Neon (Radianz_* unpooled).
 *
 * Usage :
 *   node scripts/neon-transfer-scout-v5-combos-by-insee.mjs --code-insee=33318
 */

import { Client } from "pg";
import { loadDotenvMap } from "./lib/resolve-database-url.mjs";

const NEON_HOST = "neon.tech";
const TABLE = "public.scout_matching_v5_combos";

const SELECT_SQL = `
  SELECT
    combo_id,
    code_insee,
    anchor_parcelle_id,
    parcelle_scout_v5_ids,
    osm_building_ids,
    footprint_sum_m2,
    has_landuse_waiver,
    ST_AsEWKT(geom) AS geom_ewkt,
    imported_at,
    zone_tags,
    construction_years,
    parking_sum_m2,
    parcel_contour_sum_m2,
    owner_sirens,
    domiciliation_sirens,
    naf_divisions
  FROM ${TABLE}
  WHERE code_insee = $1
  ORDER BY combo_id
`;

const BATCH_SIZE = 100;

function buildBatchInsertValues(chunk) {
  const parts = [];
  const params = [];
  let n = 1;
  for (const r of chunk) {
    parts.push(
      `($${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, ST_GeomFromEWKT($${n++}::text), $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++})`
    );
    params.push(
      r.combo_id,
      r.code_insee,
      r.anchor_parcelle_id,
      r.parcelle_scout_v5_ids,
      r.osm_building_ids,
      r.footprint_sum_m2,
      r.has_landuse_waiver,
      r.geom_ewkt,
      r.imported_at,
      r.zone_tags,
      r.construction_years,
      r.parking_sum_m2,
      r.parcel_contour_sum_m2,
      r.owner_sirens,
      r.domiciliation_sirens,
      r.naf_divisions
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
    console.error("Usage: node scripts/neon-transfer-scout-v5-combos-by-insee.mjs --code-insee=<INSEE>");
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

  console.error(`[neon-transfer-combos] source locale : ${rows.length} ligne(s) pour code_insee=${codeInsee}`);
  if (rows.length === 0) {
    console.error("[neon-transfer-combos] Rien à transférer.");
    process.exitCode = 1;
    return;
  }

  if (dry) {
    console.error("[neon-transfer-combos] DRY_RUN : aucune écriture.");
    return;
  }

  const neon = new Client({ connectionString: neonUrl });
  await neon.connect();
  try {
    const del = await neon.query(`DELETE FROM ${TABLE} WHERE code_insee = $1`, [codeInsee]);
    console.error(`[neon-transfer-combos] Neon DELETE : ${del.rowCount} ligne(s).`);

    const cols = `combo_id, code_insee, anchor_parcelle_id, parcelle_scout_v5_ids, osm_building_ids, footprint_sum_m2, has_landuse_waiver, geom, imported_at, zone_tags, construction_years, parking_sum_m2, parcel_contour_sum_m2, owner_sirens, domiciliation_sirens, naf_divisions`;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { sql: valuesSql, params } = buildBatchInsertValues(chunk);
      await neon.query(`INSERT INTO ${TABLE} (${cols}) VALUES ${valuesSql}`, params);
      inserted += chunk.length;
    }
    console.error(`[neon-transfer-combos] Neon INSERT : ${inserted} ligne(s).`);
  } finally {
    await neon.end();
  }
}

main().catch((err) => {
  console.error("[neon-transfer-combos]", err);
  process.exit(1);
});
