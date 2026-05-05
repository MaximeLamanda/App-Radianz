#!/usr/bin/env node
/**
 * Supprime sur Neon les tables / vues « pipeline » non utilisées par Discovery côté app.
 *
 * Conservé : public.scout_matching_v5_features, public.batiment_construction,
 *            public.batiment_groupe_ffo_bat (et PostGIS / spatial_ref_sys).
 *
 * Connexion : URL **Neon uniquement** (host doit contenir `neon.tech`).
 * Ordre de priorité : NEON_ARTIFACT_DROP_URL, puis Radianz_DATABASE_URL_UNPOOLED /
 * RADIANZ_DATABASE_URL_UNPOOLED, puis Radianz_DATABASE_URL / RADIANZ_DATABASE_URL.
 * `LOCAL_DATABASE_URL` est **ignoré** pour éviter d’effacer le Docker local.
 *
 * Usage :
 *   DRY_RUN=1 node scripts/neon-drop-discovery-artifact-tables.mjs   # affiche le SQL
 *   node scripts/neon-drop-discovery-artifact-tables.mjs             # exécute les DROP
 */

import { Client } from "pg";
import { loadDotenvMap } from "./lib/resolve-database-url.mjs";

const NEON_HOST_SNIPPET = "neon.tech";

const NEON_URL_KEYS = [
  "NEON_ARTIFACT_DROP_URL",
  "Radianz_DATABASE_URL_UNPOOLED",
  "RADIANZ_DATABASE_URL_UNPOOLED",
  "Radianz_DATABASE_URL",
  "RADIANZ_DATABASE_URL",
];

function pickNeonUrlOnly(repoRoot) {
  const dot = loadDotenvMap(`${repoRoot}/.env.local`);
  for (const k of NEON_URL_KEYS) {
    const v = process.env[k] ?? dot[k];
    if (typeof v === "string" && v.trim() && v.includes(NEON_HOST_SNIPPET)) {
      return { url: v.trim(), source: k };
    }
  }
  return null;
}

const STATEMENTS = [
  "DROP VIEW IF EXISTS public.scout_leads_pessac_enriched CASCADE",
  "DROP TABLE IF EXISTS public.scout_leads CASCADE",
  "DROP TABLE IF EXISTS public.parcelles_personnes_morales CASCADE",
  "DROP TABLE IF EXISTS public.cadastre_france_feuilles_geom CASCADE",
  "DROP TABLE IF EXISTS public.scout_etablissements CASCADE",
  "DROP TABLE IF EXISTS public.bdnb_buildings CASCADE",
  "DROP TABLE IF EXISTS public.bdnb_pessac_geom_raw CASCADE",
  "DROP TABLE IF EXISTS public.bdnb_talence_geom_raw CASCADE",
  "DROP TABLE IF EXISTS public.osm_poi CASCADE",
];

async function main() {
  const dry = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  const picked = pickNeonUrlOnly(process.cwd());
  if (!picked) {
    console.error(
      `[neon-drop-artifacts] Aucune URL Neon trouvée (host doit contenir "${NEON_HOST_SNIPPET}"). ` +
        `Définis par ex. NEON_ARTIFACT_DROP_URL ou Radianz_DATABASE_URL_UNPOOLED dans .env.local. ` +
        "LOCAL_DATABASE_URL est ignoré."
    );
    process.exit(1);
  }
  // Garde-fou : ne jamais exécuter si l’URL résolue par erreur ne pointe pas sur Neon
  if (!picked.url.includes(NEON_HOST_SNIPPET)) {
    console.error("[neon-drop-artifacts] URL invalide (neon.tech attendu).");
    process.exit(1);
  }

  console.error(`[neon-drop-artifacts] Cible : (${picked.source}) hôte Neon — ${dry ? "DRY_RUN" : "EXÉCUTION"}`);

  if (dry) {
    for (const s of STATEMENTS) {
      console.log(`${s};`);
    }
    console.error("[neon-drop-artifacts] DRY_RUN=1 : aucune requête envoyée. Relance sans DRY_RUN pour appliquer.");
    return;
  }

  const client = new Client({ connectionString: picked.url });
  await client.connect();
  try {
    for (const sql of STATEMENTS) {
      const r = await client.query(`${sql};`);
      console.error(`[neon-drop-artifacts] OK: ${sql} (${r.rowCount ?? 0})`);
    }
  } finally {
    await client.end();
  }
  console.error("[neon-drop-artifacts] Terminé.");
}

main().catch((e) => {
  console.error("[neon-drop-artifacts]", e);
  process.exit(1);
});
