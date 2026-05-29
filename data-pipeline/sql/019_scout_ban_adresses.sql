-- Base Adresse Nationale (BAN) — géocodage inverse local pour matching V5.
-- Import : data-pipeline/matching_v5/import_ban_adresses.py
-- Postgres local uniquement (pas de sync Neon prévue).

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS public.scout_ban_adresses (
  ban_id text PRIMARY KEY,
  numero text NOT NULL DEFAULT '',
  rep text NOT NULL DEFAULT '',
  nom_voie text NOT NULL DEFAULT '',
  code_postal char(5),
  code_insee char(5) NOT NULL,
  nom_commune text,
  lon double precision NOT NULL,
  lat double precision NOT NULL,
  geom geometry(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(lon, lat), 4326)
  ) STORED,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scout_ban_adresses_geom_gix
  ON public.scout_ban_adresses USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_scout_ban_adresses_code_insee
  ON public.scout_ban_adresses (code_insee);

-- Table UNLOGGED pour import COPY rapide (vidée après fusion).
DROP TABLE IF EXISTS public.scout_ban_adresses_staging;
CREATE UNLOGGED TABLE public.scout_ban_adresses_staging (
  ban_id text NOT NULL,
  numero text NOT NULL DEFAULT '',
  rep text NOT NULL DEFAULT '',
  nom_voie text NOT NULL DEFAULT '',
  code_postal char(5),
  code_insee char(5) NOT NULL,
  nom_commune text,
  lon double precision NOT NULL,
  lat double precision NOT NULL
);
