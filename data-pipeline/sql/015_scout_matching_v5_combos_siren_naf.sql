-- SIREN propriétaire (PPM) / domiciliation (sirets_json) et divisions NAF par combo (filtre Discovery).
-- Re-lancer build_discovery_combos par commune après application.

ALTER TABLE public.scout_matching_v5_combos
  ADD COLUMN IF NOT EXISTS owner_sirens TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS domiciliation_sirens TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS naf_divisions TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS scout_matching_v5_combos_owner_sirens_gin
  ON public.scout_matching_v5_combos USING GIN (owner_sirens);

CREATE INDEX IF NOT EXISTS scout_matching_v5_combos_domiciliation_sirens_gin
  ON public.scout_matching_v5_combos USING GIN (domiciliation_sirens);

CREATE INDEX IF NOT EXISTS scout_matching_v5_combos_naf_divisions_gin
  ON public.scout_matching_v5_combos USING GIN (naf_divisions);
