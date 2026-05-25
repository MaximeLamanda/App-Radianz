# Discovery — filtre surface parking combo via table SQL

## Contexte

Le filtre « Surface building » sur Découverte s’appuie sur `scout_matching_v5_combos.footprint_sum_m2` et `GET /api/matching-v5/combos-overview`. Les parkings sont déjà exportés par bâtiment dans `parkings_json` (`parking_area_m2`), affichés dans le tiroir (`DiscoveryDrawerParkingSection`).

Le design parking V1 ([`2026-05-18-matching-v5-parking-charging-design.md`](2026-05-18-matching-v5-parking-charging-design.md)) excluait le filtre Découverte. Avec des milliers de combos dans le viewport, un filtre client sur `parkings_json` recréerait le problème de perf résolu pour l’empreinte building.

## Décision validée

**Approche B1** (miroir empreinte building) : pré-agréger **`parking_sum_m2`** par combo en Postgres, filtrer en SQL, refetch debouncé côté client.

**Métrique (choix utilisateur A)** : somme des `parking_area_m2` des parkings **distincts** liés au combo (clé `osm_parking_type:osm_parking_id`), alignée sur `collectParkingsFromMatchingRows` (`lib/matching-v5-parking.ts`).

## Objectifs

- Slider « Surface parking » réactif (pas d’agrégation client sur chaque combo).
- Règle identique au tiroir : même parking sur plusieurs bâtiments du combo → compté une fois.
- Whitelist MVT = `osm_building_ids` des combos retournés par l’API (comme aujourd’hui).

## Non-objectifs (v1)

- Pas de dérogation landuse sur le parking (réservée à l’empreinte building).
- Pas de filtre « avec borne », tuiles MVT parking, toggle « au moins un parking ».
- Pas de changement du pipeline matching / import OSM-ENR.

## Modèle de données

### Colonne sur `public.scout_matching_v5_combos`

| Colonne | Type | Description |
|---------|------|-------------|
| `parking_sum_m2` | `DOUBLE PRECISION NOT NULL DEFAULT 0` | Σ `parking_area_m2` des parkings distincts du combo |

Index : `(parking_sum_m2)` btree — filtre slider.

Migration : `data-pipeline/sql/013_scout_matching_v5_combos_parking_sum_m2.sql`.

## Pipeline

### `discovery_combos_v5.combo_parking_sum_m2(parcelle_rows)`

Pour chaque parcelle du combo → `parse_buildings_json` → `parkings_json` :

1. Clé `f"{osm_parking_type}:{osm_parking_id}"` (défaut type `w`).
2. Ignorer entrées sans id valide ou `parking_area_m2` ≤ 0.
3. Sommer les aires des clés non vues.

Inclus dans `build_combo_records_for_commune` → champ `parking_sum_m2`.

### `build_discovery_combos.py`

- `INSERT` inclut `parking_sum_m2`.
- Rebuild par commune inchangé (DELETE + INSERT par `code_insee`).

Chaînement :

```text
run_matching_v5.py --write-postgres --code-insee=…
  → scripts/refresh-matching-v5-buildings-mv.mjs
  → python -m data-pipeline.matching_v5.build_discovery_combos --code-insee=…
```

### Tests Python

- Même parking sur 2 bâtiments / 2 parcelles du combo → `parking_sum_m2` = aire unique (pas doublée).
- Deux parkings distincts → somme des deux aires.
- Combo sans parking → `0`.

## API

### `GET /api/matching-v5/combos-overview`

Paramètres additionnels (optionnels) :

- `minParkingM2`, `maxParkingM2` — mêmes conventions que `minFootprintM2` / `maxFootprintM2` (plafond UI 50 000+, borne haute ouverte).

SQL (pas de waiver) :

```sql
AND ($min_parking <= 0 OR parking_sum_m2 > $min_parking)
AND ($max_parking >= 50000 OR parking_sum_m2 <= $max_parking)
```

Propriétés GeoJSON : exposer `parking_sum_m2`.

Helper : `buildCombosOverviewParkingWhere` dans `lib/discovery-combos-overview-http.ts` (symétrique à `buildCombosOverviewSurfaceWhere`).

## Client Discovery

| Élément | Changement |
|---------|------------|
| `DiscoveryFiltersPanel` | Second range slider « Surface parking (m²) », 0 — 50 000+, pas 50, défaut min **0** |
| `app/discovery/page.tsx` | État `parkingMinM2` / `parkingMaxM2`, debounce 150 ms, query params sur fetch combos-overview |
| `hasActiveDiscoveryFilters` | Inclut filtre parking actif |
| `lib/discovery-combos-overview.ts` | Parser `parking_sum_m2` (optionnel sur le type point) |

Filtres activité / année construction : inchangés (client sur markers déjà filtrés par empreinte + parking SQL).

## Cohérence tiroir

- Tiroir : liste détaillée via `collectParkingsFromMatchingRows` (dédup identique).
- Non-régression : échantillon de combos — `parking_sum_m2` SQL ≈ somme TS (écart < 0,01).

## Risques et mitigations

| Risque | Mitigation |
|--------|------------|
| Table combos pas rebuild après matching | Doc procédure + rappel `build_discovery_combos` |
| Parkings absents si `--no-parking` | `parking_sum_m2 = 0` ; filtre min > 0 exclut ces combos (comportement attendu) |

## Références

- [`docs/plans/2026-05-20-discovery-combo-surface-sql-design.md`](2026-05-20-discovery-combo-surface-sql-design.md)
- [`lib/matching-v5-parking.ts`](../lib/matching-v5-parking.ts) — `collectParkingsFromMatchingRows`
- [`data-pipeline/matching_v5/discovery_combos_v5.py`](../data-pipeline/matching_v5/discovery_combos_v5.py)
- [`docs/plans/2026-05-18-matching-v5-parking-charging-design.md`](2026-05-18-matching-v5-parking-charging-design.md)
