# Matching Solar Scout — PostgreSQL + V5

Documentation minimale : **Postgres / PostGIS** pour le pipeline et les emprises ; le **matching V5** (parcelles × bâtiments × SIRENE, export CSV + GeoJSON) est décrit dans [`../../docs/MATCHING-V5.md`](../../docs/MATCHING-V5.md).

Les schémas SQL sont dans [`../sql/`](../sql/). Les sorties V5 vont sous [`../out/matching/v5/`](../out/matching/v5/) (fichiers générés **non versionnés** ; seul `.gitkeep` peut être suivi).

## PostgreSQL (PostGIS)

| Objet | Usage |
|-------|--------|
| `public.bdnb_buildings` | BDNB importé (CSV). |
| `public.bdnb_pessac_geom_raw` | Emprises brutes **33318** (API bbox carte). |
| `public.bdnb_talence_geom_raw` | Emprises brutes **33522**. |
| `public.scout_bdnb_poi_sample` | Échantillon pipeline en table (`SCOUT_BDNB_POI_SAMPLE_SOURCE=postgres`). |
| `public.scout_leads` | Leads consolidés (ETL SIRENE → BDNB). |
| `public.parcelles_personnes_morales` | Parcelles → SIREN. |
| `public.cadastre_france_feuilles_geom` | Parcelles cadastrales locales. |
| `public.scout_leads_communes` | INSEE actifs pour la Lead Inbox (INSERT pour ajouter une commune). |
| `public.scout_leads_enriched` | Vue leads enrichis (PPM + périmètre `scout_leads_communes`). |
| `public.scout_matching_v5_features` | Résultats discovery V5 (GeoJSON équivalent en table ; rempli avec `run_matching_v5.py --write-postgres`). |

Fichiers : [`../sql/001_scout_schema.sql`](../sql/001_scout_schema.sql), [`../sql/002_scout_bdnb_poi_sample.sql`](../sql/002_scout_bdnb_poi_sample.sql), [`../sql/003_scout_matching_v5_features.sql`](../sql/003_scout_matching_v5_features.sql).

## Matching V5 (fichiers)

- Script : `data-pipeline/matching_v5/run_matching_v5.py`
- Commande npm : `npm run pipeline:matching-v5:run` (voir [`MATCHING-V5.md`](../../docs/MATCHING-V5.md))

## Variables utiles

`DATABASE_URL` / `LOCAL_DATABASE_URL`, `BDNB_BUILDINGS_TABLE`, `SCOUT_BDNB_POI_SAMPLE_SOURCE`, `SCOUT_BDNB_POI_SAMPLE_GEOJSON`, `SCOUT_MATCHING_V5_TABLE` (côté app : `GET /api/matching-v5/features` ; côté pipeline : lecture env pour `--write-postgres`).

Solar Scout (client) : `NEXT_PUBLIC_SCOUT_MATCHING_V5_SOURCE=postgres`, `NEXT_PUBLIC_SCOUT_MATCHING_V5_CODE_INSEE`, ou `?discovery=db` — voir [`../../docs/MATCHING-V5.md`](../../docs/MATCHING-V5.md).

Détails pipeline : [README principal](../README.md).
