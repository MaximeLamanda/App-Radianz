#!/usr/bin/env node
/**
 * Copie scout_enedis_consumption_sites (local → Neon) pour un département.
 *
 *   node scripts/sync-enedis-consumption-to-neon.mjs --dep 33
 *
 * Prérequis : LOCAL_DATABASE_URL (source) et Radianz_DATABASE_URL / NEON (cible).
 */
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pickDatabaseUrlFromEnvObject,
  loadDotenvMap,
} from "./lib/resolve-database-url.mjs";
import { isValidDepCode } from "./lib/matching-v5-dep-communes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const TABLE = "public.scout_enedis_consumption_sites";

function loadCommunesFromFile(dep) {
  const p = resolve(REPO_ROOT, "bdnb", `dep${dep}_communes_insee.txt`);
  try {
    return readFileSync(p, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((c) => /^\d{5}$/.test(c));
  } catch {
    return null;
  }
}

function resolveLocalUrl() {
  const env = {
    ...loadDotenvMap(resolve(REPO_ROOT, ".env")),
    ...loadDotenvMap(resolve(REPO_ROOT, ".env.local")),
    ...process.env,
  };
  for (const k of ["LOCAL_DATABASE_URL", "DATABASE_URL"]) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  return pickDatabaseUrlFromEnvObject(env);
}

function resolveNeonUrl() {
  const env = {
    ...loadDotenvMap(resolve(REPO_ROOT, ".env")),
    ...loadDotenvMap(resolve(REPO_ROOT, ".env.local")),
    ...process.env,
  };
  for (const k of [
    "RADIANZ_DATABASE_URL",
    "Radianz_DATABASE_URL",
    "DATABASE_URL",
    "RADIANZ_DATABASE_URL_UNPOOLED",
    "Radianz_DATABASE_URL_UNPOOLED",
  ]) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  return null;
}

async function applySchema(client) {
  const sqlPath = resolve(
    REPO_ROOT,
    "data-pipeline/sql/017_scout_enedis_consumption_sites.sql"
  );
  const raw = readFileSync(sqlPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => !l.trim().startsWith("--"));
  for (const chunk of lines.join("\n").split(";")) {
    const stmt = chunk.trim();
    if (stmt) await client.query(stmt + ";");
  }
}

async function main() {
  const dep = process.argv.find((a) => a.startsWith("--dep="))?.split("=")[1]
    ?? (process.argv.includes("--dep") ? process.argv[process.argv.indexOf("--dep") + 1] : null);

  if (!dep || !isValidDepCode(dep)) {
    console.error("Usage: node scripts/sync-enedis-consumption-to-neon.mjs --dep 33");
    process.exit(1);
  }

  const localUrl = resolveLocalUrl();
  const neonUrl = resolveNeonUrl();
  if (!localUrl || !neonUrl) {
    console.error("LOCAL_DATABASE_URL et URL Neon requises.");
    process.exit(1);
  }

  let communes = loadCommunesFromFile(dep);
  const local = new Client({ connectionString: localUrl });
  const neon = new Client({ connectionString: neonUrl });

  await local.connect();
  await neon.connect();

  try {
    if (!communes?.length) {
      const { rows } = await local.query(
        `SELECT DISTINCT code_commune FROM ${TABLE} WHERE code_commune LIKE $1`,
        [`${dep}%`]
      );
      communes = rows.map((r) => String(r.code_commune).trim());
    }

    if (communes.length === 0) {
      console.error(`Aucune commune / donnée Enedis pour dep ${dep} en local.`);
      process.exit(1);
    }

    await applySchema(neon);

    const { rows } = await local.query(
      `SELECT * FROM ${TABLE} WHERE code_commune = ANY($1::text[])`,
      [communes]
    );

    if (rows.length === 0) {
      console.error("0 ligne à synchroniser — lancer pipeline:enedis:import-dep-" + dep);
      process.exit(1);
    }

    await neon.query(`DELETE FROM ${TABLE} WHERE code_commune = ANY($1::text[])`, [
      communes,
    ]);

    const cols = Object.keys(rows[0]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const insertSql = `INSERT INTO ${TABLE} (${cols.join(", ")}) VALUES (${placeholders})`;

    let n = 0;
    for (const row of rows) {
      await neon.query(
        insertSql,
        cols.map((c) => row[c])
      );
      n += 1;
      if (n % 500 === 0) console.log(`[sync-enedis] ${n}/${rows.length}…`);
    }

    console.log(`[sync-enedis] OK — ${n} ligne(s) dep ${dep} → Neon`);
  } finally {
    await local.end();
    await neon.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
