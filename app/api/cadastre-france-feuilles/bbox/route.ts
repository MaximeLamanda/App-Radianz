import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";

function toNum(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type CadastreGeomRow = {
  source_id: string | null;
  code_insee: string | null;
  section: string | null;
  numero: string | null;
  numero_norm: string | null;
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown> | null;
};

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;

  const swLat = toNum(request.nextUrl.searchParams.get("swLat"));
  const swLng = toNum(request.nextUrl.searchParams.get("swLng"));
  const neLat = toNum(request.nextUrl.searchParams.get("neLat"));
  const neLng = toNum(request.nextUrl.searchParams.get("neLng"));
  const codeInsee = request.nextUrl.searchParams.get("codeInsee")?.trim() || "33318";

  if (
    swLat == null ||
    swLng == null ||
    neLat == null ||
    neLng == null ||
    !Number.isFinite(swLat) ||
    !Number.isFinite(swLng) ||
    !Number.isFinite(neLat) ||
    !Number.isFinite(neLng)
  ) {
    return NextResponse.json({ error: "Paramètres bbox invalides." }, { status: 400 });
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

  const minLat = Math.min(swLat, neLat);
  const maxLat = Math.max(swLat, neLat);
  const minLng = Math.min(swLng, neLng);
  const maxLng = Math.max(swLng, neLng);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<CadastreGeomRow>(
      `
      SELECT
        source_id,
        code_insee,
        section,
        numero,
        numero_norm,
        ST_AsGeoJSON(geom)::json AS geometry,
        properties
      FROM public.cadastre_france_feuilles_geom
      WHERE code_insee = $1
        AND geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)
        AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 4326))
      `,
      [codeInsee, minLng, minLat, maxLng, maxLat]
    );

    const features: GeoJSON.Feature[] = rows.map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        ...(r.properties ?? {}),
        source_id: r.source_id,
        code_insee: r.code_insee,
        codeInsee: r.code_insee,
        section: r.section,
        numero: r.numero,
        numero_norm: r.numero_norm,
      },
    }));

    return NextResponse.json({
      type: "FeatureCollection" as const,
      features,
      meta: {
        source: "public.cadastre_france_feuilles_geom",
        codeInsee,
        returned: features.length,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Erreur lecture cadastre_france_feuilles_geom", detail: msg },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}

