-- Somme surfaces contour parcelle(s) par combo (filtre proportion empreinte / parcelle).
-- Appliquer après 013 ; re-lancer build_discovery_combos par commune.

ALTER TABLE public.scout_matching_v5_combos
  ADD COLUMN IF NOT EXISTS parcel_contour_sum_m2 DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS scout_matching_v5_combos_parcel_contour_sum_m2_idx
  ON public.scout_matching_v5_combos (parcel_contour_sum_m2);

COMMENT ON COLUMN public.scout_matching_v5_combos.parcel_contour_sum_m2 IS
  'Somme des aires contour parcelle(s) du combo (aligné parcelContourAreaM2FromV5Row / tiroir).';
