/**
 * Pipeline Matching V5 par département : matching → backfill → combos (+ schéma / MV).
 *
 * Usage :
 *   node scripts/run-matching-v5-pipeline-by-dep.mjs --dep 33
 *   node scripts/run-matching-v5-pipeline-by-dep.mjs --dep 33 --skip-matching
 *   node scripts/run-matching-v5-pipeline-by-dep.mjs --dep 33 -- --include-building-grain
 *
 * Options :
 *   --skip-matching       Ne pas relancer run_matching_v5.py
 *   --skip-backfill       Ne pas lancer backfill_building_geometries_v5.py
 *   --skip-combos         Ne pas lancer build_discovery_combos.py
 *   --no-apply-combos     Ne pas exécuter scout:matching-v5:combos:apply au début
 *   --no-refresh-mv       Ne pas rafraîchir scout_matching_v5_buildings_mv à la fin
 *
 * Tout argument après `--` est transmis uniquement à run_matching_v5.py (étape matching).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isValidDepCode,
  listCommunesForDep,
} from "./lib/matching-v5-dep-communes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PY = path.join(REPO_ROOT, "data-pipeline/python/.venv-v311/bin/python");

function parseArgs(argv) {
  const dd = argv.indexOf("--");
  const head = dd >= 0 ? argv.slice(0, dd) : argv;
  const tail = dd >= 0 ? argv.slice(dd + 1) : [];
  let dep = null;
  let skipMatching = false;
  let skipBackfill = false;
  let skipCombos = false;
  let applyCombos = true;
  let refreshMv = true;
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (a === "--dep" && head[i + 1]) dep = String(head[++i]).trim();
    else if (a.startsWith("--dep=")) dep = a.slice("--dep=".length).trim();
    else if (a === "--skip-matching") skipMatching = true;
    else if (a === "--skip-backfill") skipBackfill = true;
    else if (a === "--skip-combos") skipCombos = true;
    else if (a === "--no-apply-combos") applyCombos = false;
    else if (a === "--no-refresh-mv") refreshMv = false;
    else if (a === "--") {
      /* fin options script */
    } else if (!a.startsWith("-")) {
      /* ignore */
    }
  }
  return { dep, skipMatching, skipBackfill, skipCombos, applyCombos, refreshMv, matchingTail: tail };
}

function runNode(scriptRel, scriptArgs = []) {
  const script = path.join(REPO_ROOT, scriptRel);
  return spawnSync(process.execPath, [script, ...scriptArgs], {
    stdio: "inherit",
    env: process.env,
    cwd: REPO_ROOT,
  });
}

function runPy(scriptRel, scriptArgs = []) {
  const script = path.join(REPO_ROOT, scriptRel);
  return spawnSync(PY, [script, ...scriptArgs], {
    stdio: "inherit",
    env: process.env,
    cwd: REPO_ROOT,
  });
}

const argv = process.argv.slice(2);
const opts = parseArgs(argv);

if (!opts.dep || !isValidDepCode(opts.dep)) {
  console.error(
    "Usage: node scripts/run-matching-v5-pipeline-by-dep.mjs --dep <DEPT> [options] [-- args matching…]\n" +
      "Exemple: --dep 33 | --dep 33 --skip-matching"
  );
  process.exit(1);
}

let communes;
try {
  communes = await listCommunesForDep(REPO_ROOT, opts.dep);
} catch (err) {
  console.error(`[matching-v5-pipeline] ${err.message ?? err}`);
  process.exit(1);
}

if (communes.length === 0) {
  console.error(
    `[matching-v5-pipeline] Aucune commune cadastre pour dep ${opts.dep}. ` +
      "Importe le cadastre (ex. npm run import:cadastre-33-parcelles:dep) puis relance."
  );
  process.exit(1);
}

console.log(
  `[matching-v5-pipeline] dep ${opts.dep} — ${communes.length} commune(s) — ` +
    `matching=${opts.skipMatching ? "non" : "oui"}, backfill=${opts.skipBackfill ? "non" : "oui"}, combos=${opts.skipCombos ? "non" : "oui"}`
);

if (opts.applyCombos && !opts.skipCombos) {
  console.log("[matching-v5-pipeline] Application schéma combos (010–015)…");
  const r = runNode("scripts/apply-matching-v5-combos.mjs");
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!opts.skipMatching) {
  const matchingArgs = ["scripts/run-matching-v5-by-dep.mjs", "--dep", opts.dep];
  if (opts.matchingTail.length > 0) {
    matchingArgs.push("--", ...opts.matchingTail);
  }
  console.log("[matching-v5-pipeline] Étape matching (run_matching_v5 par commune)…");
  const r = spawnSync(process.execPath, matchingArgs, {
    stdio: "inherit",
    env: process.env,
    cwd: REPO_ROOT,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

let failed = 0;
for (let i = 0; i < communes.length; i++) {
  const codeInsee = communes[i];
  const label = `[matching-v5-pipeline] ${i + 1}/${communes.length} — ${codeInsee}`;

  if (!opts.skipBackfill) {
    console.log(`${label} — backfill`);
    const r = runPy("data-pipeline/matching_v5/backfill_building_geometries_v5.py", [
      "--code-insee",
      codeInsee,
    ]);
    if (r.status !== 0) {
      console.error(`${label} — backfill échec (${r.status ?? "?"})`);
      failed++;
      continue;
    }
  }

  if (!opts.skipCombos) {
    console.log(`${label} — combos`);
    const r = runPy("data-pipeline/matching_v5/build_discovery_combos.py", [
      "--code-insee",
      codeInsee,
    ]);
    if (r.status !== 0) {
      console.error(`${label} — combos échec (${r.status ?? "?"})`);
      failed++;
    }
  }
}

if (!opts.skipBackfill && opts.refreshMv) {
  console.log("[matching-v5-pipeline] Rafraîchissement scout_matching_v5_buildings_mv…");
  const r = runNode("scripts/refresh-matching-v5-buildings-mv.mjs");
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (failed > 0) {
  console.error(
    `[matching-v5-pipeline] Terminé avec ${failed} échec(s) backfill/combos sur ${communes.length} commune(s).`
  );
  process.exit(1);
}

console.log(`[matching-v5-pipeline] OK — dep ${opts.dep}, ${communes.length} commune(s).`);
