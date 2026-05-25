#!/usr/bin/env node
/**
 * Crée la vue matérialisée et les index si absents (idempotent : IF NOT EXISTS).
 * Fichier SQL : data-pipeline/sql/007_scout_matching_v5_buildings_mv.sql
 *
 * Usage :
 *   node scripts/apply-matching-v5-buildings-mv.mjs
 */
import fs from "node:fs";
import { Client } from "pg";
import { resolveDatabaseUrl } from "./lib/resolve-database-url.mjs";

const sqlPath = new URL("../data-pipeline/sql/007_scout_matching_v5_buildings_mv.sql", import.meta.url);

const url = resolveDatabaseUrl(process.cwd());
if (!url) {
  console.error(
    "[apply-matching-v5-buildings-mv] Aucune URL Postgres (LOCAL_DATABASE_URL / Radianz_DATABASE_URL / .env.local)."
  );
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, "utf8");
const client = new Client({ connectionString: url });
await client.connect();
try {
  console.log("[apply-matching-v5-buildings-mv] Exécution du SQL 007…");
  await client.query(sql);
  const { rows } = await client.query(
    "SELECT count(*)::bigint AS n FROM public.scout_matching_v5_buildings_mv"
  );
  const n = rows[0]?.n ?? "?";
  console.log(`[apply-matching-v5-buildings-mv] OK — ${n} ligne(s) dans scout_matching_v5_buildings_mv.`);
} catch (err) {
  console.error("[apply-matching-v5-buildings-mv] Erreur :", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
