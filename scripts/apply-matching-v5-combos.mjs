#!/usr/bin/env node
/**
 * Crée la table scout_matching_v5_combos si absente (idempotent).
 * Fichier SQL : data-pipeline/sql/010_scout_matching_v5_combos.sql
 *
 * Usage :
 *   node scripts/apply-matching-v5-combos.mjs
 */
import fs from "node:fs";
import { Client } from "pg";
import { resolveDatabaseUrl } from "./lib/resolve-database-url.mjs";

const sqlPaths = [
  new URL("../data-pipeline/sql/010_scout_matching_v5_combos.sql", import.meta.url),
  new URL("../data-pipeline/sql/011_scout_matching_v5_combos_zone_tags.sql", import.meta.url),
  new URL("../data-pipeline/sql/012_scout_matching_v5_combos_construction_years.sql", import.meta.url),
  new URL("../data-pipeline/sql/013_scout_matching_v5_combos_parking_sum_m2.sql", import.meta.url),
  new URL(
    "../data-pipeline/sql/014_scout_matching_v5_combos_parcel_contour_sum_m2.sql",
    import.meta.url
  ),
  new URL(
    "../data-pipeline/sql/015_scout_matching_v5_combos_siren_naf.sql",
    import.meta.url
  ),
];

const url = resolveDatabaseUrl(process.cwd());
if (!url) {
  console.error(
    "[apply-matching-v5-combos] Aucune URL Postgres (LOCAL_DATABASE_URL / Radianz_DATABASE_URL / .env.local)."
  );
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();
try {
  for (const sqlPath of sqlPaths) {
    const sql = fs.readFileSync(sqlPath, "utf8");
    console.log(`[apply-matching-v5-combos] Exécution ${sqlPath.pathname.split("/").pop()}…`);
    await client.query(sql);
  }
  const { rows } = await client.query(
    "SELECT count(*)::bigint AS n FROM public.scout_matching_v5_combos"
  );
  const n = rows[0]?.n ?? "?";
  console.log(`[apply-matching-v5-combos] OK — ${n} ligne(s) dans scout_matching_v5_combos.`);
} catch (err) {
  console.error("[apply-matching-v5-combos] Erreur :", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
