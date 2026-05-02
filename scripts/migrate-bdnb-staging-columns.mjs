/**
 * Ajoute les colonnes « staging » à public.bdnb_buildings si la table existe encore
 * avec l’ancien schéma (avant import-bdnb-postgres.mjs enrichi).
 *
 * Usage : node scripts/migrate-bdnb-staging-columns.mjs
 * Connexion : même résolution que clean-bdnb-postgres (LOCAL_DATABASE_URL, .env.local).
 */
import path from "node:path";
import { Client } from "pg";
import { loadDotenvMap, resolveDatabaseUrl } from "./lib/resolve-database-url.mjs";

const root = process.cwd();
const dot = loadDotenvMap(path.join(root, ".env.local"));
for (const [k, v] of Object.entries(dot)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

const databaseUrl = resolveDatabaseUrl(root);
if (!databaseUrl) {
  console.error("Aucune DATABASE_URL / LOCAL_DATABASE_URL (voir .env.local).");
  process.exit(1);
}

const raw = (process.env.BDNB_BUILDINGS_TABLE || "public.bdnb_buildings").trim();
const parts = raw.split(".").map((s) => s.trim()).filter(Boolean);
const schema = parts.length === 2 ? parts[0] : "public";
const table = parts.length === 2 ? parts[1] : parts[0];
const qualified = `"${schema}"."${table}"`;

const alters = [
  `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS code_departement_insee text`,
  `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS ffo_code_departement_insee text`,
  `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS nb_niveau integer`,
  `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS usage_niveau_1_txt text`,
  `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS mat_mur_txt text`,
  `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS mat_toit_txt text`,
  `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS identifiant_dpe text`,
  `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS dpe_code_departement_insee text`,
  `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS arrete_2021 integer`,
  `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS classe_bilan_dpe text`,
  `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS classe_conso_energie_arrete_2012 text`,
  `ALTER TABLE ${qualified} ADD COLUMN IF NOT EXISTS usage_code_departement_insee text`,
];

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  for (const sql of alters) {
    await client.query(sql);
    console.log("[migrate-bdnb]", sql.slice(0, 80) + "…");
  }
  console.log("[migrate-bdnb] OK — colonnes présentes ; pour remplir les valeurs : réimport CSV (npm run import:bdnb-dep33).");
} finally {
  await client.end();
}
