/**
 * Liste les codes INSEE distincts du cadastre pour un préfixe département.
 */
import { Client } from "pg";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

/** @param {string} dep */
export function isValidDepCode(dep) {
  const d = String(dep ?? "").trim();
  return /^\d{2,3}$/.test(d) || /^2[ABab]$/.test(d);
}

/**
 * @param {string} repoRoot
 * @param {string} dep
 * @returns {Promise<string[]>}
 */
export async function listCommunesForDep(repoRoot, dep) {
  const prefix = String(dep).trim();
  const databaseUrl = resolveDatabaseUrl(repoRoot);
  if (!databaseUrl) {
    throw new Error(
      "Aucune URL Postgres (LOCAL_DATABASE_URL / .env.local / …)."
    );
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT DISTINCT code_insee::text AS code_insee
       FROM public.cadastre_france_feuilles_geom
       WHERE code_insee LIKE $1
       ORDER BY 1`,
      [`${prefix}%`]
    );
    return rows.map((r) => String(r.code_insee).trim()).filter(Boolean);
  } finally {
    await client.end();
  }
}
