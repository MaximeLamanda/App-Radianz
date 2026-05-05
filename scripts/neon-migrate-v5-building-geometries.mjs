#!/usr/bin/env node
/**
 * Migration Neon : ajoute `building_geometries_json` à la table scout,
 * puis backfill la colonne via le script python.
 *
 * Aucun DROP ici. Objectif : rendre possible le dry-run du cleanup BDNB.
 *
 * Usage:
 *   DRY_RUN=1 node scripts/neon-migrate-v5-building-geometries.mjs
 *   node scripts/neon-migrate-v5-building-geometries.mjs
 */

import { Client } from "pg";
import { spawn } from "node:child_process";
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

function spawnPythonBackfill({ databaseUrl, dryRun }) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl,
    };
    const args = [
      "data-pipeline/matching_v5/backfill_building_geometries_v5.py",
      ...(dryRun ? ["--dry-run"] : []),
    ];
    const child = spawn("python3", args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Backfill python exit ${code}`));
    });
  });
}

async function main() {
  const dry = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  const picked = pickNeonUrlOnly(process.cwd());
  if (!picked) {
    throw new Error("Aucune URL Neon trouvée (host neon.tech requis).");
  }

  const client = new Client({ connectionString: picked.url });
  await client.connect();
  try {
    console.error(`[neon-migrate-v5] Cible : (${picked.source}) ${dry ? "DRY_RUN" : "EXÉCUTION"}`);
    const sql = `
      ALTER TABLE public.scout_matching_v5_features
      ADD COLUMN IF NOT EXISTS building_geometries_json JSONB NOT NULL DEFAULT '[]'::jsonb
    `;
    if (dry) {
      console.log(`${sql.trim().replace(/\s+/g, " ")};`);
      console.error("[neon-migrate-v5] DRY_RUN=1 : migration non appliquée, backfill non lancé.");
      return;
    }
    await client.query(sql);
    console.error("[neon-migrate-v5] OK : colonne ajoutée (si absente).");
  } finally {
    await client.end();
  }

  await spawnPythonBackfill({ databaseUrl: picked.url, dryRun: false });
}

main().catch((err) => {
  console.error("[neon-migrate-v5]", err);
  process.exit(1);
});

