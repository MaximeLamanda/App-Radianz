import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";
import { parseMatchingV5TileZXY } from "@/lib/discovery-mvt-tile";
import { getScoutBuildingsMvtRevision } from "@/lib/matching-v5-mvt-revision";
import {
  buildMvtWeakEtag,
  ifNoneMatchSatisfied,
  SCOUT_BUILDINGS_MVT_CACHE_CONTROL,
} from "@/lib/matching-v5-mvt-tiles-http";
import { toleranceDegForMatchingV5MvtZoom } from "@/lib/matching-v5-mvt-simplify";
import { MatchingV5MvtTileLru } from "@/lib/matching-v5-mvt-tile-lru";

/**
 * Vue matérialisée des bâtiments OSM dédupliqués par osm_building_id
 * (cf. data-pipeline/sql/007_scout_matching_v5_buildings_mv.sql).
 */
const BUILDINGS_MV_QUALIFIED = "public.scout_matching_v5_buildings_mv";

const g = globalThis as unknown as { __scoutMvtTileLru?: MatchingV5MvtTileLru };
const tileLru = (g.__scoutMvtTileLru ??= new MatchingV5MvtTileLru(256));

export async function GET(
  request: NextRequest,
  context: { params: { z: string; x: string; y: string } }
) {
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

  const { z: zs, x: xs, y: ys } = context.params;
  const tile = parseMatchingV5TileZXY(zs, xs, ys);
  if (!tile) {
    return NextResponse.json({ error: "Coordonnées de tuile invalides" }, { status: 400 });
  }
  const { z, x, y } = tile;

  const revision = getScoutBuildingsMvtRevision();
  const cacheKey = `${revision}:${z}:${x}:${y}`;
  const ifNoneMatch = request.headers.get("if-none-match");

  const cached = tileLru.get(cacheKey);
  if (cached) {
    if (ifNoneMatchSatisfied(ifNoneMatch, cached.etag)) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: cached.etag,
          "Cache-Control": SCOUT_BUILDINGS_MVT_CACHE_CONTROL,
        },
      });
    }
    return new NextResponse(Buffer.from(cached.body), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Cache-Control": SCOUT_BUILDINGS_MVT_CACHE_CONTROL,
        ETag: cached.etag,
      },
    });
  }

  const toleranceDeg = toleranceDegForMatchingV5MvtZoom(z);

  try {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    let rows: { mvt: Buffer | null }[];
    try {
      const res = await client.query<{ mvt: Buffer | null }>(
        `
      SELECT ST_AsMVT(mvtgeom, 'buildings', 4096, 'geom') AS mvt
      FROM (
        SELECT
          osm_building_id,
          ST_AsMVTGeom(
            ST_Transform(
              ST_SimplifyPreserveTopology(geom, $4::double precision),
              3857
            ),
            ST_TileEnvelope($1::integer, $2::integer, $3::integer),
            4096,
            256,
            true
          ) AS geom
        FROM ${BUILDINGS_MV_QUALIFIED}
        WHERE geom && ST_Transform(ST_TileEnvelope($1::integer, $2::integer, $3::integer), 4326)
          AND ST_Intersects(geom, ST_Transform(ST_TileEnvelope($1::integer, $2::integer, $3::integer), 4326))
      ) AS mvtgeom
      WHERE mvtgeom.geom IS NOT NULL
      `,
        [z, x, y, toleranceDeg]
      );
      rows = res.rows;
    } finally {
      await client.end().catch(() => {});
    }
    const buf = rows[0]?.mvt ?? null;
    const body = buf && buf.length > 0 ? Uint8Array.from(buf) : new Uint8Array(0);
    const etag = buildMvtWeakEtag(revision, z, x, y, body);
    tileLru.set(cacheKey, etag, body);

    if (ifNoneMatchSatisfied(ifNoneMatch, etag)) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": SCOUT_BUILDINGS_MVT_CACHE_CONTROL,
        },
      });
    }

    return new NextResponse(Buffer.from(body), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Cache-Control": SCOUT_BUILDINGS_MVT_CACHE_CONTROL,
        ETag: etag,
      },
    });
  } catch (err) {
    console.error("[matching-v5/tiles]", err);
    return NextResponse.json({ error: "Erreur tuile Postgres" }, { status: 500 });
  }
}
