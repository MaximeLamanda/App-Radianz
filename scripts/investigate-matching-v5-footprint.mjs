#!/usr/bin/env node
/**
 * Diagnostic « empreinte manquante » : compare buildings_json (export V5)
 * et building_geometries_json (OSM embarqué) pour les lignes scout_matching_v5
 * dans une tuile WebMercator ou sous un point WGS84.
 *
 * Usage (depuis la racine du repo, .env.local avec Postgres comme l’app) :
 *
 *   node scripts/investigate-matching-v5-footprint.mjs --tile=17,65258,47297
 *   node scripts/investigate-matching-v5-footprint.mjs --lat=44.9021 --lng=-0.5678
 *   node scripts/investigate-matching-v5-footprint.mjs --scout-v5-id=parcelle:33318:...
 *
 * Variables :
 *   SCOUT_MATCHING_V5_TABLE (optionnel, défaut public.scout_matching_v5_features)
 *   URL Postgres : même ordre que scripts/lib/resolve-database-url.mjs
 */

import pg from "pg";
import { resolveDatabaseUrl } from "./lib/resolve-database-url.mjs";

const DEFAULT_TABLE = "public.scout_matching_v5_features";
const IDENT = /^[a-z][a-z0-9_]*$/;

function parseArg(name) {
  const p = process.argv.find((a) => a.startsWith(`${name}=`));
  return p ? p.slice(name.length + 1).trim() : null;
}

function parseQualifiedTable(raw) {
  const t = (raw || DEFAULT_TABLE).trim();
  const parts = t.split(".").map((p) => p.trim()).filter(Boolean);
  const schema = parts.length === 2 ? parts[0] : "public";
  const table = parts.length === 2 ? parts[1] : parts[0];
  if (!IDENT.test(schema) || !IDENT.test(table)) {
    throw new Error(`Identifiant schéma/table invalide: "${t}"`);
  }
  return { schema, table, qualifiedSql: `"${schema}"."${table}"` };
}

function safeJsonParse(s) {
  if (s == null) return null;
  if (typeof s === "object") return s;
  const t = String(s).trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function extractBuildingsArray(propertiesJson) {
  if (!propertiesJson || typeof propertiesJson !== "object") return [];
  const p = propertiesJson;
  const raw = p.buildings_json ?? p.buildingsJson;
  const arr = Array.isArray(raw) ? raw : safeJsonParse(raw);
  return Array.isArray(arr) ? arr : [];
}

function buildingKeyFromEntry(it) {
  if (!it || typeof it !== "object") return "";
  const bc = String(it.bdnb_batiment_construction_id || it.batiment_construction_id || "").trim();
  const bg = String(it.batiment_groupe_id || "").trim();
  return bc || bg || "";
}

function osmIdFromEntry(it) {
  if (!it || typeof it !== "object") return "";
  return String(it.osm_building_id || "").trim();
}

function analyzeRow(row) {
  const buildings = extractBuildingsArray(row.properties_json);
  const embedded = Array.isArray(row.building_geometries_json)
    ? row.building_geometries_json
    : safeJsonParse(row.building_geometries_json) || [];

  const bKeys = new Set();
  const byKey = new Map();
  for (const it of buildings) {
    const k = buildingKeyFromEntry(it);
    if (!k) continue;
    bKeys.add(k);
    byKey.set(k, {
      footprint_m2: it.footprint_m2,
      osm_building_id: osmIdFromEntry(it),
      osm_match_status: String(it.osm_match_status || "").trim(),
    });
  }

  const embKeys = new Set();
  for (const it of embedded) {
    const k = buildingKeyFromEntry(it);
    if (k) embKeys.add(k);
  }

  const missingEmbedded = [...bKeys].filter((k) => !embKeys.has(k));
  const orphanEmbedded = [...embKeys].filter((k) => !bKeys.has(k));

  return {
    nBuildingsJson: buildings.length,
    nBuildingGeometriesJson: embedded.length,
    buildingIdsInJson: [...bKeys],
    missingEmbedded,
    orphanEmbedded,
    sample: [...bKeys].slice(0, 8).map((k) => ({
      id: k,
      ...byKey.get(k),
      hasEmbeddedGeometry: embKeys.has(k),
    })),
  };
}

function printUsage() {
  console.error(`
Usage:
  node scripts/investigate-matching-v5-footprint.mjs --tile=z,x,y
  node scripts/investigate-matching-v5-footprint.mjs --lat=LAT --lng=LNG
  node scripts/investigate-matching-v5-footprint.mjs --scout-v5-id=ID
`);
}

async function main() {
  const tileArg = parseArg("--tile");
  const latArg = parseArg("--lat");
  const lngArg = parseArg("--lng");
  const idArg = parseArg("--scout-v5-id");

  if (!tileArg && !(latArg && lngArg) && !idArg) {
    printUsage();
    process.exit(1);
  }

  const url = resolveDatabaseUrl(process.cwd());
  if (!url) {
    console.error("Aucune URL Postgres (voir scripts/lib/resolve-database-url.mjs).");
    process.exit(1);
  }

  const tableRef = parseQualifiedTable(process.env.SCOUT_MATCHING_V5_TABLE);

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 20000 });
  await client.connect();

  try {
    let rows;
    if (idArg) {
      const r = await client.query(
        `
        SELECT
          scout_v5_id,
          grain,
          code_insee,
          section,
          numero_norm,
          nb_batiments,
          footprint_sum_m2,
          building_geometries_json,
          properties_json,
          ST_GeometryType(geom) AS geom_type
        FROM ${tableRef.qualifiedSql}
        WHERE scout_v5_id = $1
        `,
        [idArg]
      );
      rows = r.rows;
    } else if (tileArg) {
      const parts = tileArg.split(",").map((s) => s.trim());
      if (parts.length !== 3) {
        console.error('--tile attend "z,x,y" (ex: 17,65258,47297)');
        process.exit(1);
      }
      const z = Math.trunc(Number(parts[0]));
      const x = Math.trunc(Number(parts[1]));
      const y = Math.trunc(Number(parts[2]));
      if (![z, x, y].every((n) => Number.isFinite(n) && n >= 0)) {
        console.error("Indices tuile invalides");
        process.exit(1);
      }
      const max = 2 ** z;
      if (x >= max || y >= max) {
        console.error("x ou y hors plage pour ce zoom");
        process.exit(1);
      }
      const r = await client.query(
        `
        SELECT
          scout_v5_id,
          grain,
          code_insee,
          section,
          numero_norm,
          nb_batiments,
          footprint_sum_m2,
          building_geometries_json,
          properties_json,
          ST_GeometryType(geom) AS geom_type
        FROM ${tableRef.qualifiedSql}
        WHERE geom && ST_Transform(ST_TileEnvelope($1::integer, $2::integer, $3::integer), 4326)
          AND ST_Intersects(geom, ST_Transform(ST_TileEnvelope($1::integer, $2::integer, $3::integer), 4326))
          AND (grain = 'parcelle' OR grain = 'building')
        ORDER BY grain DESC, footprint_sum_m2 DESC NULLS LAST
        `,
        [z, x, y]
      );
      rows = r.rows;
      console.log(JSON.stringify({ mode: "tile", z, x, y, rowCount: rows.length }, null, 2));
    } else {
      const lat = Number(latArg);
      const lng = Number(lngArg);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        console.error("--lat et --lng doivent être numériques");
        process.exit(1);
      }
      const r = await client.query(
        `
        SELECT
          scout_v5_id,
          grain,
          code_insee,
          section,
          numero_norm,
          nb_batiments,
          footprint_sum_m2,
          building_geometries_json,
          properties_json,
          ST_GeometryType(geom) AS geom_type
        FROM ${tableRef.qualifiedSql}
        WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), 4326))
          AND (grain = 'parcelle' OR grain = 'building')
        ORDER BY grain DESC, footprint_sum_m2 DESC NULLS LAST
        `,
        [lng, lat]
      );
      rows = r.rows;
      console.log(JSON.stringify({ mode: "point", lat, lng, rowCount: rows.length }, null, 2));
    }

    if (rows.length === 0) {
      console.log(JSON.stringify({ note: "Aucune ligne matching dans la zone." }, null, 2));
      return;
    }

    for (const row of rows) {
      const a = analyzeRow(row);
      const out = {
        scout_v5_id: row.scout_v5_id,
        grain: row.grain,
        parcelle: `${row.code_insee} ${row.section} ${row.numero_norm}`.trim(),
        geom_type: row.geom_type,
        footprint_sum_m2: row.footprint_sum_m2,
        nb_batiments: row.nb_batiments,
        n_buildings_json: a.nBuildingsJson,
        n_building_geometries_json: a.nBuildingGeometriesJson,
        /** Bâtiments listés dans buildings_json mais sans polygone dans building_geometries_json → carte dépend du fetch BDNB / plafond ids. */
        building_ids_sans_geometrie_embarquee: a.missingEmbedded,
        cles_geometries_orphelines: a.orphanEmbedded.length ? a.orphanEmbedded : undefined,
        echantillon_batiments: a.sample,
      };
      console.log(JSON.stringify(out, null, 2));
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
