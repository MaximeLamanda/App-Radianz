-- Footprints bâtiments OpenStreetMap pour matching V5 (source géométrique prioritaire).
-- PostGIS requis. Import : data-pipeline/matching_v5/import_osm_buildings.py

CREATE TABLE IF NOT EXISTS public.osm_building_footprints (
  osm_type CHAR(1) NOT NULL CHECK (osm_type IN ('w', 'r')),
  osm_id BIGINT NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  address_text TEXT NOT NULL DEFAULT '',
  code_insee TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS osm_building_footprints_geom_gix
  ON public.osm_building_footprints USING GIST (geom);

CREATE INDEX IF NOT EXISTS osm_building_footprints_code_insee_idx
  ON public.osm_building_footprints (code_insee)
  WHERE code_insee IS NOT NULL AND btrim(code_insee) <> '';

CREATE INDEX IF NOT EXISTS osm_building_footprints_code_insee_geom_gix
  ON public.osm_building_footprints USING GIST (geom)
  WHERE code_insee IS NOT NULL AND btrim(code_insee) <> '';

CREATE INDEX IF NOT EXISTS osm_building_footprints_tags_gin
  ON public.osm_building_footprints USING GIN (tags);

COMMENT ON TABLE public.osm_building_footprints IS
'Footprints OSM (ways/relations building) pour matching V5 OSM→BNDB→cadastre';
