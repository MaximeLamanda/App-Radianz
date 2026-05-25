# Matching V5 — résolution d’adresse (cascade conservatrice) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Renseigner `display_address` (confirmé uniquement) au plus près du bâtiment via OSM → PPM corroboré → Géoplateforme → SIRENE, sans nouvelle table Postgres.

**Architecture:** Module Python `address_resolver_v5.py` appelé depuis `run_matching_v5.py` ; champs dans `properties_json` ; parsers et affichage TS mis à jour. Design : [`2026-05-18-matching-v5-address-resolver-design.md`](./2026-05-18-matching-v5-address-resolver-design.md).

**Tech Stack:** Python 3, `scout_pipeline.address_normalization`, API Géoplateforme géocodage, TypeScript / Vitest.

---

### Task 1: Client Géoplateforme + tests HTTP mockés

**Files:**
- Create: `data-pipeline/matching_v5/geoplateforme_geocode.py`
- Create: `data-pipeline/python/tests/test_geoplateforme_geocode.py`

**Step 1:** Test `reverse(lon, lat)` parse `features[0].properties.score`, `label`, `citycode`.

**Step 2:** Implémenter client avec timeout, rate limit helper, gestion 429.

**Step 3:** Documenter URL officielle en en-tête du module (réf. cartes.gouv.fr).

---

### Task 2: Résolveur pur `address_resolver_v5.py`

**Files:**
- Create: `data-pipeline/matching_v5/address_resolver_v5.py`
- Create: `data-pipeline/python/tests/test_address_resolver_v5.py`

**Step 1:** Tests cascade étape 1 — OSM `addr:full` / street+housenumber acceptés ; rue seule refusée.

**Step 2:** Tests étape 2 — PPM accepté si corroboration mock BAN ; rejeté si voie divergente.

**Step 3:** Tests étape 3 — seuils score/distance standard vs zone pro (`zone_tag` industrial).

**Step 4:** Tests étape 4 — SIRENE seulement si `matched` + distance mock ≤ 50 m.

**Step 5:** Implémenter `resolve_display_address_v5(...)` retournant dict champs design.

---

### Task 3: Intégration `run_matching_v5.py`

**Files:**
- Modify: `data-pipeline/matching_v5/run_matching_v5.py`
- Modify: `docs/MATCHING-V5.md`

**Step 1:** Ajouter `--no-address-resolve`.

**Step 2:** Après jointure bâtiment×parcelle, appeler résolveur par bâtiment ; cache coordonnées.

**Step 3:** Propager `display_address*` sur `buildings_json` et ligne `grain=building` / parcelle agrégée (meilleur bâtiment confirmé ou vide).

**Step 4:** Mettre à jour doc MATCHING-V5 (cascade, champs, re-run).

---

### Task 4: Parse TypeScript + affichage

**Files:**
- Modify: `lib/scout-matching-v5-map.ts`
- Modify: `lib/matching-v5-to-prospect.ts`
- Modify: `lib/scout-matching-v5-map.test.ts`
- Modify: `lib/matching-v5-to-prospect.test.ts`

**Step 1:** Étendre `ScoutMatchingV5Row` / parse `properties` avec `displayAddress`, `displayAddressSource`, `displayAddressConfidence`.

**Step 2:** `formatDiscoveryDrawerHeroAddress` — priorité `display_address` confirmed.

**Step 3:** `primaryAddress` — idem.

**Step 4:** Tests Vitest verts.

---

### Task 5: Vérification manuelle

**Step 1:** Run matching test commune (`33318`) avec résolution activée (échantillon `--limit` si dispo).

**Step 2:** Contrôler 3 cas en ZI : adresse vide attendue vs OSM tagué vs PPM corroboré.

**Step 3:** Discovery : drawer affiche `display_address` ou fallback cadastral sans fausse adresse.
