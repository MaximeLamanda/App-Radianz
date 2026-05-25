# Discovery combo edit mode — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users extend a Discovery combo with adjacent parcels (and merge other combos) in a dedicated edit mode, then persist the custom parcel/building aggregate on the pipeline prospect without modifying Scout V5 data.

**Architecture:** Session state overlays matching-linked parcelles (`customParcelleIds` / `removedParcelleIds`); neighbors loaded once via PostGIS API; map shows clickable addable parcel outlines; pipeline stores `matchingV5ParcelleIds` + `matchingV5BuildingSelectionIds` on Firestore prospect.

**Tech Stack:** Next.js App Router, Leaflet/react-leaflet, Postgres/PostGIS (`pg`), Turf (optional client checks), Vitest, existing `ScoutMatchingV5Row` types.

**Design doc:** `docs/plans/2026-05-24-discovery-combo-edit-mode-design.md`

---

### Task 1: Effective parcelle resolution (pure lib)

**Files:**
- Create: `lib/discovery-combo-effective-parcelles.ts`
- Create: `lib/discovery-combo-effective-parcelles.test.ts`
- Reference: `lib/scout-matching-v5-map.ts` (`findMatchingV5LinkedParcelleRowsTransitive`)

**Step 1: Write failing tests**

```ts
// fusion: adding parcel from combo B pulls all B parcel ids
// add single orphan parcel
// remove from matching cluster
// dedupe by scout_v5_id
```

**Step 2: Run tests**

```bash
npm test -- lib/discovery-combo-effective-parcelles.test.ts
```

Expected: FAIL (module missing)

**Step 3: Implement**

```ts
export type DiscoveryComboParcelleEditState = {
  customParcelleIds: ReadonlySet<string>;
  removedParcelleIds: ReadonlySet<string>;
};

export function resolveDiscoveryEffectiveParcelleRows(
  matchingLinkedRows: ScoutMatchingV5Row[],
  allRows: ScoutMatchingV5Row[],
  edit: DiscoveryComboParcelleEditState
): ScoutMatchingV5Row[];

export function parcelleIdsForComboMerge(
  parcelleId: string,
  allRows: ScoutMatchingV5Row[]
): string[];
```

Use `findMatchingV5LinkedParcelleRowsTransitive` when resolving merge target parcelle.

**Step 4: Run tests — PASS**

---

### Task 2: Adjacent parcelles API

**Files:**
- Create: `app/api/matching-v5/parcelles-adjacent/route.ts`
- Create: `lib/matching-v5-parcelles-adjacent-http.ts` (query builder + validation)
- Create: `lib/matching-v5-parcelles-adjacent-http.test.ts`

**Step 1: Write failing tests** for param validation (`parcelle_ids`, `buffer_m`, `exclude_ids`).

**Step 2: Implement route**

- `requireAuth`
- Parse comma-separated ids (max ~50 anchor ids)
- SQL pattern:

```sql
SELECT DISTINCT p.scout_v5_id, ST_AsGeoJSON(p.geom)::json AS geometry, ...
FROM scout_matching_v5 p
WHERE p.grain = 'parcelle'
  AND p.scout_v5_id = ANY($exclude) IS FALSE
  AND EXISTS (
    SELECT 1 FROM unnest($anchor_ids::text[]) AS a(id)
    JOIN scout_matching_v5 anchor ON anchor.scout_v5_id = a.id
    WHERE ST_DWithin(anchor.geom::geography, p.geom::geography, $buffer_m)
       OR ST_Touches(anchor.geom, p.geom)
  )
LIMIT 200
```

- Optional: left join LATERAL on `scout_matching_v5_combos` where `p.scout_v5_id = ANY(parcelle_scout_v5_ids)` → `combo_id`

**Step 3: Manual curl** (dev DB):

```bash
curl -s "http://localhost:3000/api/matching-v5/parcelles-adjacent?parcelle_ids=..." \
  -H "Cookie: ..."
```

---

### Task 3: Wire edit state in Discovery page

**Files:**
- Modify: `app/discovery/page.tsx`
- Modify: `lib/discovery-pipeline-match.ts` (match prospect using `matchingV5ParcelleIds`)

**Step 1: Add state**

```ts
const [discoveryEditMode, setDiscoveryEditMode] = useState(false);
const [customParcelleIds, setCustomParcelleIds] = useState<Set<string>>(() => new Set());
const [removedParcelleIds, setRemovedParcelleIds] = useState<Set<string>>(() => new Set());
const [adjacentParcelleCandidates, setAdjacentParcelleCandidates] = useState<AdjacentParcelleCandidate[]>([]);
```

**Step 2: Replace `effectiveDiscoveryLinkedParcelleRows`**

Use `resolveDiscoveryEffectiveParcelleRows(discoveryLinkedParcelleRows, matchingV5Rows, editState)`.

When `discoveryPipelineMatch?.matchingV5ParcelleIds` exists on reopen, seed custom set from persisted ids (minus matching-only removals).

**Step 3: Reset on drawer close / combo change**

Clear edit mode + custom/removed sets when `selectedComboId` changes (unless loading persisted prospect scope).

**Step 4: Fetch neighbors on `discoveryEditMode === true`**

`useEffect` → fetch `/api/matching-v5/parcelles-adjacent` with current effective parcelle ids; store geometries for map layer.

**Step 5: Handlers**

- `onDiscoveryToggleParcelle(parcelleId)` — add with merge ids or remove from effective set
- Pass `discoveryEditMode`, `setDiscoveryEditMode`, handlers to drawer + map

---

### Task 4: Map layer — addable parcels

**Files:**
- Modify: `components/discovery/DiscoveryMapView.tsx`
- Optional create: `components/discovery/DiscoveryEditableParcellesLayer.tsx`

**Step 1: Styles**

```ts
const addableParcellePath: L.PathOptions = {
  color: "#60a5fa",
  weight: 1.2,
  dashArray: "4 3",
  fillColor: "#3b82f6",
  fillOpacity: 0.08,
  interactive: true,
};
```

**Step 2: GeoJSON layer** (only when `discoveryEditMode`)

- Features from `adjacentParcelleCandidates` not already in effective set
- `eventHandlers.click` → `onToggleAdjacentParcelle(id)`; `L.DomEvent.stopPropagation`

**Step 3: Edit mode banner** (absolute top of map container)

---

### Task 5: Drawer — edit entry + parcel toggles

**Files:**
- Modify: `components/solar-scout/ProspectDrawer.tsx` (`ProspectDrawerDiscoverySection`)
- Modify: props on `ProspectDrawer` / `app/discovery/page.tsx` drawer `setDrawerContent`

**Step 1: Button « Modifier le périmètre »** toggles `discoveryEditMode`.

**Step 2: When edit mode**, show count: *X parcelles · Y ajoutées*.

**Step 3: Optional** — list included parcelles with remove action (mirror building table checkboxes).

**Step 4: KPIs** (`footprintSumTotal`, `cartePolygonAreaM2`, etc.) must use **filtered buildings** via `discoverySelectedBuildingIds` (wire existing set into `collectSortedDiscoveryComboBuildingEntries` / new filter helper).

---

### Task 6: Pipeline persistence

**Files:**
- Modify: `types/index.ts`
- Modify: `lib/matching-v5-to-prospect.ts`
- Modify: `lib/firestore.ts` (if prospect serialization strips unknown fields — ensure pass-through)
- Modify: `components/solar-scout/ProspectDrawer.tsx` (`handleDiscoveryAddToPipeline`)

**Step 1: Extend `Prospect`**

```ts
matchingV5ParcelleIds?: string[];
matchingV5BuildingSelectionIds?: string[];
```

**Step 2: `matchingV5RowsToProspectDraft`**

Accept optional `effectiveParcelleRows` + `buildingSelectionIds`; compute footprint only from selected buildings.

**Step 3: On add to pipeline**

```ts
matchingV5ParcelleIds: effectiveParcelleRows.map(r => r.id),
matchingV5BuildingSelectionIds: [...selectedBuildingIds],
```

**Step 4: `matchingV5SelectionMatchesProspect`**

Match if anchor id OR any id in `matchingV5ParcelleIds` overlaps current effective set.

---

### Task 7: Reopen prospect from pipeline

**Files:**
- Modify: `app/discovery/page.tsx` (deep link / `discoveryPipelineMatch`)
- Modify: `lib/pipeline-matching-v5-drawer-context.ts` if used

When prospect has `matchingV5ParcelleIds`, hydrate `effectiveDiscoveryLinkedParcelleRows` from those ids (fetch missing rows via `scout_v5_id` query on features API or batch).

---

### Task 8: Integration tests & manual QA

**Checklist:**

- [ ] Open combo → Modifier le périmètre → voisins visibles en pointillés
- [ ] Clic voisin libre → surbrillance + tiroir parcelles augmenté
- [ ] Clic voisin d’un autre combo → fusion (toutes parcelles du combo B)
- [ ] Décocher bâtiments → empreinte tiroir diminue
- [ ] Ajouter pipeline → Firestore prospect contient `matchingV5ParcelleIds` + `matchingV5BuildingSelectionIds`
- [ ] Revenir sur Découverte via focus pipeline → même périmètre
- [ ] Scout V5 tables inchangées (vérif manuelle)

**Run:**

```bash
npm test -- lib/discovery-combo-effective-parcelles.test.ts lib/matching-v5-parcelles-adjacent-http.test.ts
npm test -- lib/matching-v5-to-prospect.test.ts lib/discovery-pipeline-match.test.ts
```

---

## Suggested commit sequence (when user asks)

1. `feat(discovery): resolve effective combo parcelles lib + tests`
2. `feat(api): matching-v5 parcelles-adjacent endpoint`
3. `feat(discovery): edit mode state and map layer`
4. `feat(discovery): drawer edit UX and filtered KPIs`
5. `feat(pipeline): persist custom v5 parcelle and building scope`
