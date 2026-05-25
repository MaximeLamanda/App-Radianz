-- Polygones OpenStreetMap parking (amenity/leisure/landuse=parking) pour matching V5.
-- PostGIS requis. Import : data-pipeline/matching_v5/import_osm_parking.py

CREATE TABLE IF NOT EXISTS public.osm_parking_areas (
  osm_type CHAR(1) NOT NULL CHECK (osm_type IN ('w', 'r')),
  osm_id BIGINT NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  parking_tag TEXT NOT NULL,
  parking_value TEXT NOT NULL DEFAULT 'parking',
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS osm_parking_areas_geom_gix
  ON public.osm_parking_areas USING GIST (geom);

CREATE INDEX IF NOT EXISTS osm_parking_areas_tag_idx
  ON public.osm_parking_areas (parking_tag, parking_value);

COMMENT ON TABLE public.osm_parking_areas IS
  'Polygones OSM parking pour jointure spatiale matching V5 (bâtiment via parcelle commune)';
