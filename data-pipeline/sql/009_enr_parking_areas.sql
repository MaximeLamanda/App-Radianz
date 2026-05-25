-- Polygones parking Portail ENR (surfaces > 500 m², PARK-SUP-500).
-- PostGIS requis. Import : data-pipeline/matching_v5/import_enr_parking.py

CREATE TABLE IF NOT EXISTS public.enr_parking_areas (
  enr_id BIGINT NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  parking_tag TEXT NOT NULL DEFAULT 'enr',
  parking_value TEXT NOT NULL DEFAULT 'park_sup_500',
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (enr_id)
);

CREATE INDEX IF NOT EXISTS enr_parking_areas_geom_gix
  ON public.enr_parking_areas USING GIST (geom);

CREATE INDEX IF NOT EXISTS enr_parking_areas_tag_idx
  ON public.enr_parking_areas (parking_tag, parking_value);

COMMENT ON TABLE public.enr_parking_areas IS
  'Polygones parking ENR (>500 m²) pour jointure spatiale matching V5 (union avec OSM)';
