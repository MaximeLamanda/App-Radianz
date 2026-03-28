#!/usr/bin/env node
/**
 * Enrichit sitadel_locaux_ci (dep33) avec:
 * - lat/lng
 * - cadastre_polygon_geojson
 *
 * Source:
 * - APICarto cadastre/parcelle (+ fallback localisant)
 * - whitelist INSEE depuis /Users/maximelamanda/Downloads/dep33
 *
 * Usage:
 *   node scripts/enrich-sitadel-dep33-apicarto.mjs --limit 5000 --sleep-ms 20 --retries 2
 */

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const DEP33_DIR = "/Users/maximelamanda/Downloads/dep33";
const TABLE = "public.sitadel_locaux_ci";

function parseArgs(argv) {
  const args = {
    limit: 5000,
    sleepMs: 20,
    retries: 2,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") args.limit = Number.parseInt(argv[++i] ?? "5000", 10);
    else if (a === "--sleep-ms") args.sleepMs = Number.parseInt(argv[++i] ?? "20", 10);
    else if (a === "--retries") args.retries = Number.parseInt(argv[++i] ?? "2", 10);
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) args.limit = 5000;
  if (!Number.isFinite(args.sleepMs) || args.sleepMs < 0) args.sleepMs = 20;
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
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      return res;
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(200 * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}

function loadInseeWhitelist(depDir) {
  const out = new Set();
  if (!fs.existsSync(depDir)) return out;
  for (const ent of fs.readdirSync(depDir, { withFileTypes: true })) {
    if (ent.isDirectory() && /^\d{5}$/.test(ent.name)) out.add(ent.name);
  }
  return out;
}

async function main() {
  const { limit, sleepMs, retries } = parseArgs(process.argv);
  const dbUrl = getDatabaseUrl();
  if (!dbUrl) {
    console.error("NEON_DATABASE_URL introuvable (env ou .env.local)");
    process.exit(2);
  }
  const inseeWhitelist = loadInseeWhitelist(DEP33_DIR);
  if (inseeWhitelist.size === 0) {
    console.error(`Aucun code INSEE trouvé dans ${DEP33_DIR}`);
    process.exit(2);
  }
  console.log(`[dep33] INSEE whitelist size: ${inseeWhitelist.size}`);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query(`ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS cadastre_polygon_geojson JSONB`);

    const rows = (
      await client.query(
        `
        SELECT id, comm, sec_cadastre1, num_cadastre1
        FROM ${TABLE}
        WHERE dep = '33'
          AND comm IS NOT NULL
          AND sec_cadastre1 IS NOT NULL
          AND num_cadastre1 IS NOT NULL
          AND ((lat IS NULL OR lng IS NULL) OR cadastre_polygon_geojson IS NULL)
        ORDER BY id
        LIMIT $1
        `,
        [limit]
      )
    ).rows;

    const stats = {
      total: rows.length,
      updated: 0,
      missingFeature: 0,
      skippedNotInWhitelist: 0,
      http4xx: 0,
      http5xx: 0,
      network: 0,
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const codeInsee = String(row.comm).trim();
      const section = String(row.sec_cadastre1).trim();
      const numero = padNumero(row.num_cadastre1);
      if (!numero || !codeInsee || !section) {
        stats.missingFeature++;
        continue;
      }
      if (!inseeWhitelist.has(codeInsee)) {
        stats.skippedNotInWhitelist++;
        continue;
      }

      const query = `code_insee=${encodeURIComponent(codeInsee)}&section=${encodeURIComponent(section)}&numero=${encodeURIComponent(numero)}`;
      const urlParcelle = `https://apicarto.ign.fr/api/cadastre/parcelle?${query}`;
      const urlLocalisant = `https://apicarto.ign.fr/api/cadastre/localisant?${query}`;

      let polygonGeo = null;
      let lat = null;
      let lng = null;

      try {
        const rParcelle = await fetchWithRetry(urlParcelle, retries);
        if (rParcelle.ok) {
          const geo = await rParcelle.json();
          if (Array.isArray(geo?.features) && geo.features.length > 0) {
            polygonGeo = geo;
            const centroid = extractCentroidFromGeometry(geo.features[0]?.geometry);
            lat = centroid.lat;
            lng = centroid.lng;
          } else {
            stats.missingFeature++;
          }
        } else if (rParcelle.status >= 500) {
          stats.http5xx++;
        } else {
          stats.http4xx++;
        }
      } catch {
        stats.network++;
      }

      if ((lat == null || lng == null) && !polygonGeo) {
        try {
          const rLoc = await fetchWithRetry(urlLocalisant, retries);
          if (rLoc.ok) {
            const geoLoc = await rLoc.json();
            if (Array.isArray(geoLoc?.features) && geoLoc.features.length > 0) {
              const centroid = extractCentroidFromGeometry(geoLoc.features[0]?.geometry);
              lat = centroid.lat;
              lng = centroid.lng;
            }
          }
        } catch {
          // ignore fallback error
        }
      }

      if (polygonGeo || lat != null || lng != null) {
        await client.query(
          `
          UPDATE ${TABLE}
          SET cadastre_polygon_geojson = COALESCE(cadastre_polygon_geojson, $1::jsonb),
              lat = COALESCE(lat, $2),
              lng = COALESCE(lng, $3)
          WHERE id = $4
          `,
          [polygonGeo ? JSON.stringify(polygonGeo) : null, lat, lng, row.id]
        );
        stats.updated++;
      }

      if ((i + 1) % 200 === 0 || i + 1 === rows.length) {
        console.log(
          `[dep33-enrich] ${i + 1}/${rows.length} updated=${stats.updated} missing=${stats.missingFeature} 4xx=${stats.http4xx} 5xx=${stats.http5xx} net=${stats.network}`
        );
      }
      if (sleepMs > 0) await sleep(sleepMs);
    }

    const coverage = (
      await client.query(
        `
        SELECT
          count(*) as total,
          count(*) FILTER (WHERE dep='33') as dep33_total,
          count(*) FILTER (WHERE dep='33' AND lat IS NOT NULL AND lng IS NOT NULL) as dep33_with_latlng,
          count(*) FILTER (WHERE dep='33' AND cadastre_polygon_geojson IS NOT NULL) as dep33_with_poly
        FROM ${TABLE}
        `
      )
    ).rows[0];

    console.log("\n[dep33-summary]");
    console.log(JSON.stringify({ stats, coverage }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

