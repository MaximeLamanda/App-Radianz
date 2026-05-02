/**
 * Nom de la table Postgres des bâtiments BDNB (scripts d’import, build pipeline).
 * Défaut : public.bdnb_buildings — plus de nom figé par département (ex. bdnb_2025_07a_33).
 */
const DEFAULT = "public.bdnb_buildings";

const IDENT = /^[a-z][a-z0-9_]*$/;

export type BdnbBuildingsTableRef = {
  schema: string;
  /** Nom de table sans schéma */
  table: string;
  /** Identifiant qualifié sûr pour interpolation SQL (schéma et nom validés). */
  qualifiedSql: string;
};

function parseQualified(raw: string): { schema: string; table: string } {
  const t = raw.trim();
  if (!t) {
    return { schema: "public", table: "bdnb_buildings" };
  }
  const parts = t.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    return { schema: "public", table: parts[0]! };
  }
  if (parts.length === 2) {
    return { schema: parts[0]!, table: parts[1]! };
  }
  throw new Error(`BDNB_BUILDINGS_TABLE invalide: "${raw}" (attendu: schema.table ou table)`);
}

function validateIdent(name: string, label: string): void {
  if (!IDENT.test(name)) {
    throw new Error(`${label} invalide: "${name}" (lettre minuscule, chiffres, underscore)`);
  }
}

/**
 * Lit `process.env.BDNB_BUILDINGS_TABLE` (ou valeur passée) et retourne des identifiants SQL sûrs.
 */
export function getBdnbBuildingsTableRef(envValue?: string): BdnbBuildingsTableRef {
  const raw = envValue ?? process.env.BDNB_BUILDINGS_TABLE ?? DEFAULT;
  const { schema, table } = parseQualified(raw);
  validateIdent(schema, "Schéma BDNB");
  validateIdent(table, "Table BDNB");
  const qualifiedSql = `"${schema}"."${table}"`;
  return { schema, table, qualifiedSql };
}
