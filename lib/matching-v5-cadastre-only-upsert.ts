import type { Client } from "pg";

export type MatchingV5MatchStatus = "matched" | "cadastre_only";

export type CadastreOnlyParcelleUpsertInput = {
  scoutV5Id: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  codeInsee: string;
  section: string;
  numeroNorm: string;
};

const CADASTRE_ONLY_ALLOWED_CODE_INSEE = "33318";

/** Règle produit: ne jamais écraser une ligne déjà `matched`. */
export function resolveCadastreOnlyNextMatchStatus(
  existingStatus: string | null | undefined
): MatchingV5MatchStatus {
  return String(existingStatus ?? "").trim().toLowerCase() === "matched" ? "matched" : "cadastre_only";
}

/** Rollout limité à Pessac. */
export function isCadastreOnlyUpsertEnabledForCodeInsee(
  codeInsee: string | null | undefined
): boolean {
  return String(codeInsee ?? "").trim() === CADASTRE_ONLY_ALLOWED_CODE_INSEE;
}

function sqlLiteralIdent(ident: string): string {
  return `"${ident.replaceAll('"', '""')}"`;
}

function qualifiedSql(schema: string, table: string): string {
  return `${sqlLiteralIdent(schema)}.${sqlLiteralIdent(table)}`;
}

export async function upsertCadastreOnlyParcelles(params: {
  client: Client;
  matchingTable: { schema: string; table: string };
  parcelles: readonly CadastreOnlyParcelleUpsertInput[];
}): Promise<void> {
  const { client, parcelles, matchingTable } = params;
  const filtered = parcelles.filter((p) => isCadastreOnlyUpsertEnabledForCodeInsee(p.codeInsee));
  if (filtered.length === 0) return;
  const tableSql = qualifiedSql(matchingTable.schema, matchingTable.table);

  for (const p of filtered) {
    await client.query(
      `
      INSERT INTO ${tableSql} (
        scout_v5_id,
        geom,
        grain,
        code_insee,
        section,
        numero_norm,
        match_status,
        properties_json
      ) VALUES (
        $1,
        ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
        'parcelle',
        $3,
        $4,
        $5,
        'cadastre_only',
        $6::jsonb
      )
      ON CONFLICT (scout_v5_id)
      DO UPDATE SET
        geom = EXCLUDED.geom,
        code_insee = EXCLUDED.code_insee,
        section = EXCLUDED.section,
        numero_norm = EXCLUDED.numero_norm,
        properties_json = CASE
          WHEN COALESCE(${tableSql}.match_status, '') = 'matched' THEN ${tableSql}.properties_json
          ELSE EXCLUDED.properties_json
        END,
        match_status = CASE
          WHEN COALESCE(${tableSql}.match_status, '') = 'matched' THEN 'matched'
          ELSE 'cadastre_only'
        END
      `,
      [
        p.scoutV5Id,
        JSON.stringify(p.geometry),
        p.codeInsee,
        p.section,
        p.numeroNorm,
        JSON.stringify({ source: "cadastre_france_feuilles_geom", upsert_mode: "cadastre_only" }),
      ]
    );
  }
}
