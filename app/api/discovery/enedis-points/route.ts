import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  DISCOVERY_ENEDIS_DEFAULT_YEAR,
  DISCOVERY_ENEDIS_MWH_SLIDER_MAX,
  isDiscoveryEnedisYear,
  parseDiscoveryEnedisApiLimit,
  type DiscoveryEnedisPoint,
  type DiscoveryEnedisPointsResponse,
} from "@/lib/discovery-enedis-layer";
import {
  buildEnedisSitesQuery,
  enedisSitesTableMissingMessage,
  isEnedisSitesTableMissingError,
} from "@/lib/discovery-enedis-db";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";

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

function parseMwhRange(searchParams: URLSearchParams): { min: number; max: number } {
  const minRaw = searchParams.get("mwhMin");
  const maxRaw = searchParams.get("mwhMax");
  const min =
    minRaw != null && minRaw !== "" && Number.isFinite(Number(minRaw))
      ? Math.max(0, Number(minRaw))
      : 0;
  const max =
    maxRaw != null && maxRaw !== "" && Number.isFinite(Number(maxRaw))
      ? Number(maxRaw)
      : DISCOVERY_ENEDIS_MWH_SLIDER_MAX;
  return { min, max };
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
  const bbox = parseBBox(searchParams);
  if (!bbox) {
    return NextResponse.json(
      {
        error:
          "Fournir une bbox complète (minLat, maxLat, minLng, maxLng).",
      },
      { status: 400 }
    );
  }

  const anneeRaw = (searchParams.get("annee") ?? DISCOVERY_ENEDIS_DEFAULT_YEAR).trim();
  const annee = isDiscoveryEnedisYear(anneeRaw) ? Number(anneeRaw) : Number(DISCOVERY_ENEDIS_DEFAULT_YEAR);
  const { min: mwhMin, max: mwhMax } = parseMwhRange(searchParams);
  const limit = parseDiscoveryEnedisApiLimit(searchParams.get("limit"));

  const { sql, params } = buildEnedisSitesQuery({
    minLng: bbox.minLng,
    minLat: bbox.minLat,
    maxLng: bbox.maxLng,
    maxLat: bbox.maxLat,
    annee,
    mwhMin,
    mwhMax,
    limit,
  });

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const res = await client.query<{
      id: string;
      lat: number;
      lng: number;
      mwh: number;
      annee: string;
      adresse: string;
      code_commune: string;
      code_secteur_naf2: string | null;
      nombre_de_sites: number;
    }>(sql, params);

    const points: DiscoveryEnedisPoint[] = res.rows.map((row) => ({
      id: row.id,
      lat: Number(row.lat),
      lng: Number(row.lng),
      mwh: Number(row.mwh),
      annee: String(row.annee),
      adresse: row.adresse,
      code_commune: row.code_commune,
      code_secteur_naf2: row.code_secteur_naf2,
      nombre_de_sites: Number(row.nombre_de_sites) || 1,
    }));

    const body: DiscoveryEnedisPointsResponse = {
      points,
      truncated: points.length >= limit,
      skippedNoAddress: 0,
      skippedGeocode: 0,
      communeCount: 0,
    };
    if (process.env.NODE_ENV !== "production") {
      console.log(`[enedis-points] ${points.length} point(s) (limit=${limit})`);
    }
    return NextResponse.json(body);
  } catch (err) {
    if (isEnedisSitesTableMissingError(err)) {
      return NextResponse.json({ error: enedisSitesTableMissingMessage() }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Erreur requête Enedis";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await client.end();
  }
}
