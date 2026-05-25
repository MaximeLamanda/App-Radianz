-- Consommation électricité entreprise Enedis (open data) — points géocodés pour Discovery.
-- Import : data-pipeline/matching_v5/import_enedis_consumption.py
-- PostGIS requis.

CREATE TABLE IF NOT EXISTS public.scout_enedis_consumption_sites (
  site_id TEXT NOT NULL,
  code_commune CHAR(5) NOT NULL,
  annee SMALLINT NOT NULL,
  mwh DOUBLE PRECISION NOT NULL,
  adresse_label TEXT NOT NULL,
  code_secteur_naf2 TEXT,
  code_grand_secteur TEXT,
  nombre_de_sites INTEGER NOT NULL DEFAULT 1,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  geom geometry(Point, 4326),
  geocode_score REAL,
  geocode_status TEXT NOT NULL DEFAULT 'skipped',
  geocode_label TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id),
  CONSTRAINT scout_enedis_consumption_sites_geocode_status_chk
    CHECK (geocode_status IN ('ok', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS scout_enedis_consumption_sites_geom_gix
  ON public.scout_enedis_consumption_sites USING GIST (geom);

CREATE INDEX IF NOT EXISTS scout_enedis_consumption_sites_commune_annee_mwh_idx
  ON public.scout_enedis_consumption_sites (code_commune, annee, mwh);

CREATE INDEX IF NOT EXISTS scout_enedis_consumption_sites_annee_idx
  ON public.scout_enedis_consumption_sites (annee);

CREATE INDEX IF NOT EXISTS scout_enedis_consumption_sites_geocode_status_idx
  ON public.scout_enedis_consumption_sites (geocode_status)
  WHERE geocode_status = 'ok';

COMMENT ON TABLE public.scout_enedis_consumption_sites IS
  'Consommation annuelle entreprise Enedis par adresse (géocodage Géoplateforme, couche Discovery)';
