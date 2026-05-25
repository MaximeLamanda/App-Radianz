# Matching V5 — parkings OSM et bornes de recharge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Importer les polygones parking OSM, les rattacher aux bâtiments V5 par parcelle cadastrale commune, exporter surfaces + bornes, et les afficher en carte (sélection) et dans une section Parking du drawer Découverte.

**Architecture:** Table Postgres `osm_parking_areas` + module `osm_parking_v5.py` + jointures batch dans `run_matching_v5.py` ; champs `parkings_json` / `parking_geometries_json` dans l’export ; parsers TS + couche GeoJSON Découverte + section drawer. Design : [`2026-05-18-matching-v5-parking-charging-design.md`](./2026-05-18-matching-v5-parking-charging-design.md).

**Tech Stack:** Python 3.11, osmium, PostGIS, Vitest, React Leaflet, matching V5 existant (`osm_landuse_areas`, `osm_poi`).

---

### Task 1: Schéma SQL + helper table

**Files:**
- Create: `data-pipeline/sql/008_osm_parking_areas.sql`
- Create: `data-pipeline/matching_v5/osm_parking_v5.py`
- Create: `data-pipeline/python/tests/test_osm_parking_v5.py`

**Step 1: Write the failing test**

```python
# test_osm_parking_v5.py
def test_qualified_osm_parking_table_default():
    import os
    os.environ.pop("OSM_PARKING_TABLE", None)
    from osm_parking_v5 import qualified_osm_parking_table
    assert qualified_osm_parking_table() == '"public"."osm_parking_areas"'
```

**Step 2: Run test**

Run: `cd data-pipeline/python && .venv-v311/bin/python -m pytest tests/test_osm_parking_v5.py -v`  
Expected: FAIL (module missing)

**Step 3: Implement SQL + `osm_parking_v5.py`**

- Copier le pattern de `006_osm_landuse_areas.sql` avec colonnes `parking_tag`, `parking_value`.
- Exposer `qualified_osm_parking_table()`, `osm_parking_regclass()`, `DEFAULT_PARKING_TAGS` tuple `("amenity", "parking"), ("leisure", "parking"), ("landuse", "parking")`.

**Step 4: Run test — PASS**

---

### Task 2: Import PBF `import_osm_parking.py`

**Files:**
- Create: `data-pipeline/matching_v5/import_osm_parking.py`
- Create: `data-pipeline/python/tests/test_import_osm_parking_matchers.py`
- Modify: `package.json` (scripts `pipeline:osm-parking:schema`, `pipeline:osm-parking:import`)

**Step 1: Test matcher tags**

```python
def test_parking_matcher_amenity_leisure_landuse():
    from import_osm_parking import build_parking_matcher  # ou module dédié
    m = build_parking_matcher("")
    assert m({"amenity": "parking"}) == ("amenity", "parking")
    assert m({"leisure": "parking"}) == ("leisure", "parking")
    assert m({"landuse": "parking"}) is not None
    assert m({"amenity": "restaurant"}) is None
```

**Step 2: Implement handler** (calquer `import_osm_landuse.py` : ways/relations fermées, MultiPolygon 4326, `--ensure-schema`, `--truncate`).

**Step 3: Add npm scripts** (même pattern que `pipeline:osm-landuse:import`).

**Step 4: Manual smoke** (optionnel si PBF local) :

```bash
npm run pipeline:osm-parking:schema
npm run pipeline:osm-parking:import
```

---

### Task 3: Jointures parking + bornes (Python pur)

**Files:**
- Create: `data-pipeline/matching_v5/osm_parking_match_v5.py`
- Create: `data-pipeline/python/tests/test_osm_parking_match_v5.py`

**Step 1: Tests unitaires sans Postgres**

- `link_parkings_to_building_parcel_keys(building_parcels, parking_by_osm_id)` → filtre par intersection d’ensembles `(code_insee, section, numero_norm)`.
- `charging_stations_for_common_parcels(common_parcels, poi_rows)` → filtre `amenity=charging_station`.
- `build_parking_export_entry(...)` → dict avec `parking_area_m2`, `parking_parcels_json`, `common_parcels_json`, `charging_stations_json`.

**Step 2: Implement pure functions** (logique métier hors SQL pour tests rapides).

**Step 3: SQL helper** `fetch_parking_parcel_intersections(cur, code_insee, osm_parking_qualified)` retournant lignes `(osm_type, osm_id, section, numero_norm, intersection_area_m2, parking_area_m2, parking_tag, parking_value, tags)`.

**Step 4: SQL helper** `fetch_charging_stations_for_parcel_keys(cur, parcel_keys)` — réutiliser pattern `fetch_osm_pois_for_parcel_keys` mais filtre `amenity=charging_station` et clés parcelle limitées au set commun.

**Step 5: pytest PASS**

---

### Task 4: Intégration `run_matching_v5.py`

**Files:**
- Modify: `data-pipeline/matching_v5/run_matching_v5.py`
- Modify: `docs/MATCHING-V5.md`

**Step 1: Flags CLI**

- `--no-osm-parking` (désactive jointure + colonnes)
- Vérification `to_regclass(osm_parking_areas)` comme landuse

**Step 2: Après agrégation `bdetails` par parcelle**

- Charger intersections parking↔parcelle pour la commune
- Pour chaque bâtiment dans `bdetails_enriched`, calculer `parkings_json` via parcelles du bâtiment
- Remplir `parking_geometries_json` sur la ligne export (union parkings des bâtiments de la ligne)

**Step 3: Propager dans `buildings_json`** chaque entrée :

```python
item["parkings_json"] = [...]  # liste, peut être []
```

**Step 4: CSV / Postgres columns**

- Ajouter `parking_geometries_json` à la liste colonnes write-postgres (défaut `[]`)
- Documenter dans `MATCHING-V5.md` (prérequis import, champs, re-run)

**Step 5: Test d’intégration léger** (mock cur ou fixture SQL si dispo) dans `test_matching_v5_*` existant ou nouveau fichier.

---

### Task 5: Parse TypeScript + helpers carte

**Files:**
- Create: `lib/matching-v5-parking.ts`
- Create: `lib/matching-v5-parking.test.ts`
- Modify: `lib/scout-matching-v5-map.ts`
- Modify: `lib/scout-matching-v5-map.test.ts`

**Step 1: Types**

```typescript
export type V5ParkingParcelEntry = { section: string; numeroNorm: string; intersectionAreaM2?: number };
export type V5ParkingEntry = { osmParkingType: string; osmParkingId: number; parkingAreaM2?: number; ... };
```

**Step 2: `parseMatchingV5ParkingsJson(raw)`** depuis `buildings_json` item.

**Step 3: `parseMatchingV5ParkingGeometriesJson(raw)`** + `collectMatchingV5ParkingFeatures(rows)` → `GeoJSON.Feature[]`.

**Step 4: Étendre `V5BuildingsJsonEntry` avec `parkingsJson?: V5ParkingEntry[]` dans le parse existant.

**Step 5: Test : parcelleHighlightRows n’inclut pas parcelles parking-only** (régression sur `findMatchingV5ParcelleRowsForBuilding` inchangé).

**Step 6: `filterChargingStationsFromDiscoveryPois(pois)`** — exclure `poi_primary_value === 'charging_station'` du merge POI terrain.

**Step 7: Vitest PASS** — `npm test -- lib/matching-v5-parking.test.ts lib/scout-matching-v5-map.test.ts`

---

### Task 6: Carte Découverte — couche parking

**Files:**
- Modify: `app/discovery/page.tsx`
- Modify: `components/discovery/DiscoveryMapView.tsx`
- Modify: `app/globals.css` (optionnel — style parking)

**Step 1: `parkingHighlightFc` useMemo**

- `collectMatchingV5ParkingFeatures(parcelleHighlightRows)` + géométries du `selectedRow` si grain building

**Step 2: `DiscoveryMapView`**

- Pane `discoveryParkingHl` (z-index entre cadastre et bâtiments)
- `<GeoJSON data={parkingHighlightFc} pathOptions={{ color: '#f59e0b', fillOpacity: 0.25, weight: 2 }} />`
- Clé stable sur `selectedOsmBuildingId`

**Step 3: Vérifier** que `parcelleHighlightRows` reste `effectiveDiscoveryLinkedParcelleRows` sans modification.

---

### Task 7: Drawer — section Parking

**Files:**
- Create: `components/discovery/DiscoveryDrawerParkingSection.tsx`
- Modify: `components/solar-scout/ProspectDrawer.tsx`

**Step 1: Composant section**

- Props : `parkings: V5ParkingEntry[]`, `loading?: boolean`
- Affichage surface totale formatée (`formatSurfaceM2`)
- Tableau parcelles (section, n°, m²)
- Liste bornes (nom, capacité tag, lien OSM)
- État vide

**Step 2: Dans `TabsContent value="batiments"`** après bloc Building :

```tsx
<DiscoveryDrawerParkingSection parkings={discoveryParkingsForSelection} />
```

**Step 3: `useMemo discoveryParkingsForSelection`**

- Agréger `parseMatchingV5ParkingsJson` depuis `buildingDetailRows` / `selectedRow.buildingsJson` selon grain
- Dédupliquer par `(osmParkingType, osmParkingId)`

**Step 4: Filtrer bornes du merge POI** dans `discoveryMergedPois` useMemo.

---

### Task 8: Documentation pipeline + README

**Files:**
- Modify: `data-pipeline/matching/README.md`
- Modify: `docs/MATCHING-V5.md`

**Step 1:** Section import parking (scripts npm, tags, ordre : buildings → landuse → **parking** → matching).

**Step 2:** Champs export `parkings_json`, `parking_geometries_json`, règle parcelle commune.

---

### Task 9: Vérification bout en bout

**Step 1: Tests automatisés**

```bash
npm test -- lib/matching-v5-parking.test.ts
cd data-pipeline/python && .venv-v311/bin/python -m pytest tests/test_osm_parking_v5.py tests/test_osm_parking_match_v5.py tests/test_import_osm_parking_matchers.py -v
```

**Step 2: Pipeline locale** (commune test `33318` si données dispo)

```bash
npm run pipeline:osm-parking:import
# run matching v5 write-postgres pour 33318
npm run dev
```

**Step 3: Manuel Découverte**

- Sélectionner un bâtiment avec parking OSM connu
- Carte : polygone parking visible, cadastre = parcelles bâtiment seulement
- Drawer Informations : section Parking avec m² + bornes si présentes
- Onglet Contact : pas de doublon « Borne de recharge » dans POI commerce

---

## Ordre d’exécution recommandé

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

## Commits suggérés (si l’utilisateur demande des commits)

1. `feat(pipeline): osm_parking_areas schema and import`
2. `feat(matching-v5): parking and charging station export`
3. `feat(discovery): parking map layer and drawer section`
