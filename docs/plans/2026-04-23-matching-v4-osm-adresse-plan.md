# Matching V4 OSM + adresse — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implémenter le moteur de matching V4 décrit dans `docs/plans/2026-04-23-matching-v4-osm-adresse-design.md`, produisant un `building_matches_v4.csv` joignable au GeoJSON d’emprises existant (`export_matching_v4_geojson`).

**Architecture:** Module Python (ou script Node + Python) dans `data-pipeline/python/scout_pipeline/` qui, pour chaque emprise BDNB (lignes issues de la même source que `build-bdnb-poi-sample`), exécute l’arbre A1→A2→B1/B2→C1/C2 en réutilisant la logique SIRENE (`findLocalSiren` porté ou appel HTTP vers routes internes), géométrie OSM depuis extract existant, adresse BDNB/BAN. Sortie CSV alignée sur les colonnes attendues par `export_matching_v4_geojson.py`.

**Tech Stack:** Python 3.11, `pandas`, `pg` / `psycopg` ou client existant, PostGIS, APIs api.gouv (recherche-entreprises), Google Places (C1), géocodage BAN si déjà encapsulé dans le repo.

---

### Task 1: Schéma CSV V4 étendu (traçabilité)

**Files:**

- Modify: `data-pipeline/python/scout_pipeline/export_matching_v4_geojson.py` (documenter / accepter nouvelles colonnes optionnelles dans `_csv_row_to_feature_properties` si besoin d’exposer `match_path` côté GeoJSON)
- Create: `docs/plans/2026-04-23-matching-v4-osm-adresse-design.md` (déjà — référence colonnes)

**Step 1:** Lister les colonnes CSV actuelles vs champs `match_path`, `address_used_source`, `entreprises_a_adresse_count`, `osm_candidates_tried`.

**Step 2:** Décider les noms exacts snake_case et mettre à jour le design si divergence.

**Step 3:** Étendre `_csv_row_to_feature_properties` + docstring schéma pour propager `match_path` (ou équivalent) dans le GeoJSON V4.

**Step 4:** `pytest` ou smoke `python -m scout_pipeline.export_matching_v4_geojson` sur CSV fixture une ligne.

**Step 5:** Commit `docs: extend V4 export schema for match_path`.

---

### Task 2: Source géométrique OSM `building` + `name`

**Files:**

- Read: `data-pipeline/python/scout_pipeline/osm_poi_extract.py` (ou équivalent)
- Create: `data-pipeline/python/scout_pipeline/matching_v4_osm_buildings.py` (exemple) — chargement polygones `building` avec tag `name` pour une commune / bbox

**Step 1:** Vérifier si l’extract actuel conserve les polygones `building` ou seulement des POIs ; si insuffisant, ajouter filtre `building` + tags `name` dans un extract dédié ou requête PostGIS sur table importée.

**Step 2:** Implémenter tri **aire intersection ↓**, tie-break **distance centroïde**.

**Step 3:** Test unitaire sur deux polygones OSM factices + une emprise BDNB WKT.

**Step 4:** Commit `feat(matching-v4): rank OSM named buildings by intersection`.

---

### Task 3: Pont SIRENE « comme Google POI » depuis nom OSM

**Files:**

- Read: `lib/find-local-siren.ts` — documenter équivalent attendu côté Python (ou appeler route Next/API existante depuis script batch si déjà exposé)
- Modify: nouveau module Python appelant la même sémantique (si logique TS uniquement, extraire fonctions pures partagées ou dupliquer avec tests de non-régression sur jeux fixes)

**Step 1:** Identifier si `findLocalSiren` peut être invoqué via HTTP local (`/api/...`) depuis un script batch ; sinon porter la logique minimale en Python (non idéal — préférer factorisation).

**Step 2:** Pour chaque candidat OSM : construire `poiName` = `name`, `address` = adresse BDNB/BAN (même source que A2).

**Step 3:** Test d’intégration mock HTTP avec réponses SIRENE figées.

**Step 4:** Commit `feat(matching-v4): A1 OSM name → SIRENE scoring`.

---

### Task 4: A2 — Adresse BDNB / staging puis BAN

**Files:**

- Read: schéma staging BDNB (`scripts/build-bdnb-poi-sample.ts`, colonnes SQL)
- Create: `data-pipeline/python/scout_pipeline/matching_v4_address.py` — résolution `bdnb` | `ban` + texte normalisé

**Step 1:** Mapper champs BDNB disponibles sur `batiment_groupe_id` / emprise (même jointure que sample).

**Step 2:** Si absent, appeler géocodeur BAN (réutiliser util existant ou `requests` vers API projet).

**Step 3:** Tests unitaires : avec adresse BDNB → pas d’appel BAN ; sans → appel BAN mocké.

**Step 4:** Commit `feat(matching-v4): resolve building address bdnb then ban`.

---

### Task 5: A2 — Recherche entreprises à l’adresse + branches B1 / B2 / 0

**Files:**

- Read: `lib/recherche-entreprises.ts` / routes `app/api/recherche-entreprises`
- Modify: module matching V4 — compter / lister établissements à l’adresse normalisée

**Step 1:** 1 résultat → remplir ligne CSV B1 (`match_path`, `siren`, `siret`, scores max).

**Step 2:** ≥2 → marquer pour C1 (ne pas figer SIREN avant C2).

**Step 3:** 0 → enchaîner C1→C2 (défaut design).

**Step 4:** Tests mock trois cas.

**Step 5:** Commit `feat(matching-v4): A2 address enterprise count branches`.

---

### Task 6: C1 / C2 (réutil pipeline Google + SIRENE)

**Files:**

- Read: `scripts/build-bdnb-poi-sample.ts` (Nearby, tri, Place Details optionnel)
- Modify: module matching V4 — factoriser ou sous-process `tsx` si réutilisation stricte TS nécessaire

**Step 1:** Pour B2 et A2-zéro : reproduire séquence Nearby + tri + `findLocalSiren` sur POI retenu.

**Step 2:** Limiter appels Google (env `BDNB_POI_GOOGLE_PLACE_DETAILS` aligné).

**Step 3:** Test bout en bout sur 1 emprise réelle (limit 1) avec clés `.env.local` (manuel CI skip).

**Step 4:** Commit `feat(matching-v4): B2 and zero-address Google fallback`.

---

### Task 7: CLI + npm script + doc workflow

**Files:**

- Create: `data-pipeline/python/scout_pipeline/run_matching_v4.py` (CLI `--commune`, `--limit`, `--out-csv`)
- Modify: `package.json` — `pipeline:matching-v4:run`
- Modify: `docs/MATCHING-V4-WORKFLOW.md` — remplacer stub par « vrai matching » quand dispo

**Step 1:** CLI lit emprises depuis Postgres (même requête que build sample) ou depuis GeoJSON base.

**Step 2:** Écrit `data-pipeline/out/matching/v4/building_matches_v4.csv`.

**Step 3:** Documenter commande + prérequis clés API.

**Step 4:** Commit `feat(matching-v4): CLI run_matching_v4`.

---

## Vérification finale

```bash
npm run pipeline:matching-v4:stub-matches   # remplacé par run réel
npm run pipeline:matching-v4-export
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('data-pipeline/out/matching/v4/scout_matching_v4_33318.geojson','utf8')); console.log('ok');"
```

Solar Scout : `SCOUT_BDNB_POI_SAMPLE_GEOJSON` pointant vers le GeoJSON V4 fusionné.

---

**Plan complete and saved to `docs/plans/2026-04-23-matching-v4-osm-adresse-plan.md`. Two execution options:**

1. **Subagent-Driven (this session)** — une sous-tâche à la fois, revue entre les tâches  
2. **Parallel Session (separate)** — nouvelle session avec executing-plans et checkpoints batch  

**Which approach?**
