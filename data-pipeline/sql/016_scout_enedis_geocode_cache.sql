-- Cache géocodage adresses Enedis (Géoplateforme) pour la couche Discovery.
-- Appliquer sur Neon / Postgres local : psql "$DATABASE_URL" -f data-pipeline/sql/016_scout_enedis_geocode_cache.sql

CREATE TABLE IF NOT EXISTS public.scout_enedis_geocode_cache (
  address_key text NOT NULL,
  code_commune char(5) NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  geocode_score real NOT NULL,
  geocode_label text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (address_key, code_commune)
);

CREATE INDEX IF NOT EXISTS idx_scout_enedis_geocode_cache_updated
  ON public.scout_enedis_geocode_cache (updated_at DESC);
