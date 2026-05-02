/**
 * Importe le GeoJSON Pipeline (SCOUT_BDNB_POI_SAMPLE_GEOJSON ou défaut) → public.scout_bdnb_poi_sample.
 * Prérequis : npm run bdnb:poi-sample:schema
 *
 * Usage : npm run bdnb:poi-sample:import
 * Env    : SCOUT_BDNB_POI_SAMPLE_GEOJSON (optionnel, même convention que Next)
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { loadDotenvMap, resolveDatabaseUrl } from "./lib/resolve-database-url.mjs";

const root = process.cwd();
const dot = loadDotenvMap(path.join(root, ".env.local"));
for (const [k, v] of Object.entries(dot)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

const databaseUrl = resolveDatabaseUrl(root);
if (!databaseUrl) {
  console.error("Aucune DATABASE_URL / LOCAL_DATABASE_URL.");
  process.exit(1);
}

const rawPath = process.env.SCOUT_BDNB_POI_SAMPLE_GEOJSON?.trim();
const rel =
  rawPath || "data-pipeline/out/scout_bdnb_poi_sample_33318.geojson";
const geoPath = path.isAbsolute(rel) ? rel : path.join(root, rel);

let text;
try {
  text = fs.readFileSync(geoPath, "utf8");
} catch (e) {
  console.error(`Fichier introuvable: ${geoPath}`);
  process.exit(1);
}

let fc;
try {
  fc = JSON.parse(text);
} catch {
  console.error("GeoJSON invalide");
  process.exit(1);
}

const features = Array.isArray(fc.features) ? fc.features : [];

const client = new Client({ connectionString: databaseUrl });
await client.connect();

const insertSql = `
  INSERT INTO public.scout_bdnb_poi_sample (
    lead_id,
    batiment_groupe_id,
    footprint_path,
    lat,
    lng,
    area_m2,
    code_commune_insee,
    geom_wgs84,
    bdnb_staging,
    pois,
    passerelle_company_address,
    updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    CASE WHEN $8::text IS NULL OR $8::text = '' THEN NULL
         ELSE ST_SetSRID(ST_GeomFromGeoJSON($8::text), 4326)::geometry(Polygon, 4326)
    END,
    $9::jsonb,
    $10::jsonb,
    NULLIF(TRIM($11::text), ''),
    now()
  )
  ON CONFLICT (lead_id) DO UPDATE SET
    batiment_groupe_id = EXCLUDED.batiment_groupe_id,
    footprint_path = EXCLUDED.footprint_path,
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    area_m2 = EXCLUDED.area_m2,
    code_commune_insee = EXCLUDED.code_commune_insee,
    geom_wgs84 = EXCLUDED.geom_wgs84,
    bdnb_staging = EXCLUDED.bdnb_staging,
    pois = EXCLUDED.pois,
    passerelle_company_address = EXCLUDED.passerelle_company_address,
    updated_at = now()
`;

let n = 0;
try {
  await client.query("BEGIN");
  for (const f of features) {
    if (!f || typeof f !== "object" || f.type !== "Feature") continue;
    const props = f.properties ?? {};
    const leadId = String(props.lead_id ?? "").trim();
    if (!leadId) continue;

    const geom = f.geometry;
    const geomType = geom?.type;
    let geomJson = null;
    if (geomType === "Polygon") {
      geomJson = JSON.stringify(geom);
    } else if (geomType === "MultiPolygon") {
      console.warn(`[import] skip MultiPolygon lead_id=${leadId} (table Polygon uniquement)`);
      continue;
    }

    const lat = Number(props.lat);
    const lng = Number(props.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const bdnb = props.bdnb_staging ?? props.bdnbStaging;
    const pois = props.pois ?? [];
    const passerelleRaw =
      props.passerelle_company_address ?? props.passerelleCompanyAddress ?? null;
    const passerelle =
      passerelleRaw != null && String(passerelleRaw).trim() !== ""
        ? String(passerelleRaw).trim()
        : null;

    await client.query(insertSql, [
      leadId,
      String(props.batiment_groupe_id ?? ""),
      props.footprint_path != null ? String(props.footprint_path) : null,
      lat,
      lng,
      props.area_m2 != null ? Number(props.area_m2) : null,
      props.code_commune_insee != null ? String(props.code_commune_insee) : null,
      geomJson,
      bdnb == null ? null : JSON.stringify(bdnb),
      JSON.stringify(Array.isArray(pois) ? pois : []),
      passerelle,
    ]);
    n += 1;
  }
  await client.query("COMMIT");
  console.log(`[bdnb:poi-sample:import] OK — ${n} feature(s) depuis ${geoPath}`);
} catch (e) {
  await client.query("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  await client.end();
}
