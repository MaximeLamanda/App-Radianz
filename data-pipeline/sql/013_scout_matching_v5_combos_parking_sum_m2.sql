-- Somme surfaces parking distinctes par combo (filtre Discovery).
-- Appliquer après 012 ; re-lancer build_discovery_combos par commune.

ALTER TABLE public.scout_matching_v5_combos
  ADD COLUMN IF NOT EXISTS parking_sum_m2 DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS scout_matching_v5_combos_parking_sum_m2_idx
  ON public.scout_matching_v5_combos (parking_sum_m2);

COMMENT ON COLUMN public.scout_matching_v5_combos.parking_sum_m2 IS
  'Somme parking_area_m2 des parkings distincts (osm_type:osm_id) liés au combo via buildings_json.';
