-- POI OpenStreetMap (points) pour enrichissement matching V5 — jointure ST_Within sur parcelles cadastrales.
-- PostGIS requis. Import : voir data-pipeline/matching_v5/import_osm_poi.py

CREATE TABLE IF NOT EXISTS public.osm_poi (
  osm_type CHAR(1) NOT NULL CHECK (osm_type IN ('n', 'w', 'r')),
  osm_id BIGINT NOT NULL,
  geom geometry(Point, 4326) NOT NULL,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb, -- sous-ensemble utile : type POI, nom, contact, addr:* (voir osm_poi_v5.tags_stored_for_postgres)
  code_insee TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (osm_type, osm_id)
);

CREATE INDEX IF NOT EXISTS osm_poi_geom_gix ON public.osm_poi USING GIST (geom);
CREATE INDEX IF NOT EXISTS osm_poi_code_insee_idx ON public.osm_poi (code_insee)
  WHERE code_insee IS NOT NULL AND btrim(code_insee) <> '';
CREATE INDEX IF NOT EXISTS osm_poi_tags_gin ON public.osm_poi USING GIN (tags);

COMMENT ON TABLE public.osm_poi IS 'POI OSM (nœud ou centroïde way/relation) pour jointure parcelle matching V5';
