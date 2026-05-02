/**
 * URL Postgres côté serveur.
 *
 * Convention projet : `.env.local` / Vercel utilisent le préfixe `Radianz_` :
 * - `Radianz_DATABASE_URL` (poolé, usage principal)
 * - `Radianz_DATABASE_URL_UNPOOLED` (direct ; dernier recours si pas de poolé)
 *
 * Fallbacks sans préfixe pour CI et autres environnements.
 */
const KEYS = [
  /** Dev local explicite (ex. Docker `docker compose`). */
  "LOCAL_DATABASE_URL",
  // Vercel / bonnes pratiques: variables souvent en MAJUSCULES
  "RADIANZ_DATABASE_URL",
  "Radianz_DATABASE_URL",
  "RADIANZ_POSTGRES_URL",
  "Radianz_POSTGRES_URL",
  "POSTGRES_URL",
  "DATABASE_URL",
  "RADIANZ_DATABASE_URL_UNPOOLED",
  "Radianz_DATABASE_URL_UNPOOLED",
  "DATABASE_URL_UNPOOLED",
  "RADIANZ_POSTGRES_URL_NON_POOLING",
  "Radianz_POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL_NON_POOLING",
] as const;

export function getServerDatabaseUrl(): string | undefined {
  for (const k of KEYS) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** Liste des clés essayées (message d’erreur API). */
export function getServerDatabaseUrlEnvHint(): string {
  return KEYS.join(", ");
}

/**
 * Diagnostic "safe": n'affiche pas les valeurs, uniquement la présence.
 * Utile en prod quand Vercel a la bonne variable mais que le runtime ne la voit pas.
 */
export function getServerDatabaseUrlEnvPresence(): Record<(typeof KEYS)[number], boolean> {
  const out = {} as Record<(typeof KEYS)[number], boolean>;
  for (const k of KEYS) {
    const v = process.env[k];
    out[k] = typeof v === "string" && v.trim().length > 0;
  }
  return out;
}
