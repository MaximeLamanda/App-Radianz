import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  buildCombosOverviewFootprintRatioWhere,
  buildCombosOverviewNafDivisionWhere,
  buildCombosOverviewParkingWhere,
  buildCombosOverviewSirenWhere,
  buildCombosOverviewSurfaceWhere,
  isCombosOverviewNafDivision,
  parseCombosOverviewSirensParam,
  type CombosOverviewSirenRole,
} from "@/lib/discovery-combos-overview-http";
import { DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT } from "@/lib/discovery-footprint-ratio-defaults";
import { DISCOVERY_SURFACE_SLIDER_MAX_M2 } from "@/lib/discovery-surface-defaults";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";

const COMBOS_QUALIFIED = "public.scout_matching_v5_combos";
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

function parseRangeBounds(
  searchParams: URLSearchParams,
  minKey: string,
  maxKey: string,
  defaultMax: number
): { min: number; max: number } {
  const minRaw = searchParams.get(minKey);
  const maxRaw = searchParams.get(maxKey);
  const min =
    minRaw != null && minRaw !== "" && Number.isFinite(Number(minRaw))
      ? Math.max(0, Number(minRaw))
      : 0;
  const max =
    maxRaw != null && maxRaw !== "" && Number.isFinite(Number(maxRaw))
      ? Number(maxRaw)
      : defaultMax;
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
          "Bbox obligatoire : minLat, maxLat, minLng, maxLng.",
      },
      { status: 400 }
    );
  }

  let limit = Math.trunc(Number(searchParams.get("limit") ?? "20000"));
  if (!Number.isFinite(limit) || limit < 1) limit = 20_000;
  limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  const { min: minFootprintM2, max: maxFootprintM2 } = parseRangeBounds(
    searchParams,
    "minFootprintM2",
    "maxFootprintM2",
    DISCOVERY_SURFACE_SLIDER_MAX_M2
  );
  const { min: minParkingM2, max: maxParkingM2 } = parseRangeBounds(
    searchParams,
    "minParkingM2",
    "maxParkingM2",
    DISCOVERY_SURFACE_SLIDER_MAX_M2
  );
  const { min: minFootprintRatioPct, max: maxFootprintRatioPct } = parseRangeBounds(
    searchParams,
    "minFootprintRatioPct",
    "maxFootprintRatioPct",
    DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT
  );

  const sirenRoleRaw = searchParams.get("sirenRole")?.trim() ?? "";
  const sirenRaws = searchParams.getAll("siren");
  const nafDivisionRaw = searchParams.get("nafDivision")?.trim() ?? "";
  const sirenRole: CombosOverviewSirenRole | null =
    sirenRoleRaw === "owner" || sirenRoleRaw === "domiciliation" ? sirenRoleRaw : null;
  const parsedSirens = parseCombosOverviewSirensParam(
    sirenRaws.length > 0 ? sirenRaws : (searchParams.get("siren") ?? "")
  );
  const hasSirenFilter = Boolean(sirenRole && parsedSirens.length > 0);
  const hasNafFilter = Boolean(nafDivisionRaw && isCombosOverviewNafDivision(nafDivisionRaw));

  if (sirenRaws.length > 0 || searchParams.get("siren")) {
    const rawPresent =
      sirenRaws.length > 0 || Boolean(searchParams.get("siren")?.trim());
    if (rawPresent && (!sirenRole || parsedSirens.length === 0)) {
      return NextResponse.json(
        {
          error:
            "Paramètre(s) siren invalide(s) (9 chiffres chacun) ou sirenRole manquant (owner | domiciliation).",
        },
        { status: 400 }
      );
    }
  }
  if (nafDivisionRaw && !isCombosOverviewNafDivision(nafDivisionRaw)) {
    return NextResponse.json(
      { error: "Paramètre nafDivision invalide (2 chiffres requis)." },
      { status: 400 }
    );
  }
  if (hasNafFilter && sirenRole === "owner") {
    return NextResponse.json(
      { error: "nafDivision n’est pas compatible avec sirenRole=owner (domiciliation uniquement)." },
      { status: 400 }
    );
  }

  try {
    const params: unknown[] = [];
    let p = 1;
    const whereParts: string[] = [];

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

    const surfaceFilter = buildCombosOverviewSurfaceWhere(
      { minFootprintM2, maxFootprintM2 },
      p
    );
    whereParts.push(...surfaceFilter.sqlFragments);
    params.push(...surfaceFilter.params);
    p = surfaceFilter.nextParamIndex;

    const parkingFilter = buildCombosOverviewParkingWhere(
      { minParkingM2, maxParkingM2 },
      p
    );
    whereParts.push(...parkingFilter.sqlFragments);
    params.push(...parkingFilter.params);
    p = parkingFilter.nextParamIndex;

    const ratioFilter = buildCombosOverviewFootprintRatioWhere(
      { minRatioPct: minFootprintRatioPct, maxRatioPct: maxFootprintRatioPct },
      p
    );
    whereParts.push(...ratioFilter.sqlFragments);
    params.push(...ratioFilter.params);
    p = ratioFilter.nextParamIndex;

    if (hasSirenFilter && sirenRole) {
      const sirenFilter = buildCombosOverviewSirenWhere(
        { role: sirenRole, sirens: parsedSirens },
        p
      );
      whereParts.push(...sirenFilter.sqlFragments);
      params.push(...sirenFilter.params);
      p = sirenFilter.nextParamIndex;
    }

    if (hasNafFilter) {
      const nafFilter = buildCombosOverviewNafDivisionWhere({ division: nafDivisionRaw }, p);
      whereParts.push(...nafFilter.sqlFragments);
      params.push(...nafFilter.params);
      p = nafFilter.nextParamIndex;
    }

    const limitPlaceholder = p;
    params.push(limit);

    const orderBySql = `ST_Distance(
          geography(geom),
          geography(ST_SetSRID(ST_MakePoint(
            ($${a}::double precision + $${c}::double precision) * 0.5,
            ($${b}::double precision + $${d}::double precision) * 0.5
          ), 4326))
        ) ASC NULLS LAST,
        footprint_sum_m2 DESC,
        combo_id`;

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    let rows: {
      combo_id: string;
      footprint_sum_m2: number | null;
      parcel_contour_sum_m2: number | null;
      parking_sum_m2: number | null;
      has_landuse_waiver: boolean | null;
      anchor_parcelle_id: string | null;
      parcelle_scout_v5_ids: string[] | null;
      osm_building_ids: string[] | null;
      zone_tags: string[] | null;
      construction_years: number[] | null;
      naf_divisions: string[] | null;
      geometry: GeoJSON.Point;
    }[];
    try {
      const res = await client.query<{
        combo_id: string;
        footprint_sum_m2: number | null;
        parcel_contour_sum_m2: number | null;
        parking_sum_m2: number | null;
        has_landuse_waiver: boolean | null;
        anchor_parcelle_id: string | null;
        parcelle_scout_v5_ids: string[] | null;
        osm_building_ids: string[] | null;
        zone_tags: string[] | null;
        construction_years: number[] | null;
        naf_divisions: string[] | null;
        geometry: GeoJSON.Point;
      }>(
        `
      SELECT
        combo_id,
        footprint_sum_m2,
        parcel_contour_sum_m2,
        parking_sum_m2,
        has_landuse_waiver,
        anchor_parcelle_id,
        parcelle_scout_v5_ids,
        osm_building_ids,
        zone_tags,
        construction_years,
        naf_divisions,
        ST_AsGeoJSON(geom)::json AS geometry
      FROM ${COMBOS_QUALIFIED}
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
        id: r.combo_id,
        geometry: r.geometry,
        properties: {
          combo_id: r.combo_id,
          footprint_sum_m2: r.footprint_sum_m2 ?? 0,
          parcel_contour_sum_m2: r.parcel_contour_sum_m2 ?? 0,
          parking_sum_m2: r.parking_sum_m2 ?? 0,
          has_landuse_waiver: Boolean(r.has_landuse_waiver),
          anchor_parcelle_id: r.anchor_parcelle_id ?? "",
          parcelle_scout_v5_ids: Array.isArray(r.parcelle_scout_v5_ids)
            ? r.parcelle_scout_v5_ids.filter((s) => typeof s === "string" && s.length > 0)
            : [],
          osm_building_ids: Array.isArray(r.osm_building_ids)
            ? r.osm_building_ids.filter((s) => typeof s === "string" && s.length > 0)
            : [],
          zone_tags: Array.isArray(r.zone_tags)
            ? r.zone_tags.filter((s) => typeof s === "string" && s.length > 0)
            : [],
          construction_years: Array.isArray(r.construction_years)
            ? r.construction_years
                .map((y) => (typeof y === "number" ? y : Number(y)))
                .filter((y) => Number.isFinite(y))
                .map((y) => Math.trunc(y))
            : [],
          naf_divisions: Array.isArray(r.naf_divisions)
            ? r.naf_divisions.filter((s) => typeof s === "string" && /^\d{2}$/.test(s.trim()))
            : [],
        },
      }));

    return NextResponse.json({ type: "FeatureCollection", features });
  } catch (err) {
    console.error("[matching-v5/combos-overview]", err);
    const body: { error: string; detail?: string; code?: string } = {
      error: "Erreur requête Postgres",
    };
    if (process.env.NODE_ENV === "development" && err instanceof Error) {
      body.detail = err.message;
      const c = (err as NodeJS.ErrnoException).code;
      if (typeof c === "string") body.code = c;
    }
    return NextResponse.json(body, { status: 500 });
  }
}
