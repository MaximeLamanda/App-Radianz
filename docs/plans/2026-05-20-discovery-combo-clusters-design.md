# Discovery — clusters par combo (bâtiments + parcelles liées)

## Contexte

En mode cluster (zoom ≤ 15), la carte affiche aujourd’hui **un marqueur par `osm_building_id`**. Au clic, le surlignage et le tiroir ouvrent pourtant un **combo** : plusieurs empreintes bâtiment + plusieurs parcelles/passerelles (composante connexe « partage » ou groupe multi-parcelle).

L’utilisateur appelle **combo** ce groupe surligné, pas une paire (bâtiment × parcelle).

## Objectif

- **Un seul point carte par combo** (option A), positionné au **centroïde** des bâtiments du combo présents dans l’overview.
- **Clic sur n’importe quel bâtiment** du même combo (cluster ou MVT) → **même** surbrillance et même ancre tiroir.
- Les **nombres affichés dans les clusters** Leaflet reflètent le nombre de **combos**, pas de `osm_building_id`.

## Définition du combo

Identique à la logique de surlignage existante dans `app/discovery/page.tsx` :

- Parcelles `grain=parcelle` reliées par au moins un `batiment_construction_id` avec `matching_status === "partage"` → **composante connexe** (algorithme déjà dans `findMatchingV5LinkedParcelleRowsTransitive`, `lib/scout-matching-v5-map.ts`).
- Parcelle **sans** arête partage → combo = cette parcelle seule (+ tous ses bâtiments dans `building_geometries_json`).
- **Identifiant stable** : `combo:` + liste triée des `scout_v5_id` parcelles du groupe, jointe par `|` (ex. `combo:abc|def`).
- **Ancre tiroir** : première parcelle après `sortMatchingV5ParcelleRowsByCadastre` (inchangé).

## Approche retenue : regroupement côté client (approche 1)

Au zoom overview, Discovery charge déjà en parallèle :

- `/api/matching-v5/features?mode=overview` → `matchingV5Rows`
- `/api/matching-v5/buildings-overview` → `buildingPoints` (positions par `osm_building_id`)

Une fonction pure `buildDiscoveryComboMarkers(matchingV5Rows, buildingPoints)` :

1. Calcule l’index `parcelleId → comboId` (composantes partage + singletons).
2. Rattache chaque `osm_building_id` visible dans les features à un `comboId` via `building_geometries_json` des parcelles du viewport.
3. Agrège les `buildingPoints` par `comboId` ; émet **un** marqueur par combo (centroïde = moyenne lat/lng).
4. **Fallback** : si `matchingV5Rows` est vide (chargement initial), conserver 1 marqueur / `osm_building_id` pour ne pas casser la carte.

Pas de nouvelle MV ni migration SQL dans ce périmètre.

### Correctif (2026-05-20) — comptage cluster restait par `osm_building_id`

**Cause :** `/api/matching-v5/features?mode=overview` renvoie `building_geometries_json = null` (perf). Le regroupement ne pouvait pas lier les points overview aux parcelles → 1 marqueur par `osm_building_id`.

**Correctif :**
- `buildings-overview` expose `parcelle_scout_v5_ids` (déjà en MV).
- `comboIdForBuildingPoint` résout le combo via ces ids + index partage (`buildings_json` des features overview).
- `buildOsmBuildingToComboId` lit aussi `buildings_json` (pas seulement les géométries).

## Sélection et clic

| Avant | Après |
|-------|--------|
| `selectedOsmBuildingId` → API `/buildings/{id}/parcelles` → `parcelleScoutV5Ids[0]` | Clic cluster → `comboId` → `anchorParcelleId` direct |
| Risque d’ancre différente selon le bâtiment cliqué | Ancre toujours la parcelle canonique du combo |
| Marqueur id = `osmBuildingId` | Marqueur id = `comboId` |

- Conserver `selectedRowId` comme source de vérité pour le tiroir et `parcelleHighlightRows`.
- Clic MVT (zoom détail) : résoudre le `comboId` du bâtiment cliqué → même `selectedRowId` que le cluster.
- `selectedOsmBuildingId` peut rester en option pour la whitelist MVT / filtres (premier bâtiment du combo) ou être dérivé du combo.

## Filtres carte

Un combo est **affiché** si au moins un de ses `osm_building_id` passe la whitelist / filtres surface. La sélection reste si le combo reste visible.

## Fichiers impactés

| Fichier | Rôle |
|---------|------|
| `lib/discovery-combo-markers.ts` | Types + `buildDiscoveryComboMarkers` + index partage |
| `lib/discovery-combo-markers.test.ts` | Tests unitaires |
| `app/discovery/page.tsx` | `comboMarkers` useMemo, handler sélection |
| `components/discovery/DiscoveryMapView.tsx` | Props marqueurs combo, `selectedComboId` |

## Tests

- 2 parcelles en partage, 2 bâtiments → **1** marqueur, centroïde cohérent.
- 2 parcelles isolées → **2** marqueurs.
- Deux bâtiments du même combo → même `comboId` et même `anchorParcelleId`.
- Fallback sans rows → 1 marqueur par point bâtiment.

## Hors périmètre

- Vue matérialisée `combos` côté Postgres.
- Changement du pipeline matching V5 ou de la MV bâtiments.
- Modification du comportement de surlignage / tiroir (sauf ancrage stable au clic).

## Références

- `findMatchingV5LinkedParcelleRowsTransitive` — `lib/scout-matching-v5-map.ts`
- `buildings-overview` — `app/api/matching-v5/buildings-overview/route.ts`
- Seuil cluster — `lib/discovery-zoom-modes.ts` (`DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM`)
