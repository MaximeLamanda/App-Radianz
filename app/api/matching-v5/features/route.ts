import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";
import { getScoutMatchingV5TableRef } from "@/lib/scout-matching-v5-table";

const MAX_LIMIT = 5000;
/** Limite plus haute pour `mode=overview` (points + pas de `building_geometries_json`). */
const MAX_LIMIT_OVERVIEW = 35_000;

function parseScoutV5Id(searchParams: URLSearchParams): string | null {
  const raw = (searchParams.get("scout_v5_id") ?? "").trim();
  if (!raw) return null;
  if (!/^[a-zA-Z0-9_:\-|]{1,128}$/.test(raw)) return null;
  return raw;
}

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
  const scoutV5Id = parseScoutV5Id(searchParams);
  const modeRaw = (searchParams.get("mode") ?? "").trim().toLowerCase();
  const isOverview = modeRaw === "overview";

  let limit = Math.trunc(Number(searchParams.get("limit") ?? "2000"));
  if (!Number.isFinite(limit) || limit < 1) limit = 2000;
  const maxCap = isOverview ? MAX_LIMIT_OVERVIEW : MAX_LIMIT;
  limit = Math.min(Math.max(limit, 1), maxCap);
  if (scoutV5Id) limit = 1;

  const bbox = parseBBox(searchParams);
  if (!scoutV5Id && !codeInsee && !bbox) {
    return NextResponse.json(
      {
        error:
          "Fournir scout_v5_id, code_insee (une commune) ou une bbox complète (minLat, maxLat, minLng, maxLng) pour limiter la requête.",
      },
      { status: 400 }
    );
  }

  const tableRef = getScoutMatchingV5TableRef(process.env.SCOUT_MATCHING_V5_TABLE);
  const grainRaw = (searchParams.get("grain") ?? "").trim().toLowerCase();
  const grainFilter =
    grainRaw === "building" || grainRaw === "parcelle" ? grainRaw : null;

  const useOverviewGeom = isOverview && !scoutV5Id;

  try {
    const params: unknown[] = [];
    let p = 1;
    const whereParts: string[] = [];

    if (scoutV5Id) {
      whereParts.push(`scout_v5_id = $${p}`);
      params.push(scoutV5Id);
      p += 1;
    }
    if (codeInsee) {
      whereParts.push(`code_insee = $${p}`);
      params.push(codeInsee);
      p += 1;
    }
    if (bbox) {
      const a = p;
      const b = p + 1;
      const c = p + 2;
      const d = p + 3;
      whereParts.push(
        `geom && ST_MakeEnvelope($${a}::double precision, $${b}::double precision, $${c}::double precision, $${d}::double precision, 4326)`
      );
      whereParts.push(
        `ST_Intersects(geom, ST_MakeEnvelope($${a}::double precision, $${b}::double precision, $${c}::double precision, $${d}::double precision, 4326))`
      );
      params.push(bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat);
      p += 4;
    }
    if (grainFilter) {
      whereParts.push(`grain = $${p}`);
      params.push(grainFilter);
      p += 1;
    }
    const sqlFrom = `FROM ${tableRef.qualifiedSql} WHERE ${whereParts.join(" AND ")}`;
    const limitPlaceholder = p;
    params.push(limit);

    const geomSql = useOverviewGeom
      ? `ST_AsGeoJSON(ST_PointOnSurface(geom))::json AS geometry`
      : `ST_AsGeoJSON(geom)::json AS geometry`;
    const buildingCol = useOverviewGeom ? `NULL::jsonb AS building_geometries_json` : `building_geometries_json`;

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    let rows: {
      scout_v5_id: string;
      geometry: GeoJSON.Geometry;
      building_geometries_json: unknown;
      properties_json: Record<string, unknown>;
    }[];
    try {
      const res = await client.query<{
        scout_v5_id: string;
        geometry: GeoJSON.Geometry;
        building_geometries_json: unknown;
        properties_json: Record<string, unknown>;
      }>(
        `
      SELECT
        scout_v5_id,
        ${geomSql},
        ${buildingCol},
        properties_json
      ${sqlFrom}
      ORDER BY scout_v5_id
      LIMIT $${limitPlaceholder}
      `,
        params
      );
      rows = res.rows;
    } finally {
      await client.end().catch(() => {});
    }

    const features = rows
      .filter(
        (r) =>
          r.geometry &&
          (useOverviewGeom
            ? r.geometry.type === "Point"
            : r.geometry.type === "Polygon" || r.geometry.type === "MultiPolygon")
      )
      .map((r) => ({
        type: "Feature" as const,
        id: r.scout_v5_id,
        geometry: r.geometry,
        properties: {
          ...(r.properties_json ?? {}),
          building_geometries_json: r.building_geometries_json ?? [],
        },
      }));

    return NextResponse.json({ type: "FeatureCollection", features });
  } catch (err) {
    console.error("[matching-v5/features]", err);
    const body: { error: string; detail?: string; code?: string } = { error: "Erreur requête Postgres" };
    if (process.env.NODE_ENV === "development" && err instanceof Error) {
      body.detail = err.message;
      const c = (err as NodeJS.ErrnoException).code;
      if (typeof c === "string") body.code = c;
    }
    return NextResponse.json(body, { status: 500 });
  }
}
