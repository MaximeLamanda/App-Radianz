# Discovery — filtre surface combo via table SQL (B1)

## Contexte

Le filtre « Surface building » sur Découverte doit refléter la **somme d’empreintes OSM du combo** (comme le tiroir : `footprintSumTotalFromV5`, déduplication par `batiment_construction_id`, dérogation landuse commercial / industrial / retail).

L’implémentation client actuelle recalcule cette somme pour **chaque combo** à chaque mouvement de slider (`parcelleRowsForComboId` reconstruit l’index partage en boucle). Avec des milliers de combos dans le viewport, l’UI devient inutilisable.

## Décision

**Approche B1 (validée)** : pré-agréger en Postgres **une ligne par combo**, filtrer en SQL, exposer un endpoint overview dédié. Le client n’agrège plus ni ne recalcule les empreintes pour le filtre surface.

## Objectifs

- Filtre surface **identique au tiroir** (somme dédupliquée + waiver landuse).
- Slider réactif : coût côté client = parse GeoJSON + rendu carte (pas de O(combos × parcelles)).
- Requête overview : `WHERE footprint_sum_m2` indexé + bbox GIST.

## Non-objectifs (v1)

- Pas de changement du pipeline matching (règles export 400 m²).
- Pas de remplacement de la couche MVT bâtiments au zoom détail.
- Pas de stats activité OSM pré-agrégées par combo (rester sur `matchingV5Rows` viewport pour le panneau filtres).

## Modèle de données

### Table `public.scout_matching_v5_combos`

| Colonne | Type | Description |
|---------|------|-------------|
| `combo_id` | `TEXT PK` | `combo:` + `scout_v5_id` parcelles triés (`\|`) |
| `code_insee` | `TEXT` | Commune (filtre import / requêtes) |
| `anchor_parcelle_id` | `TEXT` | Première parcelle après tri cadastral (tiroir) |
| `parcelle_scout_v5_ids` | `TEXT[]` | Parcelles du combo |
| `osm_building_ids` | `TEXT[]` | Bâtiments OSM du combo (overview + MVT whitelist) |
| `footprint_sum_m2` | `DOUBLE PRECISION` | Σ empreintes dédupliquée BC (alignée tiroir) |
| `has_landuse_waiver` | `BOOLEAN` | Au moins un bâtiment avec dérogation landuse pro |
| `geom` | `geometry(Point, 4326)` | Centroïde (moyenne des centroïdes bâtiments OSM du combo, ou centroïde parcelle) |
| `imported_at` | `TIMESTAMPTZ` | Horodatage du dernier build |

Index :

- `PRIMARY KEY (combo_id)`
- `GIST (geom)`
- `(code_insee)`
- `(footprint_sum_m2)` — filtre slider

Refresh : **DELETE par `code_insee` + INSERT** (comme `scout_matching_v5_features`), pas une MV lourde sur tout le France.

## Pipeline

### Script `data-pipeline/matching_v5/build_discovery_combos.py`

Entrée : parcelles `scout_matching_v5_features` pour un `code_insee` (ou liste INSEE département).

Algorithme (miroir TypeScript) :

1. **Composantes connexes partage** : même règle que `buildParcelleComboIndex` (`matching_status === "partage"` sur `batiment_construction_id`).
2. **`combo_id`** : `combo:` + ids parcelles triés.
3. **`footprint_sum_m2`** : pour chaque combo, dédupliquer les entrées `buildings_json` par `batiment_construction_id`, sommer `footprint_m2` > 0 ; repli `SUM(footprint_sum_m2)` parcelles si pas de `buildings_json` parseable (comme `footprintSumM2DedupedFromParcelleCluster` → null → reduce).
4. **`has_landuse_waiver`** : `zone_source == "landuse"` et `zone_tag` ∈ {commercial, industrial, retail} sur au moins une entrée bâtiment du combo.
5. **`osm_building_ids`** : union des ids valides depuis `building_geometries_json` + `buildings_json` des parcelles du combo.
6. **`geom`** : moyenne des `ST_PointOnSurface` des lignes `scout_matching_v5_buildings_mv` pour les `osm_building_id` du combo ; sinon centroïde géométrie parcelle ancre.

Chaînage documenté :

```text
run_matching_v5.py --write-postgres --code-insee=…
  → scripts/refresh-matching-v5-buildings-mv.mjs
  → python -m data-pipeline.matching_v5.build_discovery_combos --code-insee=…
```

### Tests Python

- 2 parcelles partage, BC partagé 551 + 133 → `footprint_sum_m2 = 684` (pas 1235).
- Waiver industrial, somme < 400 → `has_landuse_waiver = true`, combo exporté.
- Parcelle isolée → `combo_id = combo:<id>`.

## API

### `GET /api/matching-v5/combos-overview`

Paramètres :

- Bbox : `minLat`, `maxLat`, `minLng`, `maxLng` (obligatoire, comme buildings-overview).
- `minFootprintM2`, `maxFootprintM2` (optionnels — filtre SQL ; `max` au plafond UI = borne haute ouverte).
- `limit` (défaut ~20k, plafond 35k).

Réponse : `FeatureCollection` Point, propriétés :

- `combo_id`, `footprint_sum_m2`, `has_landuse_waiver`
- `anchor_parcelle_id`, `parcelle_scout_v5_ids`, `osm_building_ids`

Requête type :

```sql
SELECT combo_id, footprint_sum_m2, …
FROM scout_matching_v5_combos
WHERE geom && envelope
  AND ST_Intersects(geom, envelope)
  AND footprint_sum_m2 > $min  -- si min > 0 et pas (waiver OR sum > min) : voir ci-dessous
```

**Filtre min avec waiver** (aligné `rowMeetsDiscoverySurfaceMinM2`) :

```sql
AND (
  $min <= 0
  OR footprint_sum_m2 > $min
  OR has_landuse_waiver = TRUE
)
AND (
  $max >= 50000 OR footprint_sum_m2 <= $max
)
```

## Client Discovery

| Avant | Après |
|-------|--------|
| Fetch `buildings-overview` + `buildDiscoveryComboMarkers` + `filterDiscoveryComboMarkersBySurface` | Fetch `combos-overview` avec `minFootprintM2` / `maxFootprintM2` |
| Recalcul index à chaque slider | Refetch debouncé (150 ms) — SQL filtre |
| `osmActivityOptions` rebuild tous les combos | Inchangé v1 : tags depuis `matchingV5Rows` (léger) |

Fichiers :

- `lib/discovery-combos-overview.ts` — types + parse FC (comme `discovery-buildings-mv.ts`).
- `app/discovery/page.tsx` — effet fetch combos-overview ; `comboMarkers` mappés depuis la réponse.
- Conserver `lib/discovery-combo-markers.ts` pour clic MVT / `findComboAnchorForOsmBuilding` (sans filtre surface lourd).
- Supprimer / déprécier le chemin `filterDiscoveryComboMarkersBySurface` sur le hot path carte.

Whitelist MVT : `osm_building_ids` des combos retournés par l’API (déjà filtrés).

## Cohérence tiroir

- Au clic, le tiroir continue `footprintSumTotalFromV5` côté client.
- Test de non-régression : échantillon de combos en base vs calcul TS sur les mêmes parcelles (`footprint_sum_m2` écart < 0.01).

## Risques et mitigations

| Risque | Mitigation |
|--------|------------|
| Table pas à jour après matching | Doc procédure + script npm `pipeline:matching-v5:combos` |
| Centroïde combo décalé | Acceptable v1 ; raffiner avec MV bâtiments |
| Overview sans rows features (features lentes) | Combos ont `anchor_parcelle_id` + ids ; sélection sans refetch parcelles si possible |

## Références

- [`docs/plans/2026-05-20-discovery-combo-clusters-design.md`](2026-05-20-discovery-combo-clusters-design.md)
- [`lib/matching-v5-to-prospect.ts`](../lib/matching-v5-to-prospect.ts) — `footprintSumTotalFromV5`
- [`lib/discovery-footprint-landuse-waiver.ts`](../lib/discovery-footprint-landuse-waiver.ts)
- [`data-pipeline/sql/007_scout_matching_v5_buildings_mv.sql`](../data-pipeline/sql/007_scout_matching_v5_buildings_mv.sql)
