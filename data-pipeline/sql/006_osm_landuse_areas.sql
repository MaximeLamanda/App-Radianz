-- Polygones OpenStreetMap landuse=* pour matching V5 (zone_tag sur empreintes OSM).
-- PostGIS requis. Import : data-pipeline/matching_v5/import_osm_landuse.py

CREATE TABLE IF NOT EXISTS public.osm_landuse_areas (
  osm_type CHAR(1) NOT NULL CHECK (osm_type IN ('w', 'r')),
  osm_id BIGINT NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  landuse TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS osm_landuse_areas_geom_gix
  ON public.osm_landuse_areas USING GIST (geom);

CREATE INDEX IF NOT EXISTS osm_landuse_areas_landuse_idx
  ON public.osm_landuse_areas (landuse);

COMMENT ON TABLE public.osm_landuse_areas IS
  'Polygones OSM landuse (ways/relations) pour jointure spatiale matching V5 OSM→parcelle';
