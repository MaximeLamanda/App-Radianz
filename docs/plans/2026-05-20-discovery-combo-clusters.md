# Discovery combo clusters — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Afficher un marqueur cluster par combo (groupe parcelles partage + bâtiments liés), avec sélection stable au clic, en regroupant côté client `matchingV5Rows` + `buildingPoints`.

**Architecture:** Fonction pure `buildDiscoveryComboMarkers` calcule `comboId` par composante connexe partage (même règle que le surlignage), agrège les positions overview par combo, et expose une ancre parcelle canonique. Discovery page et MapView consomment ces marqueurs au lieu des points `osm_building_id` bruts.

**Tech Stack:** TypeScript, React, Leaflet.markercluster, tests Vitest (`npm run test:unit`).

**Design:** [`docs/plans/2026-05-20-discovery-combo-clusters-design.md`](2026-05-20-discovery-combo-clusters-design.md)

---

### Task 1: Index parcelle → comboId

**Files:**
- Create: `lib/discovery-combo-markers.ts`
- Create: `lib/discovery-combo-markers.test.ts`
- Reference: `lib/scout-matching-v5-map.ts` (`collectPartageBatimentConstructionIds`, `sortMatchingV5ParcelleRowsByCadastre`)

**Step 1: Write failing tests for combo index**

```typescript
// lib/discovery-combo-markers.test.ts
import { describe, expect, it } from "vitest";
import { buildParcelleComboIndex } from "./discovery-combo-markers";
import type { ScoutMatchingV5Row } from "./scout-matching-v5-map";

// Helpers: minimal parcelle rows with buildings_json partage (copy patterns from scout-matching-v5-map.test.ts)
```

Cases:
- P1↔P2 partage (même `batiment_construction_id`, status `partage`) → même `comboId`.
- P3 isolée → `comboId` distinct `combo:p3-id`.
- `comboId` format stable : `combo:` + ids triés joinés par `|`.

**Step 2: Run tests — expect FAIL**

```bash
npm run test:unit -- lib/discovery-combo-markers.test.ts
```

**Step 3: Implement `buildParcelleComboIndex`**

- Filtrer `grain === "parcelle"`.
- Réutiliser la construction `partageByParcelId` / `bidToParcelIds` de `findMatchingV5LinkedParcelleRowsTransitive` (extraire logique partagée ou dupliquer minimalement dans ce module pour éviter refactor large).
- BFS/DFS sur parcelles non visitées ; pour chaque composante, `comboId = "combo:" + [...visited].sort().join("|")`.
- Parcelle sans partage : `comboId = "combo:" + parcelleId`.

Export types:

```typescript
export type DiscoveryComboMarker = {
  comboId: string;
  position: { lat: number; lng: number };
  anchorParcelleId: string;
  osmBuildingIds: string[];
};
```

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add lib/discovery-combo-markers.ts lib/discovery-combo-markers.test.ts
git commit -m "feat(discovery): index parcelles par comboId partage"
```

---

### Task 2: buildDiscoveryComboMarkers

**Files:**
- Modify: `lib/discovery-combo-markers.ts`
- Modify: `lib/discovery-combo-markers.test.ts`
- Reference: `lib/scout-matching-v5-map.ts` (`listValidOsmBuildingIdsInBuildingGeometriesJson`)

**Step 1: Write failing tests**

- 2 parcelles partage, `buildingPoints` pour `w:1` et `w:2` sur ces parcelles → **1** marker, centroid = moyenne des 2 positions.
- 2 parcelles isolées, 1 bâtiment chacune → **2** markers.
- `matchingV5Rows` vide + 3 `buildingPoints` → **3** markers (fallback ids = `osmBuildingId`, comboId dérivé `combo:building:w:1` ou garder id bâtiment — documenter choix : fallback `id = osmBuildingId` pour compat cluster keys).

**Step 2: Run tests — FAIL**

**Step 3: Implement `buildDiscoveryComboMarkers`**

```typescript
export function buildDiscoveryComboMarkers(
  rows: readonly ScoutMatchingV5Row[],
  buildingPoints: readonly DiscoveryBuildingPoint[]
): DiscoveryComboMarker[]
```

- Si `rows.length === 0` : return buildingPoints.map(p => ({ comboId: p.osmBuildingId, ... })) (fallback).
- Sinon : `buildParcelleComboIndex(rows)` ; pour chaque parcelle, lire `buildingGeometriesJson` → map `osmBuildingId → comboId` (si un bâtiment apparaît sur 2 parcelles du **même** combo, une entrée ; si conflit combo différent — garder le combo de la parcelle triée cadastre en premier).
- Grouper `buildingPoints` par `comboId` ; centroid ; `anchorParcelleId` = première parcelle du combo (`sortMatchingV5ParcelleRowsByCadastre` sur les parcelles du groupe).
- Ignorer points sans `comboId` mappé (optionnel : fallback singleton).

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git add lib/discovery-combo-markers.ts lib/discovery-combo-markers.test.ts
git commit -m "feat(discovery): build combo markers from rows and overview points"
```

---

### Task 3: Résolution combo → ancre (helper clic)

**Files:**
- Modify: `lib/discovery-combo-markers.ts`
- Modify: `lib/discovery-combo-markers.test.ts`

**Step 1: Test `resolveComboSelection(comboId, markers)`**

Retourne `{ anchorParcelleId, representativeOsmBuildingId }` ou null.

**Step 2–4: Implement + PASS**

**Step 5: Commit**

---

### Task 4: Brancher Discovery page

**Files:**
- Modify: `app/discovery/page.tsx` (~L157, ~L402, ~L477, ~L850)

**Step 1: Import et `comboMarkers` useMemo**

```typescript
const comboMarkers = useMemo(
  () => buildDiscoveryComboMarkers(matchingV5Rows, buildingPoints),
  [matchingV5Rows, buildingPoints]
);
```

**Step 2: Handler sélection cluster**

- Remplacer ou compléter `setSelectedOsmBuildingId` au clic cluster :
  - `onSelectComboId(comboId)` → `resolveComboSelection` → `setSelectedRowId(anchor)` + `setSelectedOsmBuildingId(representative)` pour MVT whitelist.
- **Supprimer ou court-circuiter** l’effet L481–510 qui fetch `/buildings/{osmId}/parcelles` quand l’ancre vient déjà du combo (garder fetch seulement si clic MVT sans rows chargées).

**Step 3: Passer `comboMarkers` à `DiscoveryMapView`**

Prop rename : `buildingPoints` → `comboMarkers` en mode cluster, ou prop dédiée `clusterMarkers`.

**Step 4: Manual smoke**

- `npm run dev` → /discovery, zoom ≤ 15, zone avec partage connu (ex. doc MATCHING-V5) : un cluster ne doit plus compter N bâtiments du même combo.
- Clic deux bâtiments du même combo → même surbrillance.

**Step 5: Commit**

```bash
git add app/discovery/page.tsx
git commit -m "feat(discovery): sélection et marqueurs par combo"
```

---

### Task 5: DiscoveryMapView cluster layer

**Files:**
- Modify: `components/discovery/DiscoveryMapView.tsx` (~L47–90, ~L348, ~L460–476, ~L557)

**Step 1: Types props**

```typescript
clusterMarkers: readonly { id: string; position: L.LatLngExpression }[];
selectedComboId: string | null;
onSelectComboId: (comboId: string | null) => void;
```

**Step 2: `DiscoveryClusteredBuildings`**

- `selected={selectedComboId === m.id}`
- `click` → `onSelectRef.current?.(m.id)`

**Step 3: Filtres whitelist**

Adapter `clusteredMarkers` useMemo : un combo visible si `marker.osmBuildingIds` intersecte `osmBuildingDisplayFilter.ids` (exposer ids sur marker ou filtrer en amont dans page).

**Step 4: `npm run test:unit` + lint fichiers touchés**

**Step 5: Commit**

```bash
git add components/discovery/DiscoveryMapView.tsx
git commit -m "feat(discovery): carte cluster un point par combo"
```

---

### Task 6: Clic MVT → même combo

**Files:**
- Modify: `app/discovery/page.tsx` (handler `onSelectOsmBuildingId`)

**Step 1: Quand `selectedOsmBuildingId` change (MVT)**

- Si `matchingV5Rows` chargé : trouver `comboId` contenant ce bâtiment via `buildDiscoveryComboMarkers` ou helper `findComboIdForOsmBuilding(rows, osmId)`.
- `setSelectedRowId(anchorParcelleId)` directement (pas `parcelleScoutV5Ids[0]`).

**Step 2: Test unitaire `findComboIdForOsmBuilding` si extrait**

**Step 3: Commit**

---

### Task 7: Doc courte + vérif finale

**Files:**
- Modify: `docs/MATCHING-V5.md` (section Discovery / clusters) — 1 paragraphe renvoyant au design.

**Step 1: Ajouter note « overview clusters = combos »**

**Step 2: Run full unit tests**

```bash
npm run test:unit
```

**Step 3: Commit**

```bash
git add docs/MATCHING-V5.md
git commit -m "docs: discovery clusters par combo"
```

---

## Execution handoff

Plan saved to `docs/plans/2026-05-20-discovery-combo-clusters.md`.

**1. Subagent-Driven (this session)** — tâche par tâche avec revue entre chaque étape.

**2. Parallel Session** — nouvelle session avec @executing-plans sur ce plan.

Quelle option préfères-tu ?
