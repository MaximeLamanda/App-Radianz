/**
 * Supprime les tables BDNB locales pour repartir de zéro avant un import propre.
 *
 * - Table des bâtiments (BDNB_BUILDINGS_TABLE, défaut public.bdnb_buildings)
 * - Tables sans jointure : public.bdnb_pessac_geom_raw, public.bdnb_talence_geom_raw
 *
 * Usage : node scripts/clean-bdnb-postgres.mjs
 * Puis : npm run import:bdnb-dep33
 */
import path from "node:path";
import { Client } from "pg";
import { loadDotenvMap, resolveDatabaseUrl } from "./lib/resolve-database-url.mjs";

const root = process.cwd();
const dot = loadDotenvMap(path.join(root, ".env.local"));
for (const [k, v] of Object.entries(dot)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

const databaseUrl = resolveDatabaseUrl(root);
if (!databaseUrl) {
  console.error("Aucune DATABASE_URL / LOCAL_DATABASE_URL (voir .env.local).");
  process.exit(1);
}

const raw = (process.env.BDNB_BUILDINGS_TABLE || "public.bdnb_buildings").trim();
const parts = raw.split(".").map((s) => s.trim()).filter(Boolean);
const schema = parts.length === 2 ? parts[0] : "public";
const table = parts.length === 2 ? parts[1] : parts[0];
const qualifiedBuildings = `"${schema}"."${table}"`;

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(`DROP TABLE IF EXISTS public.bdnb_pessac_geom_raw CASCADE`);
  console.log("[clean-bdnb] DROP public.bdnb_pessac_geom_raw");
  await client.query(`DROP TABLE IF EXISTS public.bdnb_talence_geom_raw CASCADE`);
  console.log("[clean-bdnb] DROP public.bdnb_talence_geom_raw");
  await client.query(`DROP TABLE IF EXISTS ${qualifiedBuildings} CASCADE`);
  console.log(`[clean-bdnb] DROP ${qualifiedBuildings}`);
  console.log("[clean-bdnb] OK. Lance : npm run import:bdnb-dep33");
} finally {
  await client.end();
}
