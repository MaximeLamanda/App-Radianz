import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";

/**
 * Vue matérialisée des bâtiments OSM dédupliqués (1 ligne par osm_building_id).
 * Cf. data-pipeline/sql/007_scout_matching_v5_buildings_mv.sql
 */
const BUILDINGS_MV_QUALIFIED = "public.scout_matching_v5_buildings_mv";

const MAX_LIMIT = 35_000;

function parseBBox(searchParams: URLSearchParams): {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
} | null {
  const minLat = Number(searchParams.get("minLat"));
  const maxLat = Number(searchParams.get("maxLat"));
  const minLng = Number(searchParams.get("minLng"));
  const maxLng = Number(searchParams.get("maxLng"));
  if (![minLat, maxLat, minLng, maxLng].every((n) => Number.isFinite(n))) {
    return null;
  }
  return { minLng, minLat, maxLng, maxLat };
}

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

  const { searchParams } = request.nextUrl;
  const codeInsee = (searchParams.get("code_insee") ?? "").trim();
  const bbox = parseBBox(searchParams);
  if (!codeInsee && !bbox) {
    return NextResponse.json(
      {
        error:
          "Fournir code_insee (une commune) ou une bbox complète (minLat, maxLat, minLng, maxLng) pour limiter la requête.",
      },
      { status: 400 }
    );
  }

  let limit = Math.trunc(Number(searchParams.get("limit") ?? "20000"));
  if (!Number.isFinite(limit) || limit < 1) limit = 20_000;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  try {
    const params: unknown[] = [];
    let p = 1;
    const whereParts: string[] = [];

    if (codeInsee) {
      whereParts.push(`code_insee = $${p}`);
      params.push(codeInsee);
      p += 1;
    }
    let bboxParam: { a: number; b: number; c: number; d: number } | null = null;
    if (bbox) {
      const a = p;
      const b = p + 1;
      const c = p + 2;
      const d = p + 3;
      bboxParam = { a, b, c, d };
      whereParts.push(
        `geom && ST_MakeEnvelope($${a}::double precision, $${b}::double precision, $${c}::double precision, $${d}::double precision, 4326)`
      );
      whereParts.push(
        `ST_Intersects(geom, ST_MakeEnvelope($${a}::double precision, $${b}::double precision, $${c}::double precision, $${d}::double precision, 4326))`
      );
      params.push(bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat);
      p += 4;
    }
    const limitPlaceholder = p;
    params.push(limit);

    /** Avec LIMIT, privilégier le centre viewport évite d’exclure des bâtiments visibles (tri osm_building_id arbitraire). */
    const orderBySql = bboxParam
      ? `ST_Distance(
          geography(ST_PointOnSurface(geom)),
          geography(ST_SetSRID(ST_MakePoint(
            ($${bboxParam.a}::double precision + $${bboxParam.c}::double precision) * 0.5,
            ($${bboxParam.b}::double precision + $${bboxParam.d}::double precision) * 0.5
          ), 4326))
        ) ASC NULLS LAST,
        COALESCE(footprint_m2, 0) DESC,
        osm_building_id`
      : `COALESCE(footprint_m2, 0) DESC, osm_building_id`;

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    let rows: {
      osm_building_id: string;
      geometry: GeoJSON.Point;
      footprint_m2: number | null;
      matching_status: string | null;
      parcelle_count: number | string | null;
      parcelle_scout_v5_ids: string[] | null;
    }[];
    try {
      const res = await client.query<{
        osm_building_id: string;
        geometry: GeoJSON.Point;
        footprint_m2: number | null;
        matching_status: string | null;
        parcelle_count: number | string | null;
        parcelle_scout_v5_ids: string[] | null;
      }>(
        `
      SELECT
        osm_building_id,
        ST_AsGeoJSON(ST_PointOnSurface(geom))::json AS geometry,
        footprint_m2,
        matching_status,
        parcelle_count,
        parcelle_scout_v5_ids
      FROM ${BUILDINGS_MV_QUALIFIED}
      WHERE ${whereParts.join(" AND ")}
      ORDER BY ${orderBySql}
      LIMIT $${limitPlaceholder}
      `,
        params
      );
      rows = res.rows;
    } finally {
      await client.end().catch(() => {});
    }

    const features = rows
      .filter((r) => r.geometry && r.geometry.type === "Point")
      .map((r) => ({
        type: "Feature" as const,
        id: r.osm_building_id,
        geometry: r.geometry,
        properties: {
          osm_building_id: r.osm_building_id,
          footprint_m2: r.footprint_m2 ?? null,
          matching_status: r.matching_status ?? "",
          parcelle_count: r.parcelle_count == null ? 0 : Number(r.parcelle_count),
          parcelle_scout_v5_ids: Array.isArray(r.parcelle_scout_v5_ids)
            ? r.parcelle_scout_v5_ids.filter((s) => typeof s === "string" && s.length > 0)
            : [],
        },
      }));

    return NextResponse.json({ type: "FeatureCollection", features });
  } catch (err) {
    console.error("[matching-v5/buildings-overview]", err);
    const body: { error: string; detail?: string; code?: string } = { error: "Erreur requête Postgres" };
    if (process.env.NODE_ENV === "development" && err instanceof Error) {
      body.detail = err.message;
      const c = (err as NodeJS.ErrnoException).code;
      if (typeof c === "string") body.code = c;
    }
    return NextResponse.json(body, { status: 500 });
  }
}
