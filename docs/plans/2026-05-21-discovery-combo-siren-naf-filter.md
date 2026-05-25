# Discovery — filtres SIREN / NAF combo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permettre sur Découverte de filtrer les clusters combo par SIREN (propriétaire PPM ou domiciliation SIRENE) et par division NAF (2 chiffres), via colonnes pré-agrégées SQL et l’API combos-overview.

**Architecture:** Étendre `scout_matching_v5_combos` avec `owner_sirens`, `domiciliation_sirens`, `naf_divisions` ; les remplir dans `build_discovery_combos` ; filtrer en SQL dans `combos-overview` ; exposer les champs dans le panneau filtres Discovery.

**Tech Stack:** Postgres (TEXT[] + GIN), Python `discovery_combos_v5`, Next.js App Router, Vitest.

**Design:** `docs/plans/2026-05-21-discovery-combo-siren-naf-filter-design.md`

---

### Task 1: Migration SQL 015

**Files:**
- Create: `data-pipeline/sql/015_scout_matching_v5_combos_siren_naf.sql`

**Step 1:** Ajouter colonnes + index GIN (copier le style de `011` / `012`).

```sql
ALTER TABLE public.scout_matching_v5_combos
  ADD COLUMN IF NOT EXISTS owner_sirens TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS domiciliation_sirens TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS naf_divisions TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS scout_matching_v5_combos_owner_sirens_gin
  ON public.scout_matching_v5_combos USING GIN (owner_sirens);
-- idem domiciliation_sirens, naf_divisions
```

**Step 2:** Appliquer en local (`psql` ou script existant type `apply-matching-v5-combos.mjs` si étendu).

---

### Task 2: Tests Python agrégation (TDD)

**Files:**
- Modify: `data-pipeline/python/tests/test_discovery_combos_v5.py`
- Modify: `data-pipeline/matching_v5/discovery_combos_v5.py`

**Step 1:** Test helper `naf_division_from_ape`:

```python
def test_naf_division_from_ape():
    assert naf_division_from_ape("47.11F") == "47"
    assert naf_division_from_ape("  68.20B ") == "68"
    assert naf_division_from_ape("") is None
    assert naf_division_from_ape("X47") is None
```

**Step 2:** Test combo union SIREN / NAF avec parcelles mock (`properties_json` contenant `passerelle_addresses_json` / `sirets_json`).

**Step 3:** Implémenter `combo_owner_sirens`, `combo_domiciliation_sirens`, `combo_naf_divisions` + brancher dans `build_combo_records_for_commune`.

**Step 4:** Run:

```bash
cd data-pipeline/python && python -m pytest tests/test_discovery_combos_v5.py -v
```

---

### Task 3: Build combos INSERT

**Files:**
- Modify: `data-pipeline/matching_v5/build_discovery_combos.py`

**Step 1:** Lors du mapping `parcelle_rows`, extraire depuis `properties_json` :
- `passerelle_addresses_json` (string ou list → string JSON)
- `sirets_json`

**Step 2:** Étendre `INSERT` avec `owner_sirens`, `domiciliation_sirens`, `naf_divisions`.

**Step 3:** Rebuild une commune test (ex. `33318`) et vérifier en SQL :

```sql
SELECT combo_id, owner_sirens, domiciliation_sirens, naf_divisions
FROM scout_matching_v5_combos WHERE code_insee = '33318' LIMIT 5;
```

---

### Task 4: Helpers HTTP SQL (TDD)

**Files:**
- Modify: `lib/discovery-combos-overview-http.ts`
- Modify: `lib/discovery-combos-overview-http.test.ts`

**Step 1:** Tests pour :

- `buildCombosOverviewSirenWhere({ role: 'owner', siren: '123456789' }, p)` → `$p = ANY(owner_sirens)`
- `buildCombosOverviewNafDivisionWhere({ division: '47' }, p)` → `$p = ANY(naf_divisions)`
- `buildCombosOverviewSearchParams` inclut `sirenRole`, `siren`, `nafDivision`

**Step 2:** Implémenter les builders.

**Step 3:** Run:

```bash
npm test -- lib/discovery-combos-overview-http.test.ts
```

---

### Task 5: Route combos-overview

**Files:**
- Modify: `app/api/matching-v5/combos-overview/route.ts`

**Step 1:** Parser `sirenRole`, `siren`, `nafDivision` avec validation (400 si `nafDivision` + `owner`).

**Step 2:** Ajouter fragments WHERE via helpers Task 4.

**Step 3:** Test manuel ou test HTTP existant si présent.

---

### Task 6: UI filtres Discovery

**Files:**
- Modify: `components/discovery/DiscoveryFiltersPanel.tsx`
- Modify: `app/discovery/page.tsx`

**Step 1:** Props panel : `sirenRole`, `sirenQuery`, `nafDivision`, handlers, `rowCount`.

**Step 2:** UI :
- Segmented : Propriétaire / Domiciliation
- Input SIREN (9 chiffres)
- Input NAF (2 chiffres, visible si domiciliation)

**Step 3:** State page + passer à `buildCombosOverviewSearchParams` ; inclure dans deps refetch overview et `hasActiveDiscoveryFilters`.

**Step 4:** Filtre client `comboMarkers` : pas de changement si tout passe par overview SQL (vérifier que les marqueurs viennent déjà filtrés de l’API).

---

### Task 7: Docs ops

**Files:**
- Modify: `docs/MATCHING-V5.md`
- Modify: `data-pipeline/matching/README.md`

Documenter migration 015, rebuild combos, params API.

---

### Task 8: Vérification finale

```bash
npm test -- lib/discovery-combos-overview-http.test.ts
cd data-pipeline/python && python -m pytest tests/test_discovery_combos_v5.py -v
```

Manuel : `/discovery` → mode Domiciliation → SIREN connu → carte se restreint ; division NAF `47` ; mode Propriétaire masque NAF.

---

## Checklist déploiement

1. Appliquer `015_scout_matching_v5_combos_siren_naf.sql` sur Neon/local
2. `build_discovery_combos --code-insee=…` pour chaque commune Discovery active
3. Déployer app (route + UI)
