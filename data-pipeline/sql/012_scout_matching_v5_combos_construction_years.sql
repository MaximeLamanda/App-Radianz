-- Années de construction connues par combo (filtre Discovery + continuité MVT).
-- Re-lancer build_discovery_combos par commune après application.

ALTER TABLE public.scout_matching_v5_combos
  ADD COLUMN IF NOT EXISTS construction_years INTEGER[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS scout_matching_v5_combos_construction_years_gin
  ON public.scout_matching_v5_combos USING GIN (construction_years);
