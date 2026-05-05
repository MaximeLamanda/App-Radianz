import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";
import { getBdnbConstructionsTableRef } from "@/lib/bdnb-constructions-table";
import { splitMatchingV5BuildingIds } from "@/lib/matching-v5-building-ids";

async function readIdsFromRequest(request: NextRequest): Promise<string[]> {
  const { searchParams } = request.nextUrl;
  const fromQuery = searchParams.get("ids") ?? "";
  if (fromQuery.trim()) {
    return fromQuery
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 300);
  }

  try {
    const body = (await request.json()) as { ids?: unknown };
    if (Array.isArray(body?.ids)) {
      return body.ids
        .map((v) => String(v).trim())
        .filter(Boolean)
        .slice(0, 300);
    }
  } catch {
    // Ignore body parse errors and fallback to empty list.
  }

  return [];
}

async function handleRequest(request: NextRequest) {
  let client: Client | null = null;
  try {
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

    const ids = await readIdsFromRequest(request);

    if (ids.length === 0) {
      return NextResponse.json({ type: "FeatureCollection", features: [] });
    }
    const { constructionIds, groupIds } = splitMatchingV5BuildingIds(ids);
    if (constructionIds.length === 0 && groupIds.length === 0) {
      return NextResponse.json({ type: "FeatureCollection", features: [] });
    }

    const tableRef = getBdnbConstructionsTableRef(process.env.BDNB_CONSTRUCTIONS_TABLE);
    const ffoQualified = `"${tableRef.schema}"."batiment_groupe_ffo_bat"`;

    client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const runBuildingsQuery = async (withFfoJoin: boolean) =>
      client.query<{
        batiment_construction_id: string;
        batiment_groupe_id: string | null;
        annee_construction: number | null;
        footprint_m2: number | null;
        geometry: GeoJSON.Geometry;
      }>(
        withFfoJoin
          ? `
      SELECT
        bc.batiment_construction_id::text,
        bc.batiment_groupe_id::text,
        ffo.annee_construction,
        ST_Area(bc.geom_cstr)::double precision AS footprint_m2,
        ST_AsGeoJSON(ST_Transform(bc.geom_cstr, 4326))::json AS geometry
      FROM ${tableRef.qualifiedSql} bc
      LEFT JOIN ${ffoQualified} ffo
        ON ffo.batiment_groupe_id::text = bc.batiment_groupe_id::text
      WHERE bc.geom_cstr IS NOT NULL
        AND (
          (array_length($1::text[], 1) IS NOT NULL AND bc.batiment_construction_id::text = ANY($1::text[]))
          OR
          (array_length($2::text[], 1) IS NOT NULL AND bc.batiment_groupe_id::text = ANY($2::text[]))
        )
      `
          : `
      SELECT
        bc.batiment_construction_id::text,
        bc.batiment_groupe_id::text,
        NULL::integer AS annee_construction,
        ST_Area(bc.geom_cstr)::double precision AS footprint_m2,
        ST_AsGeoJSON(ST_Transform(bc.geom_cstr, 4326))::json AS geometry
      FROM ${tableRef.qualifiedSql} bc
      WHERE bc.geom_cstr IS NOT NULL
        AND (
          (array_length($1::text[], 1) IS NOT NULL AND bc.batiment_construction_id::text = ANY($1::text[]))
          OR
          (array_length($2::text[], 1) IS NOT NULL AND bc.batiment_groupe_id::text = ANY($2::text[]))
        )
      `,
        [constructionIds, groupIds]
      );

    let rows: Array<{
      batiment_construction_id: string;
      batiment_groupe_id: string | null;
      annee_construction: number | null;
      footprint_m2: number | null;
      geometry: GeoJSON.Geometry;
    }>;
    try {
      const res = await runBuildingsQuery(true);
      rows = res.rows;
    } catch (err) {
      const pgCode = (err as { code?: string } | null)?.code;
      // Tolère les environnements où la table FFO n'est pas encore déployée.
      if (pgCode === "42P01" || pgCode === "42703") {
        const res = await runBuildingsQuery(false);
        rows = res.rows;
      } else {
        throw err;
      }
    }

    const features = rows
      .filter((r) => r.geometry && (r.geometry.type === "Polygon" || r.geometry.type === "MultiPolygon"))
      .map((r) => ({
        type: "Feature" as const,
        id: `bdnbcstr:${r.batiment_construction_id}`,
        geometry: r.geometry,
        properties: {
          batiment_construction_id: r.batiment_construction_id,
          batiment_groupe_id: r.batiment_groupe_id,
          annee_construction: r.annee_construction,
          footprint_m2: r.footprint_m2,
        },
      }));

    return NextResponse.json({ type: "FeatureCollection", features });
  } catch (err) {
    console.error("[matching-v5/buildings]", err);
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    const pgCode = (err as { code?: string } | null)?.code ?? null;
    return NextResponse.json({ error: "Erreur requête Postgres", message, pgCode }, { status: 500 });
  } finally {
    if (client) {
      await client.end();
    }
  }
}

export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}

