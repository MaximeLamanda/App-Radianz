import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";
import { mapPostgresLeadRow } from "@/lib/server/leads-row-mapper";

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

  const codeInsee = request.nextUrl.searchParams.get("codeInsee") ?? "33318";
  const limit = Math.min(
    1000,
    Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "200", 10) || 200)
  );

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const { rows } = await client.query<DbLeadRow>(
      `
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
      FROM public.scout_leads_pessac_enriched
      WHERE code_insee = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [codeInsee, limit]
    );

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
            "Vue scout_leads_pessac_enriched absente. Applique le schéma SQL puis importe le parquet parcelles-personnes-morales.",
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
