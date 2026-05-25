/**
 * Enchaîne run_matching_v5.py pour chaque code INSEE présent dans le cadastre (préfixe département).
 *
 * Usage :
 *   node scripts/run-matching-v5-by-dep.mjs --dep 31
 *
 * Variables d’environnement : LOCAL_DATABASE_URL, .env.local, etc. (voir resolve-database-url.mjs).
 *
 * Défauts alignés sur la procédure commune : --write-postgres --no-geojson --min-parcelle-footprint-sum-m2 400.
 * Tout argument après -- est passé tel quel à run_matching_v5.py (et peut surcharger des défauts s’il y en a en double).
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

function parseArgs(argv) {
  const dd = argv.indexOf("--");
  const head = dd >= 0 ? argv.slice(0, dd) : argv;
  const tail = dd >= 0 ? argv.slice(dd + 1) : [];
  let dep = null;
  const rest = [];
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (a === "--dep" && head[i + 1]) {
      dep = String(head[++i]).trim();
    } else if (a.startsWith("--dep=")) {
      dep = a.slice("--dep=".length).trim();
    } else {
      rest.push(a);
    }
  }
  return { dep, forwardHead: rest, forwardTail: tail };
}

const argv = process.argv.slice(2);
const { dep, forwardHead, forwardTail } = parseArgs(argv);

if (!dep || !isValidDepCode(dep)) {
  console.error(
    "Usage: node scripts/run-matching-v5-by-dep.mjs --dep <DEPT> [-- args pour run_matching_v5.py…]\n" +
      "Exemple: --dep 31 ou --dep 2A"
  );
  process.exit(1);
}

let rows;
try {
  rows = await listCommunesForDep(REPO_ROOT, dep);
} catch (err) {
  console.error(`[matching-v5-by-dep] ${err.message ?? err}`);
  process.exit(1);
}

if (rows.length === 0) {
  console.error(
    `[matching-v5-by-dep] Aucune commune cadastre pour dep ${JSON.stringify(dep)}. ` +
      "Importe le cadastre du département (ex. import:cadastre-33-parcelles:dep) puis relance."
  );
  process.exit(1);
}

console.log(`[matching-v5-by-dep] ${rows.length} commune(s) INSEE (dep ${dep})`);

const py = path.join(REPO_ROOT, "data-pipeline/python/.venv-v311/bin/python");
const script = path.join(REPO_ROOT, "data-pipeline/matching_v5/run_matching_v5.py");

const baseArgs = [
  script,
  "--min-parcelle-footprint-sum-m2",
  "400",
  "--write-postgres",
  "--no-geojson",
  ...forwardHead,
];

let failed = 0;
for (let i = 0; i < rows.length; i++) {
  const codeInsee = rows[i];
  const label = `[matching-v5-by-dep] ${i + 1}/${rows.length} — commune ${codeInsee}`;
  console.log(label);
  const args = [...baseArgs, "--code-insee", codeInsee, ...forwardTail];
  const r = spawnSync(py, args, {
    stdio: "inherit",
    env: process.env,
    cwd: REPO_ROOT,
  });
  if (r.status !== 0) {
    console.error(`${label} — échec (code ${r.status ?? "?"})`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`[matching-v5-by-dep] Terminé avec ${failed} échec(s) sur ${rows.length} commune(s).`);
  process.exit(1);
}
console.log(`[matching-v5-by-dep] OK — ${rows.length} commune(s) traitée(s).`);
