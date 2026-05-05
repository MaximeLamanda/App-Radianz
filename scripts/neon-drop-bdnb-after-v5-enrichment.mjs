#!/usr/bin/env node
/**
 * Supprime les tables BDNB devenues optionnelles après enrichissement V5.
 *
 * Garde-fous :
 * - cible Neon uniquement
 * - vérifie la présence de `building_geometries_json` sur la table scout
 * - refuse d'exécuter si des lignes parcelle n'ont pas encore cette donnée
 *
 * Usage :
 *   DRY_RUN=1 node scripts/neon-drop-bdnb-after-v5-enrichment.mjs
 *   node scripts/neon-drop-bdnb-after-v5-enrichment.mjs
 */

import { Client } from "pg";
import { loadDotenvMap } from "./lib/resolve-database-url.mjs";

const NEON_HOST_SNIPPET = "neon.tech";
const URL_KEYS = [
  "NEON_ARTIFACT_DROP_URL",
  "Radianz_DATABASE_URL_UNPOOLED",
  "RADIANZ_DATABASE_URL_UNPOOLED",
  "Radianz_DATABASE_URL",
  "RADIANZ_DATABASE_URL",
];

function pickNeonUrlOnly(repoRoot) {
  const dot = loadDotenvMap(`${repoRoot}/.env.local`);
  for (const k of URL_KEYS) {
    const v = process.env[k] ?? dot[k];
    if (typeof v === "string" && v.trim() && v.includes(NEON_HOST_SNIPPET)) {
      return { url: v.trim(), source: k };
    }
  }
  return null;
}

const DROP_STATEMENTS = [
  "DROP TABLE IF EXISTS public.batiment_construction CASCADE",
  "DROP TABLE IF EXISTS public.batiment_groupe_ffo_bat CASCADE",
  "DROP TABLE IF EXISTS public.bdnb_buildings CASCADE",
  "DROP TABLE IF EXISTS public.bdnb_pessac_geom_raw CASCADE",
  "DROP TABLE IF EXISTS public.bdnb_talence_geom_raw CASCADE",
];

async function ensureBackfillComplete(client) {
  const columnCheck = await client.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'scout_matching_v5_features'
      AND column_name = 'building_geometries_json'
    LIMIT 1
  `);
  if (columnCheck.rowCount === 0) {
    throw new Error("Colonne public.scout_matching_v5_features.building_geometries_json absente.");
  }

  const missing = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM public.scout_matching_v5_features
    WHERE grain = 'parcelle'
      AND (
        building_geometries_json IS NULL
        OR jsonb_typeof(building_geometries_json) <> 'array'
        OR (
          COALESCE(jsonb_array_length(building_geometries_json), 0) = 0
          AND CASE
            WHEN jsonb_typeof(COALESCE(properties_json->'buildings_json', '[]'::jsonb)) = 'array'
              THEN jsonb_array_length(COALESCE(properties_json->'buildings_json', '[]'::jsonb))
            ELSE 0
          END > 0
        )
      )
  `);
  const count = Number(missing.rows[0]?.count ?? 0);
  if (count > 0) {
    throw new Error(`Backfill incomplet: ${count} ligne(s) parcelle ont encore des bâtiments non enrichis.`);
  }
}

async function main() {
  const dry = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  const picked = pickNeonUrlOnly(process.cwd());
  if (!picked) {
    throw new Error("Aucune URL Neon trouvée pour exécuter le nettoyage BDNB.");
  }

  const client = new Client({ connectionString: picked.url });
  await client.connect();
  try {
    await ensureBackfillComplete(client);
    console.error(`[neon-drop-bdnb] Cible ${picked.source} — ${dry ? "DRY_RUN" : "EXÉCUTION"}`);
    if (dry) {
      for (const stmt of DROP_STATEMENTS) console.log(`${stmt};`);
      return;
    }
    for (const stmt of DROP_STATEMENTS) {
      await client.query(`${stmt};`);
      console.error(`[neon-drop-bdnb] OK ${stmt}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[neon-drop-bdnb]", err);
  process.exit(1);
});
