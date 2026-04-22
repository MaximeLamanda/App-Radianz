# Matching V4 — OSM + adresse BDNB/BAN + SIRENE / Google (design validé)

> Design produit par session brainstorming (2026-04-23). Aucune implémentation tant que le plan d’implémentation associé n’est pas exécuté.

## Objectif

Définir un **processus de matching V4** déterministe, traçable, qui combine :

1. **OSM** (`building` polygon + `name` = équivalent POI) avec scoring SIRENE identique au flux « nom POI » actuel (ex. Google).
2. **Adresse bâtiment** (BDNB / staging, repli BAN) pour compter / résoudre les entreprises à l’adresse.
3. **Google** uniquement en secours quand l’adresse porte **plusieurs** entreprises (B2 → C1 → C2).

## Décisions validées

| Sujet | Décision |
|--------|-----------|
| A1 — Source OSM | Polygone `building=*` intersectant l’emprise BDNB ; tag **`name`** utilisé comme nom de POI pour SIRENE. |
| A1 — Échec SIRENE | Aucun candidat au-dessau du seuil « OK » (à calibrer en implémentation) → passage **A2** (pas de Google à ce stade). |
| A2 — Adresse | **Champ adresse BDNB / staging** si disponible ; sinon **géocodage BAN** depuis le représentant géométrique de l’emprise. |
| B1 — Une entreprise à l’adresse | **Figement** SIREN/SIRET du résultat unique ; **haute confiance** ; **pas** d’appel Google. |
| B2 — Plusieurs entreprises | **C1** Google (POI) puis **C2** matching SIRENE sur le POI retenu (même logique que pipeline actuel). |
| Plusieurs OSM nommés | **Pile** : pour chaque `building` avec `name`, tri puis essais SIRENE jusqu’au premier succès ; sinon A2. |
| Ordre pile OSM | **Surface d’intersection** avec l’emprise BDNB **décroissante** ; **ex aequo** → distance **centroïde** OSM ↔ centroïde BDNB **croissante**. |
| A2 — 0 entreprise à l’adresse | **Par défaut** : secours **C1 → C2** (même logique que B2). À ajuster si les métriques terrain montrent du bruit. |

## Arbre de décision (référence)

1. **Lister les candidats OSM** : `building` avec `name` ∩ emprise BDNB ≠ ∅ ; tri intersection ↓, puis distance centroïdes ↑.
2. **Boucle OSM** : pour chaque candidat, scoring SIRENE « classique » (équivalent flux Google / `findLocalSiren`). Premier match **OK** → **succès A1**, fin.
3. Si liste vide ou aucun match OK → **A2**.
4. **A2** : adresse canonique (BDNB/staging → sinon BAN) ; recherche entreprises à cette adresse.
   - **0** résultat → **C1 → C2** (défaut).
   - **1** résultat → **B1** (figer sans Google).
   - **≥ 2** résultats → **B2** : **C1** puis **C2**.

## Traçabilité export (CSV / GeoJSON V4)

Champs recommandés (évolution schéma `building_matches_v4.csv` / propriétés export) :

- `match_path` ou `v4_step` : valeur discrète (`A1_OSM` | `A2_ADDR_ZERO_GOOGLE` | `A2_ADDR_SINGLE` | `A2_ADDR_MULTI_GOOGLE` | …).
- `osm_candidates_tried` : nombre d’essais OSM ; optionnel liste ordonnée des `name` / ids.
- `address_used_source` : `bdnb` | `ban`.
- `entreprises_a_adresse_count` : entier.
- Réutiliser champs existants : `primary_poi_source`, `primary_poi_name`, `match_confidence_score`, `siren` / `siret`, `fallback_google_used`, etc., avec sémantique alignée sur l’arbre.

## Intégration technique (périmètre)

- **Géométrie** : PostGIS ou équivalent dans le pipeline Python (`ST_Intersects`, aire intersection, centroïdes).
- **Données OSM** : réutiliser la chaîne d’extract existante (ex. PBF → filtres, ou table/parquet déjà produit) ; pas de duplication de logique métier côté front pour le batch matching.
- **SIRENE** : réutiliser **`findLocalSiren`** et les appels **recherche-entreprises** comme dans `scripts/build-bdnb-poi-sample.ts` / enrichissements prospect.
- **BAN** : même stratégie que les autres usages géocodage du repo (clé API, cache si pertinent).

## Points ouverts (hors scope design immédiat)

- **Seuil** numérique « candidat SIRENE OK » (A1 et fin de pile).
- **A2 = 0 entreprises** : confirmer en prod si **C1→C2** reste le bon défaut ou si « sans match » est préférable.
- **Quota** API (Google, BAN, recherche-entreprises) en batch sur toute une commune.

## Références repo

- `lib/find-local-siren.ts`
- `scripts/build-bdnb-poi-sample.ts` (Nearby, tri, SIRENE)
- `data-pipeline/python/scout_pipeline/export_matching_v4_geojson.py` (schéma sortie)
- `docs/MATCHING-V4-WORKFLOW.md` (chaîne fichier / carte)
