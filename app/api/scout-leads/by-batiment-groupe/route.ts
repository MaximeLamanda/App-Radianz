import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;

  const batimentGroupeId = request.nextUrl.searchParams.get("batiment_groupe_id")?.trim() ?? "";
  if (!batimentGroupeId) {
    return NextResponse.json({ error: "Paramètre batiment_groupe_id requis." }, { status: 400 });
  }

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

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{
      lead_id: string;
      denomination: string | null;
      siren: string | null;
      siret: string | null;
    }>(
      `
      SELECT
        lead_id::text,
        denomination,
        siren,
        siret
      FROM public.scout_leads
      WHERE batiment_groupe_id = $1
      LIMIT 1
      `,
      [batimentGroupeId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ lead: null });
    }
    const r = rows[0]!;
    return NextResponse.json({
      lead: {
        id: r.lead_id,
        name: r.denomination,
        siren: r.siren,
        siret: r.siret,
      },
    });
  } catch (err) {
    console.error("[scout-leads/by-batiment-groupe]", err);
    return NextResponse.json({ error: "Erreur requête Postgres" }, { status: 500 });
  } finally {
    await client.end();
  }
}
