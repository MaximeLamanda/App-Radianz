# Sources de données (datasource/)

Ce dossier est la **référence prioritaire** des fichiers lourds et des chemins d’import (cadastre, BDNB, OSM, SIRENE, PPM). Quand une source change (fichier, table DB, URL), mettre à jour **ce README** en premier.

Pour la **vue métier** des entrées / sorties du matching (sans chemins techniques), voir aussi [`../export/matching/matching.md`](../export/matching/matching.md) et [`../docs/MATCHING-V5.md`](../docs/MATCHING-V5.md).

## Arborescence

| Dossier | Rôle |
|---------|------|
| `datasource/osm/` | Extraits `.osm.pbf` (ex. région) |
| `datasource/bdnb/` | Archives CSV BDNB, zip, métadonnées temporaires d’import |
| `datasource/cadastre/` | GeoJSON cadastre gzip (imports locaux) |
| `datasource/parcelles-personnes-morales/` | Parquet PPM (passerelle parcelles ↔ personnes morales) |
| `datasource/Siren/` | Fichiers stock établissement / SIRENE (CSV, etc.) |
| `datasource/exports/` | Sorties miroir optionnelles (à créer si besoin) |

## 1) OSM

- **PBF** (exemple dépôt) : `datasource/osm/aquitaine-260406.osm.pbf`
- **Parquet POI** (extrait pipeline, généré) : `data-pipeline/python/out/osm_poi_pessac_bbox.parquet`
- Extraction bbox : voir `data-pipeline/README.md` (commande `scout_pipeline.osm_poi_extract`)

## 2) BDNB

- **Table canonique** : `public.bdnb_buildings` (import via `npm run import:bdnb-dep33`, etc.)
- **Fichiers locaux** : `datasource/bdnb/dep33_csv.zip`, extrait sous `datasource/bdnb/dep33_extract/csv/` si présent
- **Métadonnées import** (optionnel) : `datasource/bdnb/tmp_dep33_csv_metadata.yml`

## 3) Cadastre

- **GeoJSON gzip** (exemple Pessac / dep 33) : `datasource/cadastre/cadastre-33-parcelles.json.gz`
- **Table** : `public.cadastre_france_feuilles_geom`
- Import : `npm run import:cadastre-33-parcelles:pessac`

## 4) Parcelles personnes morales (PPM)

- **Parquet** : `datasource/parcelles-personnes-morales/parcelles-personnes-morales-latest.parquet`
- **Table** : `public.parcelles_personnes_morales`
- Import : `npm run import:parcelles-pessac`

## 5) Référentiels / APIs (hors dossier)

- BAN reverse : `https://api-adresse.data.gouv.fr/reverse/`
- Recherche entreprises : `https://recherche-entreprises.api.gouv.fr/search`
- Google Places (fallback) : Nearby Search + Place Details

## 6) Sorties matching

- CSV V5 : `data-pipeline/out/matching/v5/matching_v5.csv`
- GeoJSON V5 (ex. Pessac) : `public/geo/matching-v5-33318.geojson` (généré par `npm run pipeline:matching-v5:run`)

## Paramètres de zone (Pessac par défaut)

- `BBOX_MIN_LON`: `-0.67`
- `BBOX_MIN_LAT`: `44.78`
- `BBOX_MAX_LON`: `-0.55`
- `BBOX_MAX_LAT`: `44.84`

## Checklist opérationnelle

- [ ] Fichiers volumineux présents sous `datasource/` (OSM, cadastre, parquet PPM, BDNB…)
- [ ] Chemins ci-dessus alignés avec la machine / CI
- [ ] Tables DB cibles confirmées
- [ ] Extract OSM parquet généré si besoin pipeline
- [ ] Sorties V5 (CSV + GeoJSON) si besoin carte Match V5
