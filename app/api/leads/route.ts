import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";
import { mapPostgresLeadRow } from "@/lib/server/leads-row-mapper";
import { parseOptionalCodeInseeListFromSearchParams } from "@/lib/scout-leads-code-insee";

type DbLeadRow = {
  id: string;
  name: string | null;
  quality_score: number | null;
  contact_name: string | null;
  thumbnail_url: string | null;
  created_at: string;
  siren: string | null;
  siret: string | null;
  company_legal_name: string | null;
  company_legal_form: string | null;
  company_address: string | null;
  parcelles_count: number | null;
  code_insee: string | null;
};

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;

  const databaseUrl = getServerDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json(
      {
        error: `Variable Postgres manquante (${getServerDatabaseUrlEnvHint()})`,
        envPresence: getServerDatabaseUrlEnvPresence(),
      },
      { status: 500 }
    );
  }

  const codeInseeFilter = parseOptionalCodeInseeListFromSearchParams(request.nextUrl.searchParams);
  const limit = Math.min(
    1000,
    Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "200", 10) || 200)
  );

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const baseFrom = `
      SELECT
        lead_id::text AS id,
        COALESCE(denomination, 'Lead') AS name,
        effectif_score::int AS quality_score,
        NULL::text AS contact_name,
        NULL::text AS thumbnail_url,
        created_at,
        siren,
        siret,
        company_legal_name,
        company_legal_form,
        company_address,
        parcelles_count,
        code_insee
      FROM public.scout_leads_enriched`;
    const sql =
      codeInseeFilter === null
        ? `${baseFrom}
      ORDER BY created_at DESC
      LIMIT $1`
        : `${baseFrom}
      WHERE code_insee = ANY($1::text[])
      ORDER BY created_at DESC
      LIMIT $2`;
    const params: unknown[] = codeInseeFilter === null ? [limit] : [codeInseeFilter, limit];

    const { rows } = await client.query<DbLeadRow>(sql, params);

    return NextResponse.json({
      leads: rows.map((r) => mapPostgresLeadRow(r)),
    });
  } catch (error) {
    console.error("[api/leads]", error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("does not exist") || msg.includes("n'existe pas")) {
      return NextResponse.json(
        {
          error:
            "Vue scout_leads_enriched ou table scout_leads_communes absente. Applique data-pipeline/sql/001_scout_schema.sql, peuple scout_leads_communes (INSERT code_insee), importe PPM si besoin.",
          detail: msg,
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Erreur lecture leads Postgres" }, { status: 500 });
  } finally {
    await client.end();
  }
}
