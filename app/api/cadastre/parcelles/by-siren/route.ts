import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";
import { mergeCadastreFeatureCollections, padNumeroParcelle, type GeoJsonFeature } from "@/lib/cadastre-parcelle";

const IGN_PARCELLE = "https://apicarto.ign.fr/api/cadastre/parcelle";
const MAX_PARCELLES = 120;
const FETCH_TIMEOUT_MS = 10000;

async function fetchJson(url: string): Promise<{ features?: GeoJsonFeature[] } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as { features?: GeoJsonFeature[] };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;

  const siren = request.nextUrl.searchParams.get("siren")?.trim() ?? "";
  const codeInsee = request.nextUrl.searchParams.get("codeInsee")?.trim() || "33318";
  if (!/^\d{9}$/.test(siren)) {
    return NextResponse.json({ error: "Paramètre siren invalide (9 chiffres requis)." }, { status: 400 });
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
      code_insee: string | null;
      section: string | null;
      numero_parcelle: string | null;
    }>(
      `
      SELECT DISTINCT code_insee, section, numero_parcelle
      FROM public.parcelles_personnes_morales
      WHERE numero_siren = $1
        AND code_insee = $2
        AND section IS NOT NULL
        AND TRIM(section) <> ''
        AND numero_parcelle IS NOT NULL
        AND TRIM(numero_parcelle::text) <> ''
      ORDER BY section, numero_parcelle
      LIMIT $3
      `,
      [siren, codeInsee, MAX_PARCELLES]
    );

    if (rows.length === 0) {
      return NextResponse.json({
        type: "FeatureCollection" as const,
        features: [],
        warning: "Aucune parcelle trouvée pour ce SIREN et code INSEE.",
      });
    }

    const collections: Array<{ features?: GeoJsonFeature[] }> = [];
    for (const pr of rows) {
      const ci = (pr.code_insee ?? codeInsee).trim();
      const sec = String(pr.section ?? "").trim();
      const num = padNumeroParcelle(pr.numero_parcelle);
      if (!ci || !sec || !num) continue;
      const q = new URLSearchParams({ code_insee: ci, section: sec, numero: num });
      const geo = await fetchJson(`${IGN_PARCELLE}?${q.toString()}`);
      if (geo) collections.push(geo);
      await new Promise((r) => setTimeout(r, 30));
    }

    const merged = mergeCadastreFeatureCollections(collections);
    return NextResponse.json(merged);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Erreur cadastre par siren", detail: msg }, { status: 500 });
  } finally {
    await client.end();
  }
}

