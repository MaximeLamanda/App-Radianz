/**
 * Table Postgres des entités Matching V5 (discovery).
 * Surchargeable via `SCOUT_MATCHING_V5_TABLE` (défaut `public.scout_matching_v5_features`).
 */

const DEFAULT = "public.scout_matching_v5_features";

const IDENT = /^[a-z][a-z0-9_]*$/;

export type ScoutMatchingV5TableRef = {
  schema: string;
  table: string;
  qualifiedSql: string;
};

function parseQualified(raw: string): { schema: string; table: string } {
  const t = raw.trim();
  if (!t) {
    return { schema: "public", table: "scout_matching_v5_features" };
  }
  const parts = t.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    return { schema: "public", table: parts[0]! };
  }
  if (parts.length === 2) {
    return { schema: parts[0]!, table: parts[1]! };
  }
  throw new Error(`SCOUT_MATCHING_V5_TABLE invalide: "${raw}" (attendu: schema.table ou table)`);
}

function validateIdent(name: string, label: string): void {
  if (!IDENT.test(name)) {
    throw new Error(`${label} invalide: "${name}" (lettre minuscule, chiffres, underscore)`);
  }
}

export function getScoutMatchingV5TableRef(envValue?: string): ScoutMatchingV5TableRef {
  const raw = envValue ?? process.env.SCOUT_MATCHING_V5_TABLE ?? DEFAULT;
  const { schema, table } = parseQualified(raw);
  validateIdent(schema, "Schéma scout_matching_v5");
  validateIdent(table, "Table scout_matching_v5");
  const qualifiedSql = `"${schema}"."${table}"`;
  return { schema, table, qualifiedSql };
}
