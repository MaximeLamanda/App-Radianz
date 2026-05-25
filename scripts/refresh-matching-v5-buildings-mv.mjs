#!/usr/bin/env node
/**
 * Rafraîchit la vue matérialisée `public.scout_matching_v5_buildings_mv`
 * (1 ligne par osm_building_id, source : scout_matching_v5_features.building_geometries_json).
 *
 * Usage :
 *   node scripts/refresh-matching-v5-buildings-mv.mjs
 *   CONCURRENTLY=0 node scripts/refresh-matching-v5-buildings-mv.mjs   # premier refresh / table vide
 */
import { Client } from "pg";
import { resolveDatabaseUrl } from "./lib/resolve-database-url.mjs";

const MV_NAME = "public.scout_matching_v5_buildings_mv";

const url = resolveDatabaseUrl(process.cwd());
if (!url) {
  console.error(
    "[refresh-matching-v5-buildings-mv] Aucune URL Postgres (LOCAL_DATABASE_URL / Radianz_DATABASE_URL / .env.local)."
  );
  process.exit(1);
}

const concurrently = process.env.CONCURRENTLY !== "0" && process.env.CONCURRENTLY !== "false";

const client = new Client({ connectionString: url });
await client.connect();
try {
  const t0 = Date.now();
  const sql = concurrently
    ? `REFRESH MATERIALIZED VIEW CONCURRENTLY ${MV_NAME}`
    : `REFRESH MATERIALIZED VIEW ${MV_NAME}`;
  console.log(`[refresh-matching-v5-buildings-mv] ${sql}`);
  await client.query(sql);
  const ms = Date.now() - t0;
  const { rows } = await client.query(`SELECT count(*)::bigint AS n FROM ${MV_NAME}`);
  const n = rows[0]?.n ?? "?";
  console.log(`[refresh-matching-v5-buildings-mv] OK (${ms} ms) — ${n} ligne(s).`);
  console.log(
    "[refresh-matching-v5-buildings-mv] Astuce cache tuiles : bump SCOUT_BUILDINGS_MVT_REVISION (Vercel / .env.local) pour invalider ETag navigateur après refresh."
  );
} catch (err) {
  console.error("[refresh-matching-v5-buildings-mv] Erreur :", err.message ?? err);
  if (concurrently && /index/i.test(String(err.message ?? ""))) {
    console.error(
      "[refresh-matching-v5-buildings-mv] Conseil : lancer une première fois avec CONCURRENTLY=0 puis garder l'index UNIQUE."
    );
  }
  process.exit(1);
} finally {
  await client.end();
}
