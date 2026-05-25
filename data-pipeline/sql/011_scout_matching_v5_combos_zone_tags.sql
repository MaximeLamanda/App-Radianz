-- Tags activité OSM agrégés par combo (filtre Discovery clusters + continuité MVT).
-- Appliquer après 010 ; re-lancer build_discovery_combos par commune.

ALTER TABLE public.scout_matching_v5_combos
  ADD COLUMN IF NOT EXISTS zone_tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS scout_matching_v5_combos_zone_tags_gin
  ON public.scout_matching_v5_combos USING GIN (zone_tags);
