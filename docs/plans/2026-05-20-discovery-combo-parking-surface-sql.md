# Discovery combo parking surface SQL — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Filtrer les clusters Découverte par somme de surfaces parking distinctes du combo en SQL, sans recalcul client à chaque mouvement du slider parking.

**Architecture:** Colonne `parking_sum_m2` sur `scout_matching_v5_combos`, calculée dans `build_discovery_combos` (miroir `collectParkingsFromMatchingRows`) ; `combos-overview` applique bbox + seuils empreinte + parking ; la page Discovery envoie les quatre bornes au refetch debouncé.

**Tech Stack:** PostgreSQL, Python 3 (data-pipeline), Next.js App Router, Vitest.

**Design:** [`docs/plans/2026-05-20-discovery-combo-parking-surface-sql-design.md`](2026-05-20-discovery-combo-parking-surface-sql-design.md)

---

### Task 1: Migration SQL `parking_sum_m2`

**Files:**
- Create: `data-pipeline/sql/013_scout_matching_v5_combos_parking_sum_m2.sql`
- Modify: `data-pipeline/README.md` (ordre migrations)
- Modify: `docs/PROCEDURE-AJOUT-COMMUNE.md` (mention colonne parking)

**Step 1:** Ajouter colonne + index :

```sql
ALTER TABLE public.scout_matching_v5_combos
  ADD COLUMN IF NOT EXISTS parking_sum_m2 DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS scout_matching_v5_combos_parking_sum_m2_idx
  ON public.scout_matching_v5_combos (parking_sum_m2);
```

**Step 2:** Appliquer en local :

```bash
psql "$LOCAL_DATABASE_URL" -f data-pipeline/sql/013_scout_matching_v5_combos_parking_sum_m2.sql
```

---

### Task 2: Agrégat Python `combo_parking_sum_m2`

**Files:**
- Modify: `data-pipeline/matching_v5/discovery_combos_v5.py`
- Modify: `data-pipeline/python/tests/test_discovery_combos_v5.py`

**Step 1:** Tests (échec attendu avant implémentation) :

- Deux entrées `buildings_json` avec le même `parkings_json` (`w:1`, 1200 m²) → `parking_sum_m2 == 1200`.
- Deux parkings distincts (`w:1` 800 + `w:2` 500) → `1500`.
- Combo sans `parkings_json` → `0`.

**Step 2:** Implémenter `combo_parking_sum_m2(parcelle_rows)` :

```python
def combo_parking_sum_m2(parcelle_rows: list[dict[str, Any]]) -> float:
    seen: set[str] = set()
    total = 0.0
    for pr in parcelle_rows:
        for b in parse_buildings_json(pr):
            raw = b.get("parkings_json")
            if not isinstance(raw, list):
                continue
            for p in raw:
                if not isinstance(p, dict):
                    continue
                t = str(p.get("osm_parking_type") or "w").strip() or "w"
                try:
                    pid = int(p.get("osm_parking_id"))
                except (TypeError, ValueError):
                    continue
                key = f"{t}:{pid}"
                if key in seen:
                    continue
                seen.add(key)
                try:
                    area = float(p.get("parking_area_m2") or 0)
                except (TypeError, ValueError):
                    area = 0.0
                if area > 0:
                    total += area
    return total
```

**Step 3:** Ajouter `"parking_sum_m2": combo_parking_sum_m2(sorted_rows)` dans `build_combo_records_for_commune`.

**Step 4:**

```bash
cd data-pipeline/python && pytest tests/test_discovery_combos_v5.py -v -k parking
```

---

### Task 3: Persistance `build_discovery_combos`

**Files:**
- Modify: `data-pipeline/matching_v5/build_discovery_combos.py`

**Step 1:** Étendre `INSERT` : colonne `parking_sum_m2`, valeur `rec["parking_sum_m2"]`.

**Step 2:** Rebuild test commune :

```bash
python -m data-pipeline.matching_v5.build_discovery_combos --code-insee=33318
psql "$LOCAL_DATABASE_URL" -c "SELECT combo_id, parking_sum_m2, footprint_sum_m2 FROM scout_matching_v5_combos WHERE code_insee='33318' AND parking_sum_m2 > 0 LIMIT 5;"
```

---

### Task 4: Filtre SQL + API

**Files:**
- Modify: `lib/discovery-combos-overview-http.ts`
- Modify: `lib/discovery-combos-overview-http.test.ts`
- Modify: `app/api/matching-v5/combos-overview/route.ts`

**Step 1:** Tests Vitest — `buildCombosOverviewParkingWhere` :

- min 0, max 50_000 → aucun fragment.
- min 500 → `parking_sum_m2 > $n`.
- max 20_000 → `parking_sum_m2 <= $n`.

**Step 2:** Ajouter types `CombosOverviewParkingFilterInput`, fonction `buildCombosOverviewParkingWhere` (copie structure surface, sans waiver).

**Step 3:** Étendre `buildCombosOverviewSearchParams` : `minParkingM2`, `maxParkingM2`.

**Step 4:** Route `combos-overview` :

- `parseParkingBounds(searchParams)` (défauts = mêmes que footprint).
- Appeler `buildCombosOverviewParkingWhere` après le filtre empreinte.
- `SELECT` inclure `parking_sum_m2` dans les propriétés JSON.

**Step 5:**

```bash
npx vitest run lib/discovery-combos-overview-http.test.ts
```

---

### Task 5: Parse client + constantes

**Files:**
- Modify: `lib/discovery-combos-overview.ts`
- Modify: `lib/discovery-combos-overview.test.ts`
- Modify: `lib/discovery-surface-defaults.ts` (alias ou commentaire parking = mêmes bornes 0 / 50_000+)

**Step 1:** `DiscoveryComboOverviewPoint` : champ `parkingSumM2: number`.

**Step 2:** `parseDiscoveryCombosOverviewFeatureCollection` lit `parking_sum_m2`.

**Step 3:** Test fixture FC avec `parking_sum_m2: 1250`.

---

### Task 6: UI Discovery

**Files:**
- Modify: `components/discovery/DiscoveryFiltersPanel.tsx`
- Modify: `app/discovery/page.tsx`

**Step 1:** Props panel : `parkingMinM2`, `parkingMaxM2`, handlers (second `RangeSlider`, label « Surface parking (m²) »).

**Step 2:** `page.tsx` :

- `useState` parking min/max (défaut 0 / `DISCOVERY_SURFACE_SLIDER_MAX_M2`).
- `appliedParkingRange` debouncé comme empreinte.
- `hasActiveDiscoveryFilters` : helper `isDiscoveryParkingFilterDisabled` (miroir surface, dans `discovery-surface-defaults.ts` ou fichier dédié minimal).
- Fetch combos-overview : passer `minParkingM2` / `maxParkingM2` via `buildCombosOverviewSearchParams`.
- Effet refetch : déclencher aussi sur changement parking (même debounce 150 ms).

**Step 3:** Vérification manuelle (`npm run dev`, `/discovery`) :

- Slider parking seul réduit les clusters.
- Combiné empreinte + parking.
- Reset sliders → tous les combos visibles.

---

### Task 7: Documentation

**Files:**
- Modify: `docs/MATCHING-V5.md`
- Modify: `docs/PROCEDURE-AJOUT-COMMUNE.md`

Documenter `parking_sum_m2`, paramètres API, slider UI.

---

### Task 8 (optionnel): Alignement SQL ↔ TS

**Files:**
- Create: `lib/discovery-combo-parking-sum.test.ts`

Fixture : 2 parcelles combo, `parkings_json` connus → comparer `combo_parking_sum_m2` Python (via export JSON) vs somme `collectParkingsFromMatchingRows` sur rows parsées.

---

## Ordre d’exécution

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

## Critères de succès

- [ ] Slider parking : pas d’agrégation `parkings_json` en boucle sur tous les combos du viewport.
- [ ] Combo avec 2× le même parking → `parking_sum_m2` = aire unique.
- [ ] `minParkingM2=500` exclut les combos sans parking ou sous 500 m² total distinct.
- [ ] Whitelist MVT cohérente avec combos retournés après les deux filtres SQL.

## Rollback

Filtre parking ignoré si colonne absente (migration non appliquée) — documenter ; pas de feature flag requis en v1.
