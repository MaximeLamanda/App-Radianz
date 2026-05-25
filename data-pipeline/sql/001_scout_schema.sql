-- Schéma pipeline leads (SIRENE → BDNB → POI) — local ou Neon.
-- PostGIS requis (CREATE EXTENSION postgis).

CREATE EXTENSION IF NOT EXISTS postgis;

-- Table canonique BDNB (remplit scripts/import-bdnb-postgres.mjs, nom via BDNB_BUILDINGS_TABLE).
-- Cette définition sert de référence ; l’import crée la table via CREATE TABLE AS.

-- Leads consolidés (un enregistrement par batiment_groupe_id après dédoublonnage effectif max).
CREATE TABLE IF NOT EXISTS public.scout_leads (
  lead_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batiment_groupe_id TEXT NOT NULL UNIQUE,
  siren TEXT,
  siret TEXT NOT NULL,
  denomination TEXT,
  activite_principale TEXT,
  tranche_effectifs TEXT,
  effectif_score SMALLINT,
  geom_wgs84 geometry(Point, 4326),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  code_commune_insee TEXT,
  poi_json JSONB,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scout_leads_geom_gix ON public.scout_leads USING GIST (geom_wgs84);
CREATE INDEX IF NOT EXISTS scout_leads_siret_idx ON public.scout_leads (siret);
CREATE INDEX IF NOT EXISTS scout_leads_siren_idx ON public.scout_leads (siren);

-- Passerelle parcelles -> personnes morales (source typique: datasource/parcelles-personnes-morales/*.parquet).
CREATE TABLE IF NOT EXISTS public.parcelles_personnes_morales (
  code_insee TEXT,
  nom_commune TEXT,
  numero_siren TEXT,
  denomination TEXT,
  forme_juridique_libelle TEXT,
  numero_voirie TEXT,
  indice_repetition TEXT,
  nature_voie TEXT,
  nom_voie TEXT,
  numero_parcelle TEXT,
  section TEXT,
  millesime TEXT
);

CREATE INDEX IF NOT EXISTS ppm_code_insee_idx ON public.parcelles_personnes_morales (code_insee);
CREATE INDEX IF NOT EXISTS ppm_siren_idx ON public.parcelles_personnes_morales (numero_siren);

-- Géométries cadastrales (source: cadastre-france-feuilles.json.gz).
-- Cette table permet de ne plus dépendre des appels IGN pour l'affichage des polygones.
CREATE TABLE IF NOT EXISTS public.cadastre_france_feuilles_geom (
  source_id TEXT,
  code_insee TEXT,
  section TEXT,
  numero TEXT,
  numero_norm TEXT,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  properties JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cadastre_ff_unique_parcelle_idx
  ON public.cadastre_france_feuilles_geom (code_insee, section, numero_norm);
CREATE INDEX IF NOT EXISTS cadastre_ff_code_insee_idx
  ON public.cadastre_france_feuilles_geom (code_insee);
CREATE INDEX IF NOT EXISTS cadastre_ff_geom_gix
  ON public.cadastre_france_feuilles_geom USING GIST (geom);

-- Référentiel établissements (dump dédié) pour matching V5 adresse Passerelle -> SIRENE.
CREATE TABLE IF NOT EXISTS public.scout_etablissements (
  siret TEXT PRIMARY KEY,
  siren TEXT NOT NULL,
  denomination TEXT,
  etat_administratif TEXT,
  date_debut TEXT,
  numero_voie TEXT,
  indice_repetition TEXT,
  type_voie TEXT,
  libelle_voie TEXT,
  code_postal TEXT,
  commune TEXT,
  code_commune_insee TEXT,
  numero_norm TEXT,
  voie_norm TEXT,
  commune_norm TEXT,
  address_norm TEXT,
  tranche_effectifs TEXT,
  annee_effectifs TEXT,
  activite_principale TEXT,
  source TEXT NOT NULL DEFAULT 'sirene',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.scout_etablissements ADD COLUMN IF NOT EXISTS tranche_effectifs TEXT;
ALTER TABLE public.scout_etablissements ADD COLUMN IF NOT EXISTS annee_effectifs TEXT;
ALTER TABLE public.scout_etablissements ADD COLUMN IF NOT EXISTS activite_principale TEXT;

CREATE INDEX IF NOT EXISTS scout_etab_siren_idx
  ON public.scout_etablissements (siren);
CREATE INDEX IF NOT EXISTS scout_etab_code_insee_idx
  ON public.scout_etablissements (code_commune_insee);
CREATE INDEX IF NOT EXISTS scout_etab_address_norm_idx
  ON public.scout_etablissements (address_norm);
CREATE INDEX IF NOT EXISTS scout_etab_voie_commune_idx
  ON public.scout_etablissements (voie_norm, commune_norm);
CREATE INDEX IF NOT EXISTS scout_etab_num_voie_idx
  ON public.scout_etablissements (numero_norm, voie_norm);

-- Communes couvertes par la boîte leads : ajouter des lignes ici (INSERT), pas de vue par commune.
CREATE TABLE IF NOT EXISTS public.scout_leads_communes (
  code_insee TEXT PRIMARY KEY CHECK (code_insee ~ '^\d{5}$')
);

INSERT INTO public.scout_leads_communes (code_insee) VALUES ('33318'), ('33522'), ('33192')
ON CONFLICT (code_insee) DO NOTHING;

-- Vue enrichie : leads dont la commune est dans scout_leads_communes + agrégation PPM sur ce même périmètre.
CREATE OR REPLACE VIEW public.scout_leads_enriched AS
WITH territoire AS (
  SELECT code_insee FROM public.scout_leads_communes
),
ppm_agg AS (
  SELECT
    ppm.numero_siren,
    MAX(NULLIF(ppm.denomination, '')) AS company_legal_name,
    MAX(NULLIF(ppm.forme_juridique_libelle, '')) AS company_legal_form,
    STRING_AGG(
      DISTINCT NULLIF(TRIM(CONCAT_WS(' ', ppm.numero_voirie, ppm.indice_repetition, ppm.nature_voie, ppm.nom_voie)), ''),
      ' | '
    ) AS company_address,
    COUNT(*)::int AS parcelles_count,
    MAX(ppm.code_insee) AS code_insee
  FROM public.parcelles_personnes_morales ppm
  WHERE ppm.code_insee IN (SELECT code_insee FROM territoire)
  GROUP BY ppm.numero_siren
)
SELECT
  l.lead_id,
  l.batiment_groupe_id,
  l.siren,
  l.siret,
  l.denomination,
  l.activite_principale,
  l.tranche_effectifs,
  l.effectif_score,
  l.geom_wgs84,
  l.lat,
  l.lng,
  l.poi_json,
  l.created_at,
  COALESCE(p.code_insee, l.code_commune_insee) AS code_insee,
  p.company_legal_name,
  p.company_legal_form,
  p.company_address,
  COALESCE(p.parcelles_count, 0) AS parcelles_count
FROM public.scout_leads l
LEFT JOIN ppm_agg p ON p.numero_siren = l.siren
WHERE l.code_commune_insee IN (SELECT code_insee FROM territoire);

DROP VIEW IF EXISTS public.scout_leads_pessac_enriched;
