-- Discovery — agrégats par combo (partage parcelles), filtre surface SQL.
-- Appliquer après 003_scout_matching_v5_features.sql et 007_scout_matching_v5_buildings_mv.sql.
-- Remplie par : python -m data-pipeline.matching_v5.build_discovery_combos --code-insee=…

CREATE TABLE IF NOT EXISTS public.scout_matching_v5_combos (
  combo_id TEXT PRIMARY KEY,
  code_insee TEXT NOT NULL,
  anchor_parcelle_id TEXT NOT NULL,
  parcelle_scout_v5_ids TEXT[] NOT NULL DEFAULT '{}',
  osm_building_ids TEXT[] NOT NULL DEFAULT '{}',
  footprint_sum_m2 DOUBLE PRECISION NOT NULL DEFAULT 0,
  has_landuse_waiver BOOLEAN NOT NULL DEFAULT FALSE,
  geom geometry(Point, 4326) NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scout_matching_v5_combos_geom_gix
  ON public.scout_matching_v5_combos USING GIST (geom);

CREATE INDEX IF NOT EXISTS scout_matching_v5_combos_code_insee_idx
  ON public.scout_matching_v5_combos (code_insee);

CREATE INDEX IF NOT EXISTS scout_matching_v5_combos_footprint_sum_m2_idx
  ON public.scout_matching_v5_combos (footprint_sum_m2);
