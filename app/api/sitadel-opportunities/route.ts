import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { incrementQuotaAfterSuccess, requireAuthAndQuota } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";

type SitadelRow = {
  id: number;
  num_permis: string | null;
  comm: string | null;
  dest_loc: string | null;
  surf_loc: number | null;
  nature_projet: string | null;
  date_reelle_auth: string | null;
  date_doc: string | null;
  date_ouverture_chantier: string | null;
  date_achevement_travaux: string | null;
  annee_source: number | null;
  lat: number;
  lng: number;
  cadastre_polygon_geojson: unknown | null;
  ape_dem: string | null;
  cj_dem: string | null;
  denom_dem: string | null;
  siren_dem: string | null;
  siret_dem: string | null;
};

function parseNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSourceYears(value: string | null): number[] {
  if (!value) return [];
  const years = value
    .split(",")
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v) && v >= 2000 && v <= 2100);
  return Array.from(new Set(years));
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuthAndQuota(request, "sitadel_map");
  if (!authResult.ok) return authResult.response;
  const { uid } = authResult.context;

  const databaseUrl = getServerDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json(
      {
        error: `Variable Postgres manquante côté serveur (${getServerDatabaseUrlEnvHint()})`,
        envPresence: getServerDatabaseUrlEnvPresence(),
      },
      { status: 500 }
    );
  }

  const { searchParams } = request.nextUrl;
  const neLat = parseNumber(searchParams.get("ne_lat"));
  const neLng = parseNumber(searchParams.get("ne_lng"));
  const swLat = parseNumber(searchParams.get("sw_lat"));
  const swLng = parseNumber(searchParams.get("sw_lng"));
  const limitParam = parseNumber(searchParams.get("limit"));
  const sourceYears = parseSourceYears(searchParams.get("source_years"));
  const limit = Number.isFinite(limitParam) ? Math.max(100, Math.min(20000, Math.floor(limitParam!))) : 8000;

  if (neLat == null || neLng == null || swLat == null || swLng == null) {
    return NextResponse.json(
      { error: "Paramètres requis: ne_lat, ne_lng, sw_lat, sw_lng" },
      { status: 400 }
    );
  }

  const latMin = Math.min(swLat, neLat);
  const latMax = Math.max(swLat, neLat);
  const lngMin = Math.min(swLng, neLng);
  const lngMax = Math.max(swLng, neLng);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<SitadelRow>(
      `
      SELECT
        id,
        num_permis,
        comm,
        dest_loc,
        surf_loc,
        nature_projet,
        date_reelle_auth,
        date_doc,
        date_ouverture_chantier,
        date_achevement_travaux,
        annee_source,
        lat,
        lng,
        cadastre_polygon_geojson,
        ape_dem,
        cj_dem,
        denom_dem,
        siren_dem,
        siret_dem
      FROM public.sitadel_locaux_ci
      WHERE lat IS NOT NULL
        AND lng IS NOT NULL
        AND lat BETWEEN $1::double precision AND $2::double precision
        AND lng BETWEEN $3::double precision AND $4::double precision
        AND (
          cardinality($6::int[]) = 0
          OR annee_source = ANY($6::int[])
        )
      LIMIT $5;
      `,
      [latMin, latMax, lngMin, lngMax, limit, sourceYears]
    );

    incrementQuotaAfterSuccess(uid, "sitadel_map");

    const returned = result.rows.length;
    return NextResponse.json({
      opportunities: result.rows,
      meta: {
        limit,
        returned,
        truncated: returned >= limit,
      },
    });
  } catch (error) {
    console.error("[sitadel-opportunities] Erreur:", error);
    return NextResponse.json({ error: "Erreur lors de la requête Sitadel" }, { status: 500 });
  } finally {
    await client.end();
  }
}
