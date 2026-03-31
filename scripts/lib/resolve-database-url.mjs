/**
 * Même ordre que `lib/server-database-url.ts` (Radianz_* en tête).
 */
import fs from "node:fs";

export const DATABASE_URL_ENV_KEYS = [
  "RADIANZ_DATABASE_URL",
  "Radianz_DATABASE_URL",
  "RADIANZ_POSTGRES_URL",
  "Radianz_POSTGRES_URL",
  "POSTGRES_URL",
  "DATABASE_URL",
  "NEON_DATABASE_URL",
  "RADIANZ_DATABASE_URL_UNPOOLED",
  "Radianz_DATABASE_URL_UNPOOLED",
  "DATABASE_URL_UNPOOLED",
  "RADIANZ_POSTGRES_URL_NON_POOLING",
  "Radianz_POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL_NON_POOLING",
];

export function pickDatabaseUrlFromEnvObject(env) {
  if (!env || typeof env !== "object") return null;
  for (const k of DATABASE_URL_ENV_KEYS) {
    const v = env[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function loadDotenvMap(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const txt = fs.readFileSync(filePath, "utf8");
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

/** process.env puis `.env.local` à la racine du repo (cwd par défaut). */
export function resolveDatabaseUrl(repoRoot = process.cwd()) {
  const fromProcess = pickDatabaseUrlFromEnvObject(process.env);
  if (fromProcess) return fromProcess;
  const map = loadDotenvMap(`${repoRoot}/.env.local`);
  return pickDatabaseUrlFromEnvObject(map);
}
