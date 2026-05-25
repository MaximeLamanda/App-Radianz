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

/**
 * `osm_building_id` est au format pipeline : `w:123`, `r:456`, `n:1`.
 * On accepte aussi un format un peu plus large pour les variantes éventuelles.
 */
function isValidOsmBuildingId(raw: string): boolean {
  return /^[wnr]:\d{1,20}$/.test(raw);
}

export async function GET(
  request: NextRequest,
  context: { params: { osmId: string } }
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

  const osmId = decodeURIComponent(String(context.params?.osmId ?? "")).trim();
  if (!osmId || !isValidOsmBuildingId(osmId)) {
    return NextResponse.json({ error: "osm_building_id invalide" }, { status: 400 });
  }

  try {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    let rows: {
      osm_building_id: string;
      parcelle_scout_v5_ids: string[] | null;
      batiment_construction_id: string | null;
      footprint_m2: number | null;
      matching_status: string | null;
    }[];
    try {
      const res = await client.query<{
        osm_building_id: string;
        parcelle_scout_v5_ids: string[] | null;
        batiment_construction_id: string | null;
        footprint_m2: number | null;
        matching_status: string | null;
      }>(
        `
      SELECT
        osm_building_id,
        parcelle_scout_v5_ids,
        batiment_construction_id,
        footprint_m2,
        matching_status
      FROM ${BUILDINGS_MV_QUALIFIED}
      WHERE osm_building_id = $1
      LIMIT 1
      `,
        [osmId]
      );
      rows = res.rows;
    } finally {
      await client.end().catch(() => {});
    }
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: "Bâtiment introuvable" }, { status: 404 });
    }
    return NextResponse.json({
      osm_building_id: row.osm_building_id,
      parcelle_scout_v5_ids: Array.isArray(row.parcelle_scout_v5_ids)
        ? row.parcelle_scout_v5_ids.filter((s) => typeof s === "string" && s.length > 0)
        : [],
      batiment_construction_id: row.batiment_construction_id ?? null,
      footprint_m2: row.footprint_m2 ?? null,
      matching_status: row.matching_status ?? "",
    });
  } catch (err) {
    console.error("[matching-v5/buildings/parcelles]", err);
    return NextResponse.json({ error: "Erreur requête Postgres" }, { status: 500 });
  }
}
