# Discovery combo surface SQL (B1) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Filtrer les clusters Découverte par somme d’empreintes du combo en SQL, sans recalcul client à chaque mouvement du slider.

**Architecture:** Table `scout_matching_v5_combos` remplie par script Python post-matching ; endpoint `combos-overview` applique bbox + seuils surface ; la page Discovery consomme directement les points combo filtrés.

**Tech Stack:** PostgreSQL/PostGIS, Python 3 (data-pipeline), Next.js App Router, Vitest, scripts `node scripts/*.mjs`.

**Design:** [`docs/plans/2026-05-20-discovery-combo-surface-sql-design.md`](2026-05-20-discovery-combo-surface-sql-design.md)

---

### Task 1: Schéma SQL combos

**Files:**
- Create: `data-pipeline/sql/010_scout_matching_v5_combos.sql`
- Modify: `data-pipeline/README.md` (ordre d’application des migrations)
- Modify: `docs/PROCEDURE-AJOUT-COMMUNE.md` (étape refresh combos)

**Step 1:** Créer la table + index (voir design).

**Step 2:** Appliquer en local :

```bash
psql "$LOCAL_DATABASE_URL" -f data-pipeline/sql/010_scout_matching_v5_combos.sql
```

**Step 3:** Commit (si demandé par l’utilisateur).

---

### Task 2: Logique pure Python (index + somme)

**Files:**
- Create: `data-pipeline/matching_v5/discovery_combos_v5.py`
- Create: `data-pipeline/python/tests/test_discovery_combos_v5.py`

**Step 1:** Tests — composante partage, `footprint_sum_m2` dédupliqué (684), waiver industrial.

**Step 2:** Implémenter :
- `build_parcelle_combo_index(parcelle_rows) -> dict[parcelle_id, combo_id]`
- `combo_footprint_sum_m2(parcelle_rows) -> float`
- `combo_has_landuse_waiver(parcelle_rows) -> bool`
- `combo_id_from_parcelle_ids(ids) -> str`

Parser `buildings_json` depuis `properties_json` (même structure que l’export `run_matching_v5`).

**Step 3:**

```bash
cd data-pipeline/python && pytest tests/test_discovery_combos_v5.py -v
```

---

### Task 3: Script build + UPSERT Postgres

**Files:**
- Create: `data-pipeline/matching_v5/build_discovery_combos.py`
- Modify: `package.json` — script npm `pipeline:matching-v5:combos`

**Step 1:** CLI `--code-insee` (requis), option `--database-url`.

**Step 2:** Lire parcelles `scout_matching_v5_features` ; pour chaque combo :
- Calcul champs design
- Centroïde via jointure `scout_matching_v5_buildings_mv` si dispo
- `DELETE FROM scout_matching_v5_combos WHERE code_insee = $1`
- `INSERT` batch

**Step 3:** Tester sur `33318` :

```bash
python -m data-pipeline.matching_v5.build_discovery_combos --code-insee=33318
psql "$LOCAL_DATABASE_URL" -c "SELECT count(*), avg(footprint_sum_m2) FROM scout_matching_v5_combos WHERE code_insee='33318';"
```

---

### Task 4: API `combos-overview`

**Files:**
- Create: `app/api/matching-v5/combos-overview/route.ts`
- Create: `lib/discovery-combos-overview.ts`
- Create: `lib/discovery-combos-overview.test.ts`
- Create: `lib/discovery-combos-overview-http.test.ts` (filtre SQL min/max + waiver)

**Step 1:** Tests parse FC + construction URLSearchParams (`minFootprintM2`, `maxFootprintM2`).

**Step 2:** Route GET — même auth/bbox/limit que `buildings-overview` ; WHERE footprint avec waiver.

**Step 3:**

```bash
npx vitest run lib/discovery-combos-overview.test.ts lib/discovery-combos-overview-http.test.ts
```

---

### Task 5: Brancher Discovery (carte)

**Files:**
- Modify: `app/discovery/page.tsx`
- Modify: `lib/discovery-surface-defaults.ts` (constantes query params si besoin)
- Modify: `components/discovery/DiscoveryMapView.tsx` (signature cache inchangée si shape combo identique)

**Step 1:** Remplacer fetch `buildings-overview` (mode cluster) par `combos-overview` avec `minFootprintM2` / `maxFootprintM2` depuis `appliedSurfaceRange`.

**Step 2:** Mapper la réponse → `DiscoveryComboMarker[]` (plus de `buildDiscoveryComboMarkers` + `filterDiscoveryComboMarkersBySurface` sur le hot path).

**Step 3:** `osmBuildingDisplayFilter` : union `osm_building_ids` des combos reçus.

**Step 4:** Retirer `osmActivityOptions` double build (`buildDiscoveryComboMarkers` + filter) — garder calcul tags sur `matchingV5Rows` uniquement.

**Step 5:** Vérifier manuellement : slider surface, compteur combos, pas de freeze avec viewport chargé.

---

### Task 6: Documentation & procédure

**Files:**
- Modify: `docs/MATCHING-V5.md`
- Modify: `docs/PROCEDURE-AJOUT-COMMUNE.md`
- Modify: `data-pipeline/matching/README.md`

Documenter enchaînement : matching → refresh buildings MV → build combos.

---

### Task 7: Test d’alignement pipeline ↔ tiroir

**Files:**
- Create: `data-pipeline/python/tests/test_discovery_combos_vs_ts_fixture.py` (optionnel)
- Ou extend `lib/matching-v5-to-prospect.test.ts` avec fixture JSON exportée

Comparer 5 combos réels : `footprint_sum_m2` SQL == `footprintSumTotalFromV5` TS.

---

## Ordre d’exécution recommandé

1 → 2 → 3 → 4 → 5 → 6 → 7

## Critères de succès

- [ ] Slider surface : pas de pic CPU client mesurable (pas de `buildParcelleComboIndex` en boucle).
- [ ] Combo 15 267 m² visible avec min 400 ; masqué avec min 20 000.
- [ ] Partage BC : somme combo = valeur tiroir (test 684).
- [ ] MVT whitelist = ids des combos retournés par l’API.

## Rollback

Garder `buildings-overview` et `buildDiscoveryComboMarkers` ; basculer via feature flag env `DISCOVERY_COMBOS_OVERVIEW=1` si besoin de livraison progressive.
