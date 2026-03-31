import { NextRequest, NextResponse } from "next/server";
import { requireAuthAndQuota, incrementQuotaAfterSuccess } from "@/lib/api-auth-quota";
import {
  getServerDatabaseUrl,
  getServerDatabaseUrlEnvHint,
  getServerDatabaseUrlEnvPresence,
} from "@/lib/server-database-url";
import { Client } from "pg";

// Conversion WGS84 → Lambert93 (EPSG:2154)
// Copié de /app/api/bdnb/route.ts pour rester autonome
function wgs84ToLambert93(lat: number, lng: number): { x: number; y: number } {
  const a = 6378137.0;
  const e = 0.0818191910428158;
  const lc = (3 * Math.PI) / 180;
  const phi1 = (44 * Math.PI) / 180;
  const phi2 = (49 * Math.PI) / 180;
  const phi0 = (46.5 * Math.PI) / 180;
  const x0 = 700000;
  const y0 = 6600000;

  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;

  const sinPhi1 = Math.sin(phi1);
  const sinPhi2 = Math.sin(phi2);
  const sinPhi0 = Math.sin(phi0);

  const eSinPhi1 = e * sinPhi1;
  const eSinPhi2 = e * sinPhi2;
  const eSinPhi0 = e * sinPhi0;

  const m1 = Math.cos(phi1) / Math.sqrt(1 - eSinPhi1 * eSinPhi1);
  const m2 = Math.cos(phi2) / Math.sqrt(1 - eSinPhi2 * eSinPhi2);

  const tPhi = (phi: number) => {
    const sinP = e * Math.sin(phi);
    return (
      Math.tan(Math.PI / 4 - phi / 2) *
      Math.pow((1 + sinP) / (1 - sinP), e / 2)
    );
  };

  const t1 = tPhi(phi1);
  const t2 = tPhi(phi2);
  const t0 = tPhi(phi0);
  const tLat = tPhi(latRad);

  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const F = m1 / (n * Math.pow(t1, n));
  const rho0 = a * F * Math.pow(t0, n);
  const rho = a * F * Math.pow(tLat, n);
  const theta = n * (lngRad - lc);

  const x = x0 + rho * Math.sin(theta);
  const y = y0 + rho0 - rho * Math.cos(theta);

  return { x, y };
}

type NeonBdnbRow = {
  id: string;
  code_commune_insee: string | null;
  annee_construction: number | null;
  dpe_mix_arrete_classe: string | null;
  nb_logements: number | null;
  surface_habitable_logement: string | number | null;
  usage_principal_bdnb_open: string | null;
  geom_geojson_wgs84: string | null;
  distance_m: number | null;
};

export async function GET(request: NextRequest) {
  const authResult = await requireAuthAndQuota(request, "bdnb_neon");
  if (!authResult.ok) return authResult.response;
  const { uid } = authResult.context;

  const databaseUrl = getServerDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json(
      {
        error: `Variable Postgres manquante côté serveur (${getServerDatabaseUrlEnvHint()})`,
        envPresence: getServerDatabaseUrlEnvPresence(),
      },
      { status: 500 }
    );
  }

  const { searchParams } = request.nextUrl;
  const latStr = searchParams.get("lat");
  const lngStr = searchParams.get("lng");
  const radiusStr = searchParams.get("radiusM");

  if (!latStr || !lngStr) {
    return NextResponse.json(
      { error: "lat et lng requis" },
      { status: 400 }
    );
  }

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: "lat et lng doivent être des nombres valides" },
      { status: 400 }
    );
  }

  const radiusM = radiusStr ? parseFloat(radiusStr) : 80;
  const safeRadiusM = Number.isFinite(radiusM) && radiusM > 0 ? Math.min(radiusM, 2000) : 80;

  const center = wgs84ToLambert93(lat, lng);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const q = await client.query<NeonBdnbRow>(
      `
      WITH p AS (
        SELECT ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), 2154) AS pt
      )
      SELECT
        b.batiment_groupe_id AS id,
        b.code_commune_insee,
        b.annee_construction,
        b.dpe_mix_arrete_classe,
        b.nb_logements,
        b.surface_habitable_logement,
        b.usage_principal_bdnb_open,
        ST_AsGeoJSON(ST_Transform(b.geom_groupe, 4326)) AS geom_geojson_wgs84,
        ST_Distance(b.geom_groupe, (SELECT pt FROM p)) AS distance_m
      FROM public.bdnb_2025_07a_33 b
      WHERE ST_DWithin(b.geom_groupe, (SELECT pt FROM p), $3::double precision)
      ORDER BY distance_m ASC
      LIMIT 1;
      `,
      [center.x, center.y, safeRadiusM]
    );

    incrementQuotaAfterSuccess(uid, "bdnb_neon");

    if (!q.rows.length) return NextResponse.json({ batiment: null });
    return NextResponse.json({ batiment: q.rows[0] });
  } catch (err) {
    console.error("[bdnb-neon] Erreur:", err);
    return NextResponse.json(
      { error: "Erreur lors de la requête Neon" },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}

