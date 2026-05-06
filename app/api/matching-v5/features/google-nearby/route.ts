import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { z } from "zod";
import { requireAuth } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";
import { getScoutMatchingV5TableRef } from "@/lib/scout-matching-v5-table";

/** Limite pratique pour éviter un corps HTTP / UPDATE disproportionné. */
const MAX_GOOGLE_NEARBY_ENTRIES = 200;

const googleNearbyRankedEntrySchema = z.object({
  rank: z.number().finite(),
  place_id: z.string().min(1).max(512),
  name: z.string().min(1).max(512),
  vicinity: z.string().max(2000).nullable().optional(),
  types: z.array(z.string().max(100)).max(80).nullable().optional(),
  lat: z.number().finite().nullable().optional(),
  lng: z.number().finite().nullable().optional(),
});

const patchBodySchema = z.object({
  scoutV5Id: z.string().min(1).max(512),
  googleNearbyRanked: z.array(googleNearbyRankedEntrySchema).max(MAX_GOOGLE_NEARBY_ENTRIES),
});

/**
 * Met à jour `properties_json.google_nearby_ranked_json` pour une ligne `scout_v5_id`.
 *
 * Attention : un `run_matching_v5 --write-postgres` sur le même périmètre peut réécraser
 * les lignes sans fusion ; cette persistance n’est pas garantie face à un réimport complet.
 */
export async function PATCH(request: NextRequest) {
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

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const parsed = patchBodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { scoutV5Id, googleNearbyRanked } = parsed.data;
  const payloadJson = JSON.stringify(googleNearbyRanked);
  const tableRef = getScoutMatchingV5TableRef(process.env.SCOUT_MATCHING_V5_TABLE);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ scout_v5_id: string }>(
      `
      UPDATE ${tableRef.qualifiedSql}
      SET properties_json = jsonb_set(
        COALESCE(properties_json, '{}'::jsonb),
        '{google_nearby_ranked_json}',
        $2::jsonb,
        true
      )
      WHERE scout_v5_id = $1
      RETURNING scout_v5_id
      `,
      [scoutV5Id, payloadJson]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Ligne introuvable pour ce scout_v5_id." }, { status: 404 });
    }
    return NextResponse.json({ updated: true });
  } finally {
    await client.end();
  }
}
