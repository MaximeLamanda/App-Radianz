/**
 * Applique data-pipeline/sql/002_scout_bdnb_poi_sample.sql sur Postgres local (ou toute URL dans .env.local).
 *
 * Usage : npm run bdnb:poi-sample:schema
 */
import fs from "node:fs";
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

const sqlPath = path.join(root, "data-pipeline/sql/002_scout_bdnb_poi_sample.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("CREATE EXTENSION IF NOT EXISTS postgis");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("[bdnb:poi-sample:schema] OK — table public.scout_bdnb_poi_sample");
} catch (e) {
  await client.query("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  await client.end();
}
