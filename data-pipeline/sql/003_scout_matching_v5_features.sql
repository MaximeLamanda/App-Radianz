-- Matching V5 discovery — entités exportées (parcelle / building) pour Solar Scout via Postgres.
-- PostGIS requis. Appliquer après 001_scout_schema.sql sur la même instance que le pipeline V5.

CREATE TABLE IF NOT EXISTS public.scout_matching_v5_features (
  scout_v5_id TEXT PRIMARY KEY,
  geom geometry(Geometry, 4326) NOT NULL,
  grain TEXT NOT NULL,
  code_insee TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT '',
  numero_norm TEXT NOT NULL DEFAULT '',
  nb_batiments INTEGER NOT NULL DEFAULT 0,
  footprint_sum_m2 DOUBLE PRECISION NOT NULL DEFAULT 0,
  siret_count INTEGER NOT NULL DEFAULT 0,
  status_technique TEXT NOT NULL DEFAULT '',
  status_metier TEXT NOT NULL DEFAULT '',
  matching_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  siren_status TEXT NOT NULL DEFAULT '',
  properties_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_run TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scout_matching_v5_features_geom_gix
  ON public.scout_matching_v5_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS scout_matching_v5_features_code_insee_idx
  ON public.scout_matching_v5_features (code_insee);
CREATE INDEX IF NOT EXISTS scout_matching_v5_features_code_insee_grain_idx
  ON public.scout_matching_v5_features (code_insee, grain);
