import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuthAndQuota, incrementQuotaAfterSuccess } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";

/**
 * Bâtiments groupe BDNB pour Talence uniquement : table `public.bdnb_talence_geom_raw`
 * (remplie par l’import sans jointure, surface groupe > 1000 m² — voir scripts/import-bdnb-postgres.mjs, INSEE 33522).
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthAndQuota(request, "bdnb");
  if (!authResult.ok) return authResult.response;
  const { uid } = authResult.context;

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

  const { searchParams } = request.nextUrl;
  const minLat = parseFloat(searchParams.get("minLat") ?? "");
  const maxLat = parseFloat(searchParams.get("maxLat") ?? "");
  const minLng = parseFloat(searchParams.get("minLng") ?? "");
  const maxLng = parseFloat(searchParams.get("maxLng") ?? "");
  const limit = Math.min(
    2000,
    Math.max(1, parseInt(searchParams.get("limit") ?? "800", 10) || 800)
  );

  if (![minLat, maxLat, minLng, maxLng].every((n) => Number.isFinite(n))) {
    return NextResponse.json(
      { error: "minLat, maxLat, minLng, maxLng requis et numériques" },
      { status: 400 }
    );
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{
      batiment_groupe_id: string;
      code_commune_insee: string;
      area_m2: string;
      geom: unknown;
    }>(
      `
      SELECT
        batiment_groupe_id::text,
        code_commune_insee,
        area_m2::text,
        ST_AsGeoJSON(ST_Transform(geom_groupe, 4326))::json AS geom
      FROM public.bdnb_talence_geom_raw
      WHERE geom_groupe IS NOT NULL
        AND ST_Intersects(
          geom_groupe,
          ST_Transform(
            ST_MakeEnvelope($1::double precision, $2::double precision, $3::double precision, $4::double precision, 4326),
            2154
          )
        )
      ORDER BY area_m2 DESC
      LIMIT $5
      `,
      [minLng, minLat, maxLng, maxLat, limit]
    );

    incrementQuotaAfterSuccess(uid, "bdnb");

    const features = rows.map((r) => ({
      type: "Feature" as const,
      geometry: r.geom,
      properties: {
        batiment_groupe_id: r.batiment_groupe_id,
        code_commune_insee: r.code_commune_insee,
        area_m2: parseFloat(r.area_m2),
      },
    }));

    return NextResponse.json({
      type: "FeatureCollection",
      features,
    });
  } catch (err) {
    console.error("[bdnb-talence-raw/bbox]", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not exist") || msg.includes("n'existe pas")) {
      return NextResponse.json(
        {
          error: "Table bdnb_talence_geom_raw absente. Lance npm run import:bdnb-dep33 (ou l’import BDNB).",
          detail: msg,
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Erreur requête Postgres" }, { status: 500 });
  } finally {
    await client.end();
  }
}
