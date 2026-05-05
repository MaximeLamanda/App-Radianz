#!/usr/bin/env node
/**
 * Copie `building_geometries_json` depuis une base Postgres source vers une cible
 * (`public.scout_matching_v5_features`), clé `scout_v5_id`.
 *
 * Cas d’usage typique : après `npm run pipeline:matching-v5:backfill-building-geometries`
 * sur le Postgres local, pousser les polygones vers Neon sans refaire le backfill côté cloud.
 *
 * Variables (priorité : CLI puis env puis .env.local) :
 *   SOURCE_DATABASE_URL  ou  --from=<url>   (défaut : LOCAL_DATABASE_URL)
 *   TARGET_DATABASE_URL  ou  --to=<url>     (défaut : Radianz_DATABASE_URL_UNPOOLED puis Radianz_DATABASE_URL)
 *
 *   DRY_RUN=1  — compte et affiche un échantillon, aucune écriture.
 *
 * Exemples :
 *   DRY_RUN=1 node scripts/sync-scout-v5-building-geometries-json.mjs
 *   node scripts/sync-scout-v5-building-geometries-json.mjs --from='postgres://...' --to='postgres://...'
 */

import { Client } from "pg";
import { loadDotenvMap } from "./lib/resolve-database-url.mjs";

const TABLE = "public.scout_matching_v5_features";

const NONEMPTY_SQL = `
  building_geometries_json IS NOT NULL
  AND jsonb_typeof(building_geometries_json) = 'array'
  AND jsonb_array_length(building_geometries_json) > 0
`;

function parseArgs(argv) {
  const out = { from: null, to: null };
  for (const a of argv) {
    if (a.startsWith("--from=")) out.from = a.slice("--from=".length).trim() || null;
    else if (a.startsWith("--to=")) out.to = a.slice("--to=".length).trim() || null;
  }
  return out;
}

function pickUrl(key, dot) {
  const v = process.env[key] ?? dot[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function main() {
  const dry =
    process.env.DRY_RUN === "1" ||
    process.env.DRY_RUN === "true" ||
    process.argv.includes("--dry-run");
  const repoRoot = process.cwd();
  const dot = loadDotenvMap(`${repoRoot}/.env.local`);
  const args = parseArgs(process.argv.slice(2));

  let sourceUrl =
    (process.env.SOURCE_DATABASE_URL && process.env.SOURCE_DATABASE_URL.trim()) ||
    args.from ||
    pickUrl("LOCAL_DATABASE_URL", dot);
  let targetUrl =
    (process.env.TARGET_DATABASE_URL && process.env.TARGET_DATABASE_URL.trim()) ||
    args.to ||
    pickUrl("Radianz_DATABASE_URL_UNPOOLED", dot) ||
    pickUrl("Radianz_DATABASE_URL", dot) ||
    pickUrl("RADIANZ_DATABASE_URL_UNPOOLED", dot) ||
    pickUrl("RADIANZ_DATABASE_URL", dot);

  if (!sourceUrl) {
    throw new Error("SOURCE manquante : SOURCE_DATABASE_URL, --from= ou LOCAL_DATABASE_URL dans .env.local");
  }
  if (!targetUrl) {
    throw new Error(
      "TARGET manquante : TARGET_DATABASE_URL, --to= ou Radianz_DATABASE_URL_UNPOOLED dans .env.local"
    );
  }
  if (sourceUrl === targetUrl) {
    throw new Error("SOURCE et TARGET identiques : vérifie les URLs.");
  }

  const src = new Client({ connectionString: sourceUrl });
  await src.connect();
  let tgt = null;
  try {
    const { rows: countRows } = await src.query(`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE ${NONEMPTY_SQL})::bigint AS nonempty
      FROM ${TABLE}
    `);
    const total = Number(countRows[0].total);
    const nonempty = Number(countRows[0].nonempty);
    console.error(
      `[sync-v5-geom] source : total_rows=${total} building_geometries_json_nonempty=${nonempty}`
    );

    if (nonempty === 0) {
      console.error(
        "[sync-v5-geom] Rien à copier : la source n’a aucune ligne avec building_geometries_json non vide."
      );
      console.error(
        "[sync-v5-geom] Lance d’abord sur la source : npm run pipeline:matching-v5:backfill-building-geometries"
      );
      process.exitCode = 1;
      return;
    }

    const { rows } = await src.query(`
      SELECT scout_v5_id, building_geometries_json
      FROM ${TABLE}
      WHERE ${NONEMPTY_SQL}
      ORDER BY scout_v5_id
    `);

    if (dry) {
      const sample = rows.slice(0, 5).map((r) => r.scout_v5_id);
      console.error(`[sync-v5-geom] DRY_RUN : ${rows.length} ligne(s) seraient mises à jour sur la cible.`);
      console.error(`[sync-v5-geom] DRY_RUN : échantillon scout_v5_id : ${sample.join(", ")}`);
      return;
    }

    tgt = new Client({ connectionString: targetUrl });
    await tgt.connect();

    let updated = 0;
    let missing = 0;
    for (const row of rows) {
      const id = String(row.scout_v5_id ?? "").trim();
      if (!id) continue;
      const payload =
        row.building_geometries_json !== undefined && row.building_geometries_json !== null
          ? JSON.stringify(row.building_geometries_json)
          : "[]";
      const chk = await tgt.query(`SELECT 1 FROM ${TABLE} WHERE scout_v5_id = $1 LIMIT 1`, [id]);
      if (chk.rowCount === 0) {
        missing += 1;
        continue;
      }
      await tgt.query(
        `
        UPDATE ${TABLE}
        SET
          building_geometries_json = $2::jsonb,
          properties_json = jsonb_set(
            COALESCE(properties_json, '{}'::jsonb),
            '{building_geometries_json}',
            $2::jsonb,
            true
          )
        WHERE scout_v5_id = $1
        `,
        [id, payload]
      );
      updated += 1;
    }

    console.error(
      `[sync-v5-geom] OK : updated=${updated} missing_on_target=${missing} (source_nonempty=${rows.length})`
    );
  } finally {
    await src.end();
    if (tgt) await tgt.end();
  }
}

main().catch((err) => {
  console.error("[sync-v5-geom]", err);
  process.exit(1);
});
