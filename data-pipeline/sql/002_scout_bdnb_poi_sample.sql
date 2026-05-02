-- Échantillon Pipeline BDNB → POI → SIRENE (équivalent du fichier GeoJSON), en local Postgres.
-- Appliquer après PostGIS : npm run bdnb:poi-sample:schema

CREATE TABLE IF NOT EXISTS public.scout_bdnb_poi_sample (
  lead_id TEXT PRIMARY KEY,
  batiment_groupe_id TEXT NOT NULL,
  footprint_path TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  area_m2 DOUBLE PRECISION,
  code_commune_insee TEXT,
  geom_wgs84 geometry(Polygon, 4326),
  bdnb_staging JSONB,
  pois JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scout_bdnb_poi_sample_geom_gix
  ON public.scout_bdnb_poi_sample USING GIST (geom_wgs84);

COMMENT ON TABLE public.scout_bdnb_poi_sample IS
  'MS2 : enrichissement Pipeline (équivalent GeoJSON BDNB→POI→SIRENE par commune INSEE), servi par /api/scout-pipeline/... si SCOUT_BDNB_POI_SAMPLE_SOURCE=postgres';

ALTER TABLE public.scout_bdnb_poi_sample
  ADD COLUMN IF NOT EXISTS passerelle_company_address TEXT;
