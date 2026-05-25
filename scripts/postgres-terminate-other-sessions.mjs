/**
 * Liste ou termine les autres sessions client sur la base courante (même URL que l’import BDNB).
 * Utile quand un DDL reste bloqué sur le catalogue (ex. pg_type) à cause d’une autre connexion.
 *
 * Usage :
 *   node scripts/postgres-terminate-other-sessions.mjs           → dry-run (affiche seulement)
 *   node scripts/postgres-terminate-other-sessions.mjs --execute → pg_terminate_backend sur chaque autre pid
 */
import { Client } from "pg";
import { resolveDatabaseUrl } from "./lib/resolve-database-url.mjs";

const execute = process.argv.includes("--execute");
const url = resolveDatabaseUrl(process.cwd());
if (!url) {
  console.error("[terminate-sessions] Aucune URL Postgres (LOCAL_DATABASE_URL / DATABASE_URL / .env.local).");
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();
const self = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;

const { rows } = await client.query(`
  SELECT
    pid,
    usename::text AS usename,
    application_name,
    state,
    wait_event_type,
    client_addr::text AS client_addr,
    LEFT(query, 200) AS query_preview
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND pid <> pg_backend_pid()
    AND backend_type = 'client backend'
  ORDER BY pid
`);

if (rows.length === 0) {
  console.log(`[terminate-sessions] Aucune autre session client sur cette base (pid courant ${self}).`);
  await client.end();
  process.exit(0);
}

console.log(`[terminate-sessions] ${rows.length} autre(s) session(s) (nous = pid ${self}) :`);
for (const r of rows) {
  console.log(
    `  pid=${r.pid} user=${r.usename} app=${JSON.stringify(r.application_name)} state=${r.state} wait=${r.wait_event_type} addr=${r.client_addr}`
  );
  if (r.query_preview) console.log(`    query: ${r.query_preview.replace(/\s+/g, " ").trim()}`);
}

if (!execute) {
  console.log("[terminate-sessions] Dry-run. Relancer avec --execute pour appeler pg_terminate_backend sur chaque pid ci-dessus.");
  await client.end();
  process.exit(0);
}

let killed = 0;
for (const { pid } of rows) {
  const { rows: kr } = await client.query("SELECT pg_terminate_backend($1::int) AS ok", [pid]);
  if (kr[0]?.ok) killed++;
  else console.warn(`[terminate-sessions] pg_terminate_backend(${pid}) → false (déjà parti ou non autorisé)`);
}
console.log(`[terminate-sessions] Terminé : ${killed}/${rows.length} backend(s) signalé(s).`);
await client.end();
