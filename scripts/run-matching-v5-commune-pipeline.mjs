#!/usr/bin/env node
/**
 * Pipeline Matching V5 pour une seule commune : reset (optionnel) → matching → backfill → combos → MV → Neon.
 *
 * Usage :
 *   node scripts/run-matching-v5-commune-pipeline.mjs --code-insee=33318
 *   node scripts/run-matching-v5-commune-pipeline.mjs --code-insee=33318 --skip-reset
 *   node scripts/run-matching-v5-commune-pipeline.mjs --code-insee=33318 --skip-neon
 *
 * Options pipeline : --code-insee, --skip-reset, --skip-neon.
 * Tout autre argument (ou tout ce qui suit `--`) est transmis à run_matching_v5.py
 * (ex. --no-osm-parking, --no-address-resolve).
 *
 *   npm run pipeline:matching-v5:pessac -- --no-osm-parking
 *   npm run pipeline:matching-v5:pessac -- -- --progress-every 10
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotenvMap } from "./lib/resolve-database-url.mjs";
import { formatDuration, runPipelineStep } from "./lib/pipeline-step-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PY = path.join(REPO_ROOT, "data-pipeline/python/.venv-v311/bin/python");

const NEON_HOST = "neon.tech";
const MATCHING_PROGRESS_EVERY = "25";

const PIPELINE_FLAGS = new Set(["--skip-reset", "--skip-neon"]);

function parseArgs(argv) {
  const dd = argv.indexOf("--");
  const head = dd >= 0 ? argv.slice(0, dd) : argv;
  const explicitTail = dd >= 0 ? argv.slice(dd + 1) : [];
  let codeInsee = null;
  let skipReset = false;
  let skipNeon = false;
  const forwarded = [];
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (a === "--code-insee" && head[i + 1]) codeInsee = String(head[++i]).trim();
    else if (a.startsWith("--code-insee=")) codeInsee = a.slice("--code-insee=".length).trim();
    else if (a === "--skip-reset") skipReset = true;
    else if (a === "--skip-neon") skipNeon = true;
    else if (PIPELINE_FLAGS.has(a)) {
      /* déjà traité */
    } else if (a.startsWith("-")) {
      forwarded.push(a);
      if (
        i + 1 < head.length &&
        !head[i + 1].startsWith("-") &&
        !head[i + 1].startsWith("--code-insee")
      ) {
        forwarded.push(head[++i]);
      }
    }
  }
  return { codeInsee, skipReset, skipNeon, matchingTail: [...forwarded, ...explicitTail] };
}

function pickNeonUrl(dot) {
  const keys = [
    "Radianz_DATABASE_URL_UNPOOLED",
    "RADIANZ_DATABASE_URL_UNPOOLED",
    "Radianz_DATABASE_URL",
    "RADIANZ_DATABASE_URL",
  ];
  for (const k of keys) {
    const v = process.env[k] ?? dot[k];
    if (typeof v === "string" && v.trim() && v.includes(NEON_HOST)) return v.trim();
  }
  return null;
}

function matchingArgs(codeInsee, matchingTail) {
  const hasProgressEvery = matchingTail.some(
    (a, i) => a === "--progress-every" || a.startsWith("--progress-every=")
  );
  const base = [
    path.join(REPO_ROOT, "data-pipeline/matching_v5/run_matching_v5.py"),
    `--code-insee=${codeInsee}`,
    "--min-parcelle-footprint-sum-m2",
    "400",
    "--write-postgres",
    "--no-geojson",
  ];
  if (!hasProgressEvery) {
    base.push("--progress-every", MATCHING_PROGRESS_EVERY);
  }
  return [...base, ...matchingTail];
}

const argv = process.argv.slice(2);
const { codeInsee, skipReset, skipNeon, matchingTail } = parseArgs(argv);

if (!codeInsee || !/^\d{5}$/.test(codeInsee)) {
  console.error(
    "Usage: node scripts/run-matching-v5-commune-pipeline.mjs --code-insee=<INSEE> [--skip-reset] [--skip-neon] [-- args matching…]"
  );
  process.exit(1);
}

const dot = loadDotenvMap(path.join(REPO_ROOT, ".env.local"));
for (const [k, v] of Object.entries(dot)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

const pipelineStarted = Date.now();
let step = 0;
const steps = [];
if (!skipReset) steps.push("reset");
steps.push("matching", "backfill", "combos-schema", "combos", "mv-refresh");
if (!skipNeon && pickNeonUrl(dot)) {
  steps.push(
    "neon-features",
    "neon-buildings-mv-schema",
    "neon-mv-refresh",
    "neon-combos-schema",
    "neon-combos"
  );
}
const total = steps.length;

async function runStep(label, cmd, args, extraEnv) {
  step += 1;
  await runPipelineStep({
    step,
    total,
    label,
    cmd,
    args,
    cwd: REPO_ROOT,
    env: extraEnv,
    heartbeatSec: 15,
  });
}

console.error("");
console.error(`╔══════════════════════════════════════════════════════════╗`);
console.error(`║  Matching V5 — commune ${codeInsee} (${total} étape(s))              ║`);
console.error(`╚══════════════════════════════════════════════════════════╝`);
console.error(`    progress-every matching : ${MATCHING_PROGRESS_EVERY} (surcharge via -- --progress-every N)`);

try {
  if (!skipReset) {
    await runStep(
      `Reset features + combos (${codeInsee}, local + neon)`,
      process.execPath,
      [
        path.join(REPO_ROOT, "scripts/reset-matching-v5-commune.mjs"),
        `--code-insee=${codeInsee}`,
      ],
      { CONFIRM_RESET: "1" }
    );
  }

  await runStep(
    "Matching V5 → Postgres local (jointure OSM×parcelle, export)",
    PY,
    matchingArgs(codeInsee, matchingTail)
  );

  await runStep(
    "Backfill building_geometries_json",
    PY,
    [
      path.join(REPO_ROOT, "data-pipeline/matching_v5/backfill_building_geometries_v5.py"),
      "--code-insee",
      codeInsee,
    ]
  );

  await runStep(
    "Schéma combos (local, idempotent)",
    process.execPath,
    [path.join(REPO_ROOT, "scripts/apply-matching-v5-combos.mjs")]
  );

  await runStep(
    "Build combos Discovery (local)",
    PY,
    [
      path.join(REPO_ROOT, "data-pipeline/matching_v5/build_discovery_combos.py"),
      "--code-insee",
      codeInsee,
    ]
  );

  await runStep(
    "Refresh scout_matching_v5_buildings_mv",
    process.execPath,
    [path.join(REPO_ROOT, "scripts/refresh-matching-v5-buildings-mv.mjs")]
  );

  if (!skipNeon) {
    const neonUrl = pickNeonUrl(dot);
    if (!neonUrl) {
      console.warn("[matching-v5-commune] Pas d’URL Neon — étapes prod ignorées.");
    } else {
      const neonOnly = {
        LOCAL_DATABASE_URL: "",
        DATABASE_URL: neonUrl,
        Radianz_DATABASE_URL: neonUrl,
        Radianz_DATABASE_URL_UNPOOLED: neonUrl,
      };

      await runStep(
        "Transfert features → Neon",
        process.execPath,
        [
          path.join(REPO_ROOT, "scripts/neon-transfer-scout-v5-features-by-insee.mjs"),
          `--code-insee=${codeInsee}`,
        ]
      );

      await runStep(
        "Schéma buildings_mv (Neon)",
        process.execPath,
        [path.join(REPO_ROOT, "scripts/apply-matching-v5-buildings-mv.mjs")],
        { ...neonOnly, CONCURRENTLY: "0" }
      );

      await runStep(
        "Refresh scout_matching_v5_buildings_mv (Neon)",
        process.execPath,
        [path.join(REPO_ROOT, "scripts/refresh-matching-v5-buildings-mv.mjs")],
        neonOnly
      );

      await runStep(
        "Schéma combos (Neon)",
        process.execPath,
        [path.join(REPO_ROOT, "scripts/apply-matching-v5-combos.mjs")],
        neonOnly
      );

      await runStep(
        "Build combos (Neon)",
        PY,
        [
          path.join(REPO_ROOT, "data-pipeline/matching_v5/build_discovery_combos.py"),
          "--code-insee",
          codeInsee,
        ],
        neonOnly
      );
    }
  }

  console.error("");
  console.error(
    `✅ Pipeline ${codeInsee} terminé en ${formatDuration(Date.now() - pipelineStarted)}.`
  );
} catch (err) {
  console.error("");
  console.error(
    `❌ Pipeline interrompu après ${formatDuration(Date.now() - pipelineStarted)} :`,
    err instanceof Error ? err.message : err
  );
  process.exit(1);
}
