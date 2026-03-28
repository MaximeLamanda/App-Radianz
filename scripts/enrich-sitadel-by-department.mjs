#!/usr/bin/env node
/**
 * Orchestrateur d'enrichissement SITADEL département par département.
 *
 * Il appelle le script commune-par-commune pour chaque département
 * encore incomplet, de manière séquentielle.
 *
 * Usage:
 *   node scripts/enrich-sitadel-by-department.mjs --max-deps 5 --limit-per-dep 12000 --max-communes 300 --base-sleep-ms 25 --retries 2
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const TABLE = "public.sitadel_locaux_ci";

function parseArgs(argv) {
  const args = {
    maxDeps: 9999,
    limitPerDep: 12000,
    maxCommunes: 300,
    baseSleepMs: 25,
    retries: 2,
    outDir: "scripts/output",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max-deps") args.maxDeps = Number.parseInt(argv[++i] ?? "9999", 10);
    else if (a === "--limit-per-dep") args.limitPerDep = Number.parseInt(argv[++i] ?? "12000", 10);
    else if (a === "--max-communes") args.maxCommunes = Number.parseInt(argv[++i] ?? "300", 10);
    else if (a === "--base-sleep-ms") args.baseSleepMs = Number.parseInt(argv[++i] ?? "25", 10);
    else if (a === "--retries") args.retries = Number.parseInt(argv[++i] ?? "2", 10);
    else if (a === "--out-dir") args.outDir = String(argv[++i] ?? "scripts/output");
  }
  if (!Number.isFinite(args.maxDeps) || args.maxDeps < 1) args.maxDeps = 9999;
  if (!Number.isFinite(args.limitPerDep) || args.limitPerDep < 1) args.limitPerDep = 12000;
  if (!Number.isFinite(args.maxCommunes) || args.maxCommunes < 1) args.maxCommunes = 300;
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

async function listDepartmentsToProcess(client, maxDeps) {
  const q = await client.query(
    `
    SELECT dep, count(*) AS n
    FROM ${TABLE}
    WHERE dep IS NOT NULL
      AND dep <> ''
      AND ((lat IS NULL OR lng IS NULL) OR cadastre_polygon_geojson IS NULL)
    GROUP BY dep
    ORDER BY n DESC
    LIMIT $1
    `,
    [maxDeps]
  );
  return q.rows.map((r) => ({ dep: String(r.dep), remaining: Number(r.n) }));
}

async function coverageForDep(client, dep) {
  const q = await client.query(
    `
    SELECT
      count(*) FILTER (WHERE dep = $1) AS total,
      count(*) FILTER (WHERE dep = $1 AND lat IS NOT NULL AND lng IS NOT NULL) AS with_latlng,
      count(*) FILTER (WHERE dep = $1 AND cadastre_polygon_geojson IS NOT NULL) AS with_poly,
      count(*) FILTER (WHERE dep = $1 AND (lat IS NULL OR lng IS NULL) AND cadastre_polygon_geojson IS NULL) AS still_missing
    FROM ${TABLE}
    `,
    [dep]
  );
  return q.rows[0];
}

async function main() {
  const args = parseArgs(process.argv);
  const dbUrl = getDatabaseUrl();
  if (!dbUrl) {
    console.error("NEON_DATABASE_URL introuvable (env ou .env.local)");
    process.exit(2);
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  const runTs = new Date().toISOString().replace(/[:.]/g, "-");
  const outJson = path.join(args.outDir, `enrich-by-department-${runTs}.json`);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const deps = await listDepartmentsToProcess(client, args.maxDeps);
    if (deps.length === 0) {
      console.log("Aucun département à traiter.");
      return;
    }
    console.log(`[by-department] départements à traiter: ${deps.length}`);

    const results = [];
    for (let i = 0; i < deps.length; i++) {
      const { dep, remaining } = deps[i];
      console.log(`\n[${i + 1}/${deps.length}] DEP ${dep} (restant initial: ${remaining})`);

      const before = await coverageForDep(client, dep);
      const cmdArgs = [
        "scripts/enrich-sitadel-by-commune.mjs",
        "--dep",
        dep,
        "--limit",
        String(args.limitPerDep),
        "--max-communes",
        String(args.maxCommunes),
        "--base-sleep-ms",
        String(args.baseSleepMs),
        "--retries",
        String(args.retries),
      ];
      const r = spawnSync("node", cmdArgs, { cwd: process.cwd(), stdio: "inherit" });
      const after = await coverageForDep(client, dep);

      results.push({
        dep,
        exitCode: r.status ?? -1,
        before,
        after,
      });
    }

    const summary = {
      startedAt: new Date().toISOString(),
      args,
      departmentsProcessed: results.length,
      results,
    };
    fs.writeFileSync(outJson, JSON.stringify(summary, null, 2));
    console.log(`\n[by-department] Résumé écrit: ${outJson}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

