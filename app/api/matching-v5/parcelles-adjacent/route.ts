import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  cadastreLabelFromKeys,
  scoutV5IdFromCadastreKeys,
} from "@/lib/discovery-cadastre-parcel";
import {
  PARCELLES_ADJACENT_MAX_RESULTS,
  parseParcellesAdjacentRequest,
} from "@/lib/matching-v5-parcelles-adjacent-http";
import { getScoutMatchingV5TableRef } from "@/lib/scout-matching-v5-table";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";

const COMBOS_QUALIFIED = "public.scout_matching_v5_combos";
const CADASTRE_QUALIFIED = "public.cadastre_france_feuilles_geom";

type CadastreRow = {
  scout_v5_id: string;
  geometry: GeoJSON.Geometry;
  code_insee: string;
  section: string;
  numero_norm: string;
  combo_id: string | null;
  combo_parcelle_scout_v5_ids: string[] | null;
  matching_scout_v5_id: string | null;
};

function mapParcelleRows(rows: CadastreRow[]) {
  return rows
    .filter(
      (r) =>
        r.geometry &&
        (r.geometry.type === "Polygon" || r.geometry.type === "MultiPolygon") &&
        r.code_insee &&
        r.section &&
        r.numero_norm
    )
    .map((r) => {
      const scoutId =
        r.scout_v5_id || scoutV5IdFromCadastreKeys(r.code_insee, r.section, r.numero_norm);
      const comboIds = Array.isArray(r.combo_parcelle_scout_v5_ids)
        ? r.combo_parcelle_scout_v5_ids.filter((s) => typeof s === "string" && s.length > 0)
        : [];
      return {
        scout_v5_id: scoutId,
        geometry: r.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
        code_insee: r.code_insee,
        section: r.section,
        numero_norm: r.numero_norm,
        combo_id: r.combo_id ?? null,
        combo_parcelle_scout_v5_ids: comboIds,
        cadastre_label: cadastreLabelFromKeys(r.code_insee, r.section, r.numero_norm),
        in_matching_v5: Boolean(r.matching_scout_v5_id),
      };
    });
}

function cadastreParcelleSelectSql(matchingQualified: string): string {
  return `
    SELECT DISTINCT ON (c.code_insee, c.section, c.numero_norm)
      ('parcelle:' || c.code_insee || ':' || c.section || ':' || c.numero_norm) AS scout_v5_id,
      ST_AsGeoJSON(c.geom)::json AS geometry,
      c.code_insee,
      c.section,
      c.numero_norm,
      combo.combo_id,
      combo.parcelle_scout_v5_ids AS combo_parcelle_scout_v5_ids,
      m.scout_v5_id AS matching_scout_v5_id
    FROM ${CADASTRE_QUALIFIED} c
    LEFT JOIN ${matchingQualified} m
      ON m.grain = 'parcelle'
      AND m.scout_v5_id = ('parcelle:' || c.code_insee || ':' || c.section || ':' || c.numero_norm)
    LEFT JOIN LATERAL (
      SELECT cmb.combo_id, cmb.parcelle_scout_v5_ids
      FROM ${COMBOS_QUALIFIED} cmb
      WHERE m.scout_v5_id IS NOT NULL
        AND m.scout_v5_id = ANY(cmb.parcelle_scout_v5_ids)
      LIMIT 1
    ) combo ON true
  `;
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

  const parsed = parseParcellesAdjacentRequest(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const matchingRef = getScoutMatchingV5TableRef(process.env.SCOUT_MATCHING_V5_TABLE);
  const selectSql = cadastreParcelleSelectSql(matchingRef.qualifiedSql);

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();

    if (parsed.mode === "bbox") {
      const { bounds, codeInsee, excludeIds } = parsed;
      const res = await client.query<CadastreRow>(
        `
        ${selectSql}
        WHERE c.code_insee = ANY($1::text[])
          AND c.geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)
          AND ST_Intersects(c.geom, ST_MakeEnvelope($2, $3, $4, $5, 4326))
          AND NOT (
            ('parcelle:' || c.code_insee || ':' || c.section || ':' || c.numero_norm) = ANY($6::text[])
          )
        ORDER BY c.code_insee, c.section, c.numero_norm
        LIMIT $7
        `,
        [
          codeInsee,
          bounds.sw.lng,
          bounds.sw.lat,
          bounds.ne.lng,
          bounds.ne.lat,
          excludeIds,
          PARCELLES_ADJACENT_MAX_RESULTS,
        ]
      );

      const parcelles = mapParcelleRows(res.rows);
      return NextResponse.json({
        parcelles,
        source: "cadastre_france_feuilles_geom",
        mode: "bbox",
        truncated: parcelles.length >= PARCELLES_ADJACENT_MAX_RESULTS,
      });
    }

    const { parcelleIds, excludeIds, bufferM } = parsed;
    const res = await client.query<CadastreRow>(
      `
      WITH anchors AS (
        SELECT geom, NULLIF(TRIM(code_insee), '') AS code_insee
        FROM ${matchingRef.qualifiedSql}
        WHERE grain = 'parcelle'
          AND scout_v5_id = ANY($1::text[])
      ),
      anchor_insee AS (
        SELECT DISTINCT code_insee
        FROM anchors
        WHERE code_insee IS NOT NULL
      ),
      union_anchor AS (
        SELECT ST_Union(geom) AS geom FROM anchors
      )
      ${selectSql}
      CROSS JOIN union_anchor ua
      WHERE c.code_insee IN (SELECT code_insee FROM anchor_insee)
        AND NOT (
          ('parcelle:' || c.code_insee || ':' || c.section || ':' || c.numero_norm) = ANY($2::text[])
        )
        AND ua.geom IS NOT NULL
        AND (
          ST_Touches(c.geom, ua.geom)
          OR ST_DWithin(c.geom::geography, ua.geom::geography, $3::double precision)
        )
      ORDER BY c.code_insee, c.section, c.numero_norm
      LIMIT $4
      `,
      [parcelleIds, excludeIds, bufferM, PARCELLES_ADJACENT_MAX_RESULTS]
    );

    const parcelles = mapParcelleRows(res.rows);
    return NextResponse.json({
      parcelles,
      source: "cadastre_france_feuilles_geom",
      mode: "anchor",
      truncated: parcelles.length >= PARCELLES_ADJACENT_MAX_RESULTS,
    });
  } catch (err) {
    console.error("[matching-v5/parcelles-adjacent]", err);
    return NextResponse.json({ error: "Erreur requête Postgres" }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}
