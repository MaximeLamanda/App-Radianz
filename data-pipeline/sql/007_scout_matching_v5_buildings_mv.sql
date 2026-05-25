-- Matching V5 discovery — vue matérialisée des bâtiments OSM dédupliqués.
-- Source : aplatissement de scout_matching_v5_features.building_geometries_json,
-- 1 ligne par osm_building_id (un building partagé entre N parcelles n'apparaît qu'une fois).
-- Appliquer après 003_scout_matching_v5_features.sql sur la même instance que le pipeline V5.
-- Rafraîchir avec : REFRESH MATERIALIZED VIEW CONCURRENTLY public.scout_matching_v5_buildings_mv

CREATE MATERIALIZED VIEW IF NOT EXISTS public.scout_matching_v5_buildings_mv AS
WITH flat AS (
  SELECT
    f.scout_v5_id,
    f.code_insee,
    (b.entry->>'osm_building_id')::text AS osm_building_id,
    NULLIF(b.entry->>'batiment_construction_id', '') AS batiment_construction_id,
    ST_Multi(
      ST_SetSRID(ST_GeomFromGeoJSON(b.entry->'geometry'), 4326)
    )::geometry(MultiPolygon, 4326) AS geom,
    NULLIF(b.entry->>'footprint_m2', '')::double precision AS footprint_m2,
    NULLIF(b.entry->>'matching_status', '') AS matching_status
  FROM public.scout_matching_v5_features f,
       LATERAL jsonb_array_elements(f.building_geometries_json) AS b(entry)
  WHERE f.grain = 'parcelle'
    AND COALESCE(b.entry->>'osm_building_id', '') <> ''
    AND b.entry->'geometry' IS NOT NULL
),
canonical AS (
  SELECT DISTINCT ON (osm_building_id)
    osm_building_id,
    code_insee,
    batiment_construction_id,
    geom,
    footprint_m2,
    matching_status
  FROM flat
  ORDER BY osm_building_id, scout_v5_id
),
parcelles AS (
  SELECT
    osm_building_id,
    array_agg(DISTINCT scout_v5_id ORDER BY scout_v5_id) AS parcelle_scout_v5_ids,
    count(DISTINCT scout_v5_id) AS parcelle_count
  FROM flat
  GROUP BY osm_building_id
)
SELECT
  c.osm_building_id,
  c.code_insee,
  c.batiment_construction_id,
  c.geom,
  c.footprint_m2,
  c.matching_status,
  p.parcelle_scout_v5_ids,
  p.parcelle_count
FROM canonical c
JOIN parcelles p USING (osm_building_id);

-- Index UNIQUE requis pour REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS scout_matching_v5_buildings_mv_pk
  ON public.scout_matching_v5_buildings_mv (osm_building_id);

CREATE INDEX IF NOT EXISTS scout_matching_v5_buildings_mv_geom_gix
  ON public.scout_matching_v5_buildings_mv USING GIST (geom);

CREATE INDEX IF NOT EXISTS scout_matching_v5_buildings_mv_code_insee_idx
  ON public.scout_matching_v5_buildings_mv (code_insee);
