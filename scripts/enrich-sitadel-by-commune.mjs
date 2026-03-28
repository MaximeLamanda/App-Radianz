#!/usr/bin/env node
/**
 * Enrichissement Sitadel "commune par commune" avec diagnostics API.
 *
 * Objectif:
 * - Maximiser le remplissage lat/lng + cadastre_polygon_geojson
 * - Collecter des retours API par commune (200/400/429/5xx/no-feature/network)
 * - Adapter le rythme d'appel selon les réponses (backoff simple)
 *
 * Usage:
 *   node scripts/enrich-sitadel-by-commune.mjs --dep 33 --limit 8000 --max-communes 30 --base-sleep-ms 25 --retries 2
 */

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const TABLE = "public.sitadel_locaux_ci";

function parseArgs(argv) {
  const args = {
    dep: null,
    limit: 8000,
    maxCommunes: 30,
    baseSleepMs: 25,
    retries: 2,
    outDir: "scripts/output",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dep") args.dep = String(argv[++i] ?? "").trim() || null;
    else if (a === "--limit") args.limit = Number.parseInt(argv[++i] ?? "8000", 10);
    else if (a === "--max-communes") args.maxCommunes = Number.parseInt(argv[++i] ?? "30", 10);
    else if (a === "--base-sleep-ms") args.baseSleepMs = Number.parseInt(argv[++i] ?? "25", 10);
    else if (a === "--retries") args.retries = Number.parseInt(argv[++i] ?? "2", 10);
    else if (a === "--out-dir") args.outDir = String(argv[++i] ?? "scripts/output");
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) args.limit = 8000;
  if (!Number.isFinite(args.maxCommunes) || args.maxCommunes < 1) args.maxCommunes = 30;
  if (!Number.isFinite(args.baseSleepMs) || args.baseSleepMs < 0) args.baseSleepMs = 25;
  if (!Number.isFinite(args.retries) || args.retries < 0) args.retries = 2;
  return args;
}

function loadEnvFromDotenv(dotenvPath) {
  const out = {};
  if (!fs.existsSync(dotenvPath)) return out;
  const txt = fs.readFileSync(dotenvPath, "utf8");
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function getDatabaseUrl() {
  if (process.env.NEON_DATABASE_URL) return process.env.NEON_DATABASE_URL;
  const env = loadEnvFromDotenv(path.resolve(".env.local"));
  return env.NEON_DATABASE_URL || env.DATABASE_URL || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function padNumero(num) {
  const s = String(num ?? "").replace(/\D/g, "");
  if (!s) return null;
  return s.length <= 4 ? s.padStart(4, "0") : s.slice(-4);
}

function numeroCandidates(rawNumero) {
  const out = [];
  const raw = String(rawNumero ?? "").trim();
  if (raw) out.push(raw);
  const padded = padNumero(raw);
  if (padded && !out.includes(padded)) out.push(padded);
  const digits = raw.replace(/\D/g, "");
  if (digits && !out.includes(digits)) out.push(digits);
  return out;
}

function extractCentroidFromGeometry(geometry) {
  const points = [];
  const push = (x, y) => {
    if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
  };
  if (!geometry || typeof geometry !== "object") return { lat: null, lng: null };
  const type = geometry.type;
  const c = geometry.coordinates;
  if (type === "Point" && Array.isArray(c) && c.length >= 2) {
    push(Number(c[0]), Number(c[1]));
  } else if (type === "MultiPoint" && Array.isArray(c)) {
    for (const p of c) if (Array.isArray(p) && p.length >= 2) push(Number(p[0]), Number(p[1]));
  } else if (type === "Polygon" && Array.isArray(c)) {
    for (const ring of c) if (Array.isArray(ring)) for (const p of ring) if (Array.isArray(p) && p.length >= 2) push(Number(p[0]), Number(p[1]));
  } else if (type === "MultiPolygon" && Array.isArray(c)) {
    for (const poly of c) if (Array.isArray(poly)) for (const ring of poly) if (Array.isArray(ring)) for (const p of ring) if (Array.isArray(p) && p.length >= 2) push(Number(p[0]), Number(p[1]));
  }
  if (!points.length) return { lat: null, lng: null };
  const lng = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
  return { lat, lng };
}

async function fetchWithRetry(url, retries) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      return { res };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(200 * (attempt + 1));
    }
  }
  return { err: lastErr };
}

function initCommuneStats(commune) {
  return {
    commune,
    rows: 0,
    updated: 0,
    noFeature: 0,
    http400: 0,
    http429: 0,
    http5xx: 0,
    httpOther: 0,
    network: 0,
    localisantFallback: 0,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const dbUrl = getDatabaseUrl();
  if (!dbUrl) {
    console.error("NEON_DATABASE_URL introuvable");
    process.exit(2);
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  const runTs = new Date().toISOString().replace(/[:.]/g, "-");
  const outJson = path.join(args.outDir, `enrich-by-commune-${runTs}.json`);
  const outCsv = path.join(args.outDir, `enrich-by-commune-${runTs}.csv`);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  const globalStats = {
    dep: args.dep,
    limit: args.limit,
    maxCommunes: args.maxCommunes,
    baseSleepMs: args.baseSleepMs,
    retries: args.retries,
    totalRowsSelected: 0,
    totalUpdated: 0,
    startedAt: new Date().toISOString(),
    communes: [],
  };

  try {
    await client.query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS cadastre_polygon_geojson JSONB`);

    const rowsQuery = `
      SELECT id, comm, sec_cadastre1, num_cadastre1, dep
      FROM ${TABLE}
      WHERE comm IS NOT NULL
        AND sec_cadastre1 IS NOT NULL
        AND num_cadastre1 IS NOT NULL
        AND ((lat IS NULL OR lng IS NULL) OR cadastre_polygon_geojson IS NULL)
        ${args.dep ? "AND dep = $1" : ""}
      ORDER BY comm, id
      LIMIT ${args.dep ? "$2" : "$1"}
    `;
    const rowsParams = args.dep ? [args.dep, args.limit] : [args.limit];
    const rows = (await client.query(rowsQuery, rowsParams)).rows;
    globalStats.totalRowsSelected = rows.length;

    const byCommune = new Map();
    for (const row of rows) {
      const c = String(row.comm).trim();
      if (!byCommune.has(c)) byCommune.set(c, []);
      byCommune.get(c).push(row);
    }

    const communes = [...byCommune.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, args.maxCommunes);
    console.log(`[enrich] rows=${rows.length} communes=${communes.length}`);

    for (const [commune, communeRows] of communes) {
      const cStats = initCommuneStats(commune);
      cStats.rows = communeRows.length;
      let sleepMs = args.baseSleepMs;

      for (let i = 0; i < communeRows.length; i++) {
        const row = communeRows[i];
        const section = String(row.sec_cadastre1).trim();
        const numeros = numeroCandidates(row.num_cadastre1);
        if (!section || numeros.length === 0) {
          cStats.noFeature++;
          continue;
        }

        let updated = false;

        for (const numero of numeros) {
          const q = `code_insee=${encodeURIComponent(commune)}&section=${encodeURIComponent(section)}&numero=${encodeURIComponent(numero)}`;
          const parcelleUrl = `https://apicarto.ign.fr/api/cadastre/parcelle?${q}`;
          const localisantUrl = `https://apicarto.ign.fr/api/cadastre/localisant?${q}`;

          const r = await fetchWithRetry(parcelleUrl, args.retries);
          if (r.err) {
            cStats.network++;
            continue;
          }
          const res = r.res;
          if (!res.ok) {
            if (res.status === 400) cStats.http400++;
            else if (res.status === 429) cStats.http429++;
            else if (res.status >= 500) cStats.http5xx++;
            else cStats.httpOther++;
            if (res.status === 429 || res.status >= 500) sleepMs = Math.min(400, sleepMs + 20);
            continue;
          }

          const geo = await res.json();
          if (!Array.isArray(geo?.features) || geo.features.length === 0) {
            cStats.noFeature++;
            continue;
          }

          const geom = geo.features[0]?.geometry;
          let { lat, lng } = extractCentroidFromGeometry(geom);

          // fallback localisant pour récupérer un centroid si géométrie inattendue
          if ((lat == null || lng == null) && !updated) {
            const rl = await fetchWithRetry(localisantUrl, args.retries);
            if (!rl.err && rl.res.ok) {
              const geoLoc = await rl.res.json();
              if (Array.isArray(geoLoc?.features) && geoLoc.features.length > 0) {
                const c = extractCentroidFromGeometry(geoLoc.features[0]?.geometry);
                lat = c.lat;
                lng = c.lng;
                cStats.localisantFallback++;
              }
            }
          }

          await client.query(
            `
            UPDATE ${TABLE}
            SET cadastre_polygon_geojson = COALESCE(cadastre_polygon_geojson, $1::jsonb),
                lat = COALESCE(lat, $2),
                lng = COALESCE(lng, $3)
            WHERE id = $4
            `,
            [JSON.stringify(geo), lat, lng, row.id]
          );
          updated = true;
          cStats.updated++;
          globalStats.totalUpdated++;
          sleepMs = Math.max(args.baseSleepMs, sleepMs - 5);
          break;
        }

        if ((i + 1) % 200 === 0 || i + 1 === communeRows.length) {
          console.log(
            `[commune ${commune}] ${i + 1}/${communeRows.length} updated=${cStats.updated} 400=${cStats.http400} 429=${cStats.http429} 5xx=${cStats.http5xx} noFeature=${cStats.noFeature} net=${cStats.network}`
          );
        }
        if (sleepMs > 0) await sleep(sleepMs);
      }

      globalStats.communes.push(cStats);
    }

    globalStats.finishedAt = new Date().toISOString();
    fs.writeFileSync(outJson, JSON.stringify(globalStats, null, 2));

    const csvLines = [
      "commune,rows,updated,noFeature,http400,http429,http5xx,httpOther,network,localisantFallback",
      ...globalStats.communes.map((c) =>
        [
          c.commune,
          c.rows,
          c.updated,
          c.noFeature,
          c.http400,
          c.http429,
          c.http5xx,
          c.httpOther,
          c.network,
          c.localisantFallback,
        ].join(",")
      ),
    ];
    fs.writeFileSync(outCsv, `${csvLines.join("\n")}\n`);

    console.log("\n[summary]");
    console.log(
      JSON.stringify(
        {
          totalRowsSelected: globalStats.totalRowsSelected,
          totalUpdated: globalStats.totalUpdated,
          communesProcessed: globalStats.communes.length,
          outJson,
          outCsv,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

