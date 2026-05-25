# Dérogation 400 m² — landuse commercial / industrial / retail

## Objectif

Conserver le plancher d’emprise **400 m²** pour le résidentiel et les autres zones, tout en **exportant** les petits bâtiments et parcelles situés sur des polygones OSM `landuse` **commercial**, **industrial** ou **retail**.

## Règle

Un bâtiment ou une parcelle passe le filtre si :

1. **Emprise cumulée** (parcelle) ou **emprise bâtiment** (SQL) **> seuil** (défaut 400 m²), **ou**
2. Au moins un bâtiment de la parcelle a `zone_source = "landuse"` et `zone_tag` ∈ {`commercial`, `industrial`, `retail`} (dérivé de l’intersection spatiale avec `osm_landuse_areas`, pas des tags `building` / `building:use` seuls).

## Deux barrières (pipeline)

| Étape | Fichier | Mécanisme |
|-------|---------|-----------|
| Entrée bâtiment | `fetch_osm_building_parcel_pairs` | `ST_Area >= min` **OR** `EXISTS` intersection landuse pro |
| Export parcelle | `compute_parcel_row_context_for_export` | `footprint_sum > min_required` **OR** dérogation landuse pro |

La dérogation parcelle s’applique uniquement au seuil standard (`min_default`, 400 m²), **pas** au seuil « partage » (`min_shared_candidate`, 500 m²).

## Cas limites

- **Chevauchement partiel** : `EXISTS` suffit.
- **Petit bâtiment en zone commerciale, tag résidentiel** : exporté si le polygone landuse pro domine dans `derive_zone_tag` (landuse prioritaire).
- **`building:use=commercial` sans polygone landuse** : pas de dérogation.
- **Prérequis** : table `osm_landuse_areas` peuplée pour le département.

## Hors périmètre

- Pas de changement obligatoire du slider Découverte (les données doivent être re-générées via `run_matching_v5.py --write-postgres`).
