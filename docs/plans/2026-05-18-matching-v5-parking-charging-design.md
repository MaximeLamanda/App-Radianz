# Matching V5 — parkings OSM et bornes de recharge

## Objectif

Enrichir le matching V5 avec :

1. **Polygones parking** OSM (`amenity=parking`, `leisure=parking`, `landuse=parking`) : surface totale, détail par parcelle cadastrale, lien au bâtiment via parcelle commune.
2. **Bornes de recharge** (`amenity=charging_station`) : rattachées aux parcelles communes bâtiment ↔ parking, affichées dans une section **Parking** du drawer (onglet Informations).

## Décisions validées

| Sujet | Choix |
|--------|--------|
| Approche | **Table dédiée** `osm_parking_areas` (pas d’extension `osm_landuse_areas`) |
| Tags OSM parking | `amenity=parking`, `leisure=parking`, `landuse=parking` |
| Lien bâtiment ↔ parking | Au moins une **parcelle cadastrale commune** (clés déjà produites par le matching OSM↔cadastre) |
| Surface | **Totale** (`parking_area_m2`) + **`parking_parcels_json`** (intersection par parcelle) |
| Bornes | Section drawer **Parking** ; points sur **parcelles communes** bâtiment ↔ parking (`ST_Within`) |
| Carte | Surbrillance cadastre **inchangée** (parcelles du bâtiment uniquement) ; couche parking au clic bâtiment |
| Hors périmètre v1 | Seuil 400 m², MVT tuiles parking, filtre Découverte « avec borne » |

## Modèle de données

### Table `public.osm_parking_areas`

Schéma calqué sur `osm_landuse_areas` :

- `osm_type` (`w` \| `r`), `osm_id`, `geom` (MultiPolygon 4326)
- `parking_tag` : clé source (`amenity` \| `leisure` \| `landuse`)
- `parking_value` : valeur tag (ex. `parking`)
- `tags` JSONB (sous-ensemble utile : `name`, `capacity`, `fee`, `access`, `surface`, …)
- Index GIST sur `geom`

Import : `import_osm_parking.py` sur le même `.osm.pbf` que buildings/landuse.  
Surcharge table : `OSM_PARKING_TABLE` (comme `OSM_LANDUSE_TABLE`).

### Jointures au matching

**Étape A — Parking ↔ parcelles** (commune, toutes parcelles intersectées) :

- `ST_Intersects(parking.geom, parcelle.geom)`
- `intersection_area_m2` = aire EPSG:2154 de l’intersection
- Agrégat par parking : `parking_area_m2` = `ST_Area(parking)` en 2154

**Étape B — Parking ↔ bâtiment** :

- Ensemble `P_b` = parcelles du bâtiment (paires OSM↔cadastre du run)
- Ensemble `P_p` = parcelles dans `parking_parcels_json`
- Lien si `P_b ∩ P_p ≠ ∅`
- **Parcelles communes** = `P_b ∩ P_p` (utilisées pour les bornes et l’affichage métier)

**Étape C — Bornes** :

- Depuis `osm_poi` où `tags->>'amenity' = 'charging_station'`
- `ST_Within(borne.geom, parcelle.geom)` pour chaque parcelle ∈ **parcelles communes**
- Normalisation via `normalize_osm_row_for_export` (libellé « Borne de recharge » déjà présent)
- Exclure `charging_station` du tableau POI commerce du drawer si doublon (filtrer dans merge POI côté TS)

### Export matching (`properties_json` / CSV)

Par entrée `buildings_json` (grain bâtiment dans la parcelle) :

```json
{
  "parkings_json": [
    {
      "osm_parking_type": "w",
      "osm_parking_id": 12345,
      "parking_tag": "amenity",
      "parking_value": "parking",
      "parking_name": "Parking visiteurs",
      "parking_area_m2": 1250.5,
      "parking_parcels_json": [
        {
          "code_insee": "33318",
          "section": "AB",
          "numero_norm": "0123",
          "intersection_area_m2": 400.2
        }
      ],
      "common_parcels_json": [
        { "section": "AB", "numero_norm": "0123" }
      ],
      "charging_stations_json": [
        {
          "osm_type": "n",
          "osm_id": 99,
          "name": "",
          "poi_type_label": "Borne de recharge",
          "capacity": "4",
          "lat": 44.84,
          "lng": -0.58,
          "osm_url": "https://www.openstreetmap.org/node/99"
        }
      ]
    }
  ]
}
```

**Géométries carte** : colonne `parking_geometries_json` (par ligne exportée, comme `building_geometries_json`) :

```json
[
  {
    "osm_parking_type": "w",
    "osm_parking_id": 12345,
    "geometry": { "type": "Polygon", "coordinates": [...] }
  }
]
```

Uniquement les parkings liés aux bâtiments de la ligne (pas tous les parkings de la commune).

## UI Découverte

### Carte

- Nouveau pane Leaflet `discoveryParkingHl` (entre cadastre et bâtiments MVT ou au-dessus cadastre).
- `GeoJSON` depuis `parking_geometries_json` des lignes `parcelleHighlightRows` + bâtiment sélectionné.
- Style : contour / remplissage distinct (ex. ambre semi-transparent).
- **Ne pas** ajouter les parcelles « parking-only » à `parcelleHighlightRows`.

### Drawer — onglet Informations

Section **Parking** (sous le bloc Building) :

- Si `parkings_json` vide : message « Aucun parking OSM associé ».
- Sinon pour chaque parking : surface totale, tableau parcelles (section, n°, m² intersection), liste bornes (type, capacité, lien OSM).
- Les bornes ne sont pas listées dans « POI à proximité » (Contact).

## Prérequis opérationnels

1. `npm run pipeline:osm-parking:schema` puis `pipeline:osm-parking:import`
2. Re-run `run_matching_v5.py --write-postgres` pour la commune / département
3. Refresh MV bâtiments si applicable (`scripts/refresh-matching-v5-buildings-mv.mjs`)

## Cas limites

- Parking sans parcelle commune avec le bâtiment : absent de `parkings_json` du bâtiment, mais toujours en base avec `parking_parcels_json` complet.
- Plusieurs parkings sur un bâtiment : tableau `parkings_json` multi-entrées.
- Bâtiment multi-parcelles : parcelles communes peuvent être un sous-ensemble des parcelles bâtiment.
- Table parking absente : matching continue (`--no-osm-parking` ou statut `skipped_no_table`).
- POI bornes hors parcelles communes : non exportées pour ce bâtiment.

## Tests

- Python : matcher parking↔parcelle, filtre parcelle commune, agrégation bornes.
- Vitest : parse `parkings_json`, `collectMatchingV5ParkingFeatures`, exclusion bornes du merge POI, pas d’élargissement `findMatchingV5ParcelleRowsForBuilding`.
