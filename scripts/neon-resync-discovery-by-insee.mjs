#!/usr/bin/env node
/**
 * Resynchronise Neon avec le Postgres local pour Discovery (une commune INSEE).
 *
 * Ordre :
 *   1. scout_matching_v5_features
 *   2. scout_matching_v5_combos
 *   3. cadastre_france_feuilles_geom (parcelles adjacentes)
 *   4. building_geometries_json (filet de sécurité)
 *   5. REFRESH scout_matching_v5_buildings_mv sur Neon
 *   6. scout_enedis_consumption_sites (département de la commune)
 *
 * Usage :
 *   node scripts/neon-resync-discovery-by-insee.mjs --code-insee=33318
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadDotenvMap } from "./lib/resolve-database-url.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function parseCodeInsee(argv) {
  const a = argv.find((x) => x.startsWith("--code-insee="));
  return a ? a.slice("--code-insee=".length).trim() : null;
}

function depFromInsee(codeInsee) {
  if (!/^\d{5}$/.test(codeInsee)) return null;
  if (codeInsee.startsWith("97") || codeInsee.startsWith("98")) {
    return codeInsee.slice(0, 3);
  }
  return codeInsee.slice(0, 2);
}

function runNode(script, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, script), ...args], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exit ${code}`));
    });
  });
}

async function main() {
  const codeInsee = parseCodeInsee(process.argv.slice(2));
  if (!codeInsee) {
    console.error("Usage: node scripts/neon-resync-discovery-by-insee.mjs --code-insee=<INSEE>");
    process.exit(1);
  }

  const dep = depFromInsee(codeInsee);
  if (!dep) {
    console.error(`[neon-resync-discovery] code INSEE invalide : ${codeInsee}`);
    process.exit(1);
  }

  const dot = loadDotenvMap(`${ROOT}/.env.local`);
  const neonUrl =
    (process.env.Radianz_DATABASE_URL_UNPOOLED ?? dot.Radianz_DATABASE_URL_UNPOOLED ?? "").trim() ||
    (process.env.Radianz_DATABASE_URL ?? dot.Radianz_DATABASE_URL ?? "").trim();
  if (!neonUrl.includes("neon.tech")) {
    throw new Error("URL Neon introuvable dans .env.local (Radianz_DATABASE_URL_UNPOOLED).");
  }

  const flag = `--code-insee=${codeInsee}`;
  console.error(`[neon-resync-discovery] Début resync Discovery pour ${codeInsee} (dep ${dep})`);

  await runNode("neon-transfer-scout-v5-features-by-insee.mjs", [flag]);
  await runNode("neon-transfer-scout-v5-combos-by-insee.mjs", [flag]);
  await runNode("neon-transfer-cadastre-by-insee.mjs", [flag]);
  await runNode("sync-scout-v5-building-geometries-json.mjs", []);
  await runNode("refresh-matching-v5-buildings-mv.mjs", [`--to=${neonUrl}`], {
    CONCURRENTLY: "0",
  });
  await runNode("sync-enedis-consumption-to-neon.mjs", [`--dep`, dep]);

  console.error(`[neon-resync-discovery] Terminé pour ${codeInsee}.`);
}

main().catch((err) => {
  console.error("[neon-resync-discovery]", err);
  process.exit(1);
});
