/**
 * Nom de la table Postgres des bâtiments unitaires BDNB ("batiment_construction").
 *
 * Par défaut on pointe vers le schéma open data dep33 présent dans le repo, mais
 * c'est surchargable via `BDNB_CONSTRUCTIONS_TABLE`.
 */
const DEFAULT = "bdnb_2025_07_a_open_data_dep33.batiment_construction";

const IDENT = /^[a-z][a-z0-9_]*$/;

export type BdnbConstructionsTableRef = {
  schema: string;
  /** Nom de table sans schéma */
  table: string;
  /** Identifiant qualifié sûr pour interpolation SQL (schéma et nom validés). */
  qualifiedSql: string;
};

function parseQualified(raw: string): { schema: string; table: string } {
  const t = raw.trim();
  if (!t) {
    return { schema: "public", table: "batiment_construction" };
  }
  const parts = t.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    return { schema: "public", table: parts[0]! };
  }
  if (parts.length === 2) {
    return { schema: parts[0]!, table: parts[1]! };
  }
  throw new Error(`BDNB_CONSTRUCTIONS_TABLE invalide: "${raw}" (attendu: schema.table ou table)`);
}

function validateIdent(name: string, label: string): void {
  if (!IDENT.test(name)) {
    throw new Error(`${label} invalide: "${name}" (lettre minuscule, chiffres, underscore)`);
  }
}

/**
 * Lit `process.env.BDNB_CONSTRUCTIONS_TABLE` (ou valeur passée) et retourne des identifiants SQL sûrs.
 */
export function getBdnbConstructionsTableRef(envValue?: string): BdnbConstructionsTableRef {
  const raw = envValue ?? process.env.BDNB_CONSTRUCTIONS_TABLE ?? DEFAULT;
  const { schema, table } = parseQualified(raw);
  validateIdent(schema, "Schéma BDNB constructions");
  validateIdent(table, "Table BDNB constructions");
  const qualifiedSql = `"${schema}"."${table}"`;
  return { schema, table, qualifiedSql };
}

