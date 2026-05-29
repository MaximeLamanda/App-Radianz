-- Ajoute le statut de match pour conserver les parcelles cadastre sans bâtiment.
-- Idempotent.

ALTER TABLE public.scout_matching_v5_features
  ADD COLUMN IF NOT EXISTS match_status TEXT NOT NULL DEFAULT 'matched';

CREATE INDEX IF NOT EXISTS scout_matching_v5_features_match_status_idx
  ON public.scout_matching_v5_features (match_status);

ALTER TABLE public.scout_matching_v5_features
  DROP CONSTRAINT IF EXISTS scout_matching_v5_features_match_status_check;

ALTER TABLE public.scout_matching_v5_features
  ADD CONSTRAINT scout_matching_v5_features_match_status_check
  CHECK (match_status IN ('matched', 'cadastre_only'));
