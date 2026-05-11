# Matching V5 (discovery) — Cadastre × IRIS × BDNB × Passerelle (PPM)

> **Pour ajouter une commune** à Discovery / Matching V5, suivre la procédure unique [`docs/PROCEDURE-AJOUT-COMMUNE.md`](PROCEDURE-AJOUT-COMMUNE.md). Le présent document reste la **référence technique** du pipeline (tables, options, sorties) et ne doit pas être suivi pas-à-pas pour ajouter une nouvelle commune.

Ce document décrit le **Matching V5** (mode discovery) implémenté dans `data-pipeline/matching_v5/run_matching_v5.py` et visualisable dans **Solar Scout** via un onglet dédié.

## Objectif

Partir du **cadastre** et produire un export exploitable pour qualification “prospection” :

- **Parcelle (passerelle)** : liste / agrégats de bâtiments associés, surface totale “footprint”, IRIS, statut SIREN.
- **Adresse passerelle** : remonter l’adresse issue de la table passerelle **PPM** (`parcelles_personnes_morales`) pour pouvoir, dans un second temps, faire une **recherche entreprise par adresse**.

## Indépendance

Le script V5 est **autonome** (un seul fichier Python orchestrateur + module fallback Google dédié). Un **fallback Google** optionnel (`--google-fallback`) est implémenté dans le même script ; il ne s’active que si une clé `GOOGLE_MAPS_API_KEY` (ou équivalent) est fournie.

## Neon (prod client) vs Postgres local (pipeline)

Toutes les tables listées ci-dessous servent à **produire** l’export V5 sur ta machine. Pour **Neon** vu par Vercel / Discovery, seuls le résultat `scout_matching_v5_features` et les géométries BDNB (`batiment_construction` + `batiment_groupe_ffo_bat`, schéma aligné sur `BDNB_CONSTRUCTIONS_TABLE`) sont nécessaires côté app — le reste peut rester local si tu ne déploies pas d’autres écrans qui les lisent. Détail et options d’import ciblé : [`NEON-MIGRATION-DOCKER.md`](NEON-MIGRATION-DOCKER.md) § 6.

## Données / tables utilisées

- **Cadastre parcelles** : `public.cadastre_france_feuilles_geom`
  - clés : `code_insee`, `section`, `numero_norm`
  - géométrie : `geom` en **EPSG:4326**
  - `properties` ne contient pas d’adresse (au mieux : `commune`, `contenance`, etc.)

- **Passerelle (PPM)** : `public.parcelles_personnes_morales`
  - lien parcelle ↔ entreprise : `code_insee`, `section`, `numero_parcelle`, `numero_siren`
  - attributs adresse : `numero_voirie`, `indice_repetition`, `nature_voie`, `nom_voie`, `nom_commune`

- **Référentiel établissements** : `public.scout_etablissements` (configurable via `SCOUT_ETABLISSEMENTS_TABLE`)
  - colonnes de match : `numero_norm`, `voie_norm`, `commune_norm`, `code_postal`
  - identifiants : `siret`, `siren`
  - utilisé pour le rapprochement adresse → SIRET/SIREN sur les lignes parcelle, y compris en mode `--building-source osm`.

- **BDNB** : table configurable via `BDNB_BUILDINGS_TABLE` (défaut `public.bdnb_buildings`)
  - attendue : `batiment_groupe_id`, `geom_groupe` (EPSG:2154), `annee_construction`, `surface_habitable_logement`, `code_commune_insee`
  - (nouveau) pour le matching au niveau *building* : `BDNB_CONSTRUCTIONS_TABLE` (défaut `bdnb_2025_07_a_open_data_dep33.batiment_construction`)
    - attendue : `batiment_construction_id`, `batiment_groupe_id`, `geom_cstr` (EPSG:2154), `code_commune_insee`
    - `annee_construction` est enrichie via **FFO** (`batiment_groupe_ffo_bat.annee_construction`) joinée par `batiment_groupe_id` (pas de fallback DPE ici).

- **IRIS** : `public/geo/iris-bordeaux-metropole.geojson` (servi en `/geo/…`)
  - jointure : centroïde de parcelle → “within” IRIS

- **POI OpenStreetMap (optionnel)** : `public.osm_poi` (schéma [`data-pipeline/sql/004_osm_poi.sql`](../data-pipeline/sql/004_osm_poi.sql))
  - remplissage : script [`data-pipeline/matching_v5/import_osm_poi.py`](../data-pipeline/matching_v5/import_osm_poi.py) à partir d’un extrait `.osm.pbf` (voir [`data-pipeline/README.md`](../data-pipeline/README.md) section « POI OpenStreetMap »). Le schéma est **appliqué automatiquement** au lancement de l’import (inutile d’exécuter `psql` à la main si `psql` n’est pas installé).
  - jointure : pour chaque **parcelle retenue** à l’export (source bâtiment `bdnb` ou `osm`), les points `osm_poi` avec `ST_Within(geom, parcelle.geom)` (EPSG:4326), tri par distance au `PointOnSurface` de la parcelle, plafond **`--osm-poi-max`** (défaut 50).
  - attributs exportés (dérivés des tags OSM) : nom (`name` / `brand` / …), site (`website` / `contact:website`), téléphone (`phone` / `contact:phone`), type (`shop`, `amenity`, `craft`, etc. → `poi_type_label` avec libellés FR partiels).
  - désactivation : **`--no-osm-poi`** sur `run_matching_v5.py`. Table surchargée : variable d’environnement **`OSM_POI_TABLE`** (identifiants SQL validés).

- **Footprints bâtiments OpenStreetMap (optionnel, source géométrique V5)** : `public.osm_building_footprints` (schéma [`data-pipeline/sql/005_osm_building_footprints.sql`](../data-pipeline/sql/005_osm_building_footprints.sql))
  - remplissage : script [`data-pipeline/matching_v5/import_osm_buildings.py`](../data-pipeline/matching_v5/import_osm_buildings.py) à partir d’un extrait `.osm.pbf`.
  - activation dans V5 : `--building-source osm`.
  - matching OSM→BNDB : sélection du `batiment_construction` avec **plus grande aire d’intersection** (Approche A), auditée via `osm_match_status` (`matched` | `low_overlap` | `unmatched`) et `osm_bdnb_intersection_area_m2`.
  - seuils : `--osm-parcel-intersection-min-m2` (jointure OSM↔parcelle) et `--osm-bdnb-match-min-m2` (validation enrichissement BNDB).

- **Polygones landuse OpenStreetMap (recommandé avec `--building-source osm`)** : `public.osm_landuse_areas` (schéma [`data-pipeline/sql/006_osm_landuse_areas.sql`](../data-pipeline/sql/006_osm_landuse_areas.sql))
  - remplissage : [`data-pipeline/matching_v5/import_osm_landuse.py`](../data-pipeline/matching_v5/import_osm_landuse.py) sur le même `.osm.pbf` que les footprints ; scripts npm `pipeline:osm-landuse:schema` et `pipeline:osm-landuse:import`.
  - la table peut être **vide** (aucune zone retenue), mais le **schéma doit exister** pour lancer V5 en mode OSM (jointure spatiale ; valeurs `landuse` filtrées à l’import selon une liste configurable, voir `--allowed-landuse`).
  - surcharge : variable d’environnement **`OSM_LANDUSE_TABLE`** (identifiants SQL validés, comme `OSM_BUILDINGS_TABLE`).

## Règles de matching (building ↔ parcelle)

### Jointure spatiale

Pour associer les buildings BDNB aux parcelles, V5 utilise :

- `ST_Intersects(geom_building, geom_parcelle)` en EPSG:4326 pour détecter les chevauchements.
- `intersection_area_m2` (aire d'intersection reprojetée en EPSG:2154) pour arbitrer les affectations.

Un bâtiment peut chevaucher plusieurs parcelles. Dans ce cas, V5 applique une résolution métier explicite (voir section ci-dessous) au lieu d'exclure le bâtiment du flux parcelle.

### Résolution des buildings multi-passerelles (`partage`)

Quand un `batiment_construction_id` intersecte plusieurs passerelles :

1. on tag le building en `matching_status = partage`;
2. on compare les SIREN de chaque passerelle via PPM;
3. si des SIREN sont communs à toutes les passerelles, on retient **un SIREN unique** : celui qui a le plus de lignes PPM (`rows`);
4. puis on affecte le building à **une seule** passerelle gagnante (celle avec la plus grande `intersection_area_m2`, tie-break stable sur la clé parcelle);
5. s'il n'y a aucun SIREN commun, on applique directement l'affectation unique par `intersection_area_m2`.

Exemple ciblé : `bdnb-bg-5TVB-LQ8V-PY94:1` (chevauchement HC 0034 + passerelle voisine) suit ce flux `partage`.

## Granularité des sorties

Le script V5 sait produire 2 grains :

- **`grain=parcelle` (passerelle)** : regroupement des buildings unitaires sur une parcelle
- **`grain=building`** : buildings multi-parcelles (optionnel)

En pratique, l’usage courant est de sortir **les parcelles uniquement** (passerelles), car c’est le support du lien PPM.

## Filtre principal

On conserve uniquement les parcelles dont la **somme des footprints** des bâtiments (m²) est **> 1000** :

- paramètre : `--min-parcelle-footprint-sum-m2` (défaut 400)

Le script npm `pipeline:matching-v5:run` applique ce filtre par défaut.

## Adresse passerelle (PPM)

### `passerelle_address`

Adresse au niveau **parcelle**, calculée comme l’**adresse la plus fréquente** observée dans `parcelles_personnes_morales` pour la parcelle :

```
numero_voirie + indice_repetition + nature_voie + nom_voie, nom_commune
```

Important :

- c’est **l’adresse passerelle** (PPM), **pas** une adresse “SIREN” enrichie via BAN / SIRENE.
- si une parcelle n’a **aucune ligne PPM**, alors `passerelle_address` reste vide (pas de fallback à ce stade).

### `passerelle_addresses_json`

JSON listant les candidats “par SIREN” (quand les SIREN sont valides), avec l’adresse “best” pour chaque SIREN + compte de lignes.

### Rapprochement PPM → `scout_etablissements` (fuzzy + numéro)

- **Candidats** : voie **exacte** ou **sous-chaîne** comme avant ; si peu de résultats, **rapidfuzz** (`WRatio`) ajoute les libellés de voie de la commune avec un score **≥ 80** (orthographe proche, libellés différents).
- **Voie dans le score** : exact > partiel > **fuzzy** (`voie_fuzzy_<ratio>` dans `matching_reason` si la voie ne matche qu’approximativement).
- **`street_number_match_set`** : plages du type `12-14` → ensemble `{12, 14}` ; bonus **match / zéros à gauche** (`008` vs `8`) ou **ratio** sur le numéro (`numero_fuzzy`) ; un écart fort applique une **pénalité** `numero_mismatch` (le SIRET n’est plus exclu).
- **Indice** : BIS / TER / QUATER — accord = bonus ; désaccord = **pénalité** `indice_mismatch` (plus d’exclusion systématique).
- **Seuil** : score minimal **52** pour retenir un SIRET (la passerelle a toujours un numéro si le matching tourne).
- **Numéro passerelle obligatoire** : sans `numero_voirie` exploitable (ensemble `passerelle_numero_match_set` / `passerelle_numero_norm` vide après agrégat PPM), **aucun** appariement SIRENE n’est tenté (`status_technique = no_passerelle_numero`). Pas de repli sur le seul texte de l’adresse concaténée.
- **Établissements sans numéro** : les lignes `scout_etablissements` avec `numero_norm` vide **ne sont pas** candidates (non comparées).

Champs d’export utiles pour le contrôle : `passerelle_indice_norm`, `passerelle_numero_match` (liste triée, séparée par des virgules).

## Sorties

### CSV

- fichier : `data-pipeline/out/matching/v5/matching_v5.csv`
- une ligne par entité (principalement `grain=parcelle`)

Champs clés (properties) :

- `grain`
- `code_insee`, `section`, `numero_norm`
- `code_iris`, `nom_iris`
- `nb_batiments`
- `footprint_sum_m2` (somme des footprints BDNB des bâtiments associés)
- `siren_status` : `none | single | multiple` (technique PPM)
- `status_metier` : `none | single | shared` (résultat du rapprochement adresse -> établissements)
- `status_technique` : `source_missing | no_address | no_address_tokens | no_passerelle_numero | no_candidate | low_confidence | matched`
- `siret_count`, `sirets_json`, `sirens_json`
- `matching_confidence`, `matching_reason`
- `passerelle_address`, `passerelle_indice_norm`, `passerelle_numero_match`, `passerelle_addresses_json`
- `matching_status` : `mono | partage`
- `matching_decision` : `mono | shared_siren | unique_by_intersection`
- `matching_siren_selected` : SIREN retenu pour un cas `partage` avec SIREN commun
- `matching_debug_json` : détails de la décision (`winner_parcelle`, SIREN communs, scores d'intersection)
- `buildings_json` : liste des buildings associés (dont `batiment_construction_id`, `batiment_groupe_id`, `annee_construction`, `footprint_m2`, etc.)
- `buildings_json` / `building_geometries_json` incluent aussi (si `--building-source osm`) : `osm_building_id`, `osm_match_status`, `osm_bdnb_intersection_area_m2`, `osm_address_text`, `bdnb_batiment_construction_id`, ainsi que **`zone_tag`** (valeur OSM brute), **`zone_source`** (`landuse` \| `building_use` \| `building` \| `none`) et **`landuse_intersection_area_m2`** (aire d’intersection empreinte × polygone `landuse` en m², EPSG:2154) lorsque la jointure spatiale avec `osm_landuse_areas` est disponible.
- champs d’audit **fallback Google** (si activé) : `google_fallback_attempted`, `google_fallback_success`, `google_fallback_group_id`, `google_anchor_address`, compteurs / traces (`google_nearby_status`, …)
- **POI OSM** (si table `osm_poi` présente et non `--no-osm-poi`) : `osm_pois_json` (tableau JSON normalisé), `osm_poi_count`, `osm_pois_status` (`ok` \| `skipped_no_table` \| `error` \| `disabled`), `osm_poi_truncated`, `osm_data_as_of` (max `imported_at` de `osm_poi` au moment du run). Lignes `grain=building` : `osm_pois_status=not_applicable`.

### GeoJSON

- fichier : `public/geo/matching-v5-33318.geojson`
- servi par Next.js en : `/geo/matching-v5-33318.geojson`
- `Feature.id` = `scout_v5_id`

### Postgres (Neon / local)

- Schéma : [`data-pipeline/sql/003_scout_matching_v5_features.sql`](../data-pipeline/sql/003_scout_matching_v5_features.sql) — table **`public.scout_matching_v5_features`** (surchargeable via `SCOUT_MATCHING_V5_TABLE`, même logique que `BDNB_CONSTRUCTIONS_TABLE`).
- Après export CSV/GeoJSON, écriture optionnelle : **`--write-postgres`** sur `run_matching_v5.py` — `DELETE` des lignes du **`--code-insee`** concerné, puis `INSERT` (géométrie via `ST_GeomFromGeoJSON`, propriétés complètes en **`properties_json`**).
- **`--postgres-source-run`** : valeur de la colonne `source_run` (défaut : `matching_v5:<code_insee>`).
- API Next (auth identique aux autres routes matching) : **`GET /api/matching-v5/features`** — **`code_insee`** (optionnel) et/ou **bbox** obligatoire ensemble (`minLat`, `maxLat`, `minLng`, `maxLng`) : sans `code_insee`, toutes les communes présentes dans la table intersectant la bbox sont renvoyées (plafond **`limit`** à 5000). Réponse **`FeatureCollection`** consommable par `parseMatchingV5GeoJsonFeatureCollection`.
- Solar Scout : source **GeoJSON statique** par défaut ; bascule **Postgres** avec **`NEXT_PUBLIC_SCOUT_MATCHING_V5_SOURCE=postgres`** ou **`?discovery=db`** (ou `postgres`). Code INSEE côté client : **`NEXT_PUBLIC_SCOUT_MATCHING_V5_CODE_INSEE`** (défaut `33318`). En mode Postgres, la carte recharge les entités quand la **bbox** change (debounce déjà côté carte).

## Exécution

## Étape A — Full local (BDNB dep33_csv.zip → Postgres local → Matching V5)

Cette étape met en place le **matching V5 au niveau building** en restant **100 % local**, en s’appuyant sur :

- le zip BDNB : `datasource/bdnb/dep33_csv.zip`
- Postgres local : `LOCAL_DATABASE_URL` (dans `.env.local`)

### A1) Extraire les CSV nécessaires depuis le zip BDNB

Le zip contient notamment :

- `csv/batiment_groupe_ffo_bat.csv` (année de construction FFO)
- `csv/batiment_construction.csv` (métadonnées de construction — **sans géométrie WKT dans ce millésime**)

Commande (extrait uniquement les fichiers utiles) :

```bash
mkdir -p datasource/bdnb/dep33_extract
unzip -o datasource/bdnb/dep33_csv.zip \
  "csv/batiment_construction.csv" \
  "csv/batiment_groupe_ffo_bat.csv" \
  -d datasource/bdnb/dep33_extract
```

### A2) Import “building unitaire” dans Postgres local

Commande :

```bash
npm run import:bdnb-constructions:local
```

Ce script :

- importe `public.batiment_groupe_ffo_bat` depuis `batiment_groupe_ffo_bat.csv`
- crée `public.batiment_construction` **en dérivant la géométrie depuis** `public.bdnb_buildings.geom_groupe`
  - chaque polygone d’un `MultiPolygon` devient un “building” unitaire
  - id synthétique : `batiment_construction_id = "<batiment_groupe_id>:<idx>"`
  - géométrie : `geom_cstr` en **EPSG:2154**

### A3) Variables d’environnement (local)

Dans `.env.local` (exemple) :

```bash
LOCAL_DATABASE_URL=postgresql://bdnb:bdnb@127.0.0.1:5433/bdnb_local
BDNB_BUILDINGS_TABLE=public.bdnb_buildings
BDNB_CONSTRUCTIONS_TABLE=public.batiment_construction
```

### A4) Lancer le matching V5

```bash
npm run pipeline:matching-v5:run
```

### A5) (Nouveau) Alimenter la table établissements dédiée

```bash
./data-pipeline/python/.venv-v311/bin/python data-pipeline/python/import_etablissements_to_postgres.py \
  --input "/chemin/vers/StockEtablissement_utf8.csv" \
  --apply-schema
```

Sorties :

- `data-pipeline/out/matching/v5/matching_v5.csv`
- `public/geo/matching-v5-33318.geojson` (servi en `/geo/matching-v5-33318.geojson`)

### Script npm (recommandé)

```bash
npm run pipeline:matching-v5:run
```

Avec fallback Google (clé `GOOGLE_MAPS_API_KEY` ou `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` dans `.env.local`) :

```bash
npm run pipeline:matching-v5:run-google
```

**Progression** : le script écrit les jalons sur **stderr** (`[v5] …`) : volumes jointure spatiale, avancement du scan parcelles / matching PPM, groupes Google (Parc Industriel) avec **cumul des appels** Nearby / Details / api.gouv. Options : `--progress-every N` (défaut 250, `0` = jalons seulement sans sous-étapes), `--quiet` (désactive la progression ; si `--quiet` et `--google-fallback`, le bilan Google est aussi recopié sur stderr).

### Script python (direct)

```bash
./data-pipeline/python/.venv-v311/bin/python data-pipeline/matching_v5/run_matching_v5.py \
  --code-insee 33318 \
  --min-parcelle-footprint-sum-m2 400
```

Avec écriture Postgres (après `psql` / migration du fichier `003_scout_matching_v5_features.sql`) :

```bash
./data-pipeline/python/.venv-v311/bin/python data-pipeline/matching_v5/run_matching_v5.py \
  --code-insee 33318 \
  --write-postgres
```

## Visualisation dans Solar Scout

### Onglet

Un onglet **Match V5** existe dans Solar Scout :

- affiche la liste des entités (principalement parcelles)
- affiche le détail (dont `passerelle_address` et `passerelle_addresses_json`)

### Polygones sur la carte

- le polygone **parcelle** vient du **GeoJSON statique** ou, en mode Postgres, de **`GET /api/matching-v5/features`**
- lors de la sélection d’une parcelle, les polygones **bâtiments** associés sont chargés via :
  - `GET /api/matching-v5/buildings?ids=...`
  - `ids` correspond désormais à des **`batiment_construction_id`** (avec compat fallback si un ancien export contient encore des `batiment_groupe_id`).

## Fallback Google (`--google-fallback`)

Activable en ligne de commande sur `run_matching_v5.py`. Chaîne : **Nearby Search → Place Details → recherche api.gouv (filtrée par code postal) → re-match local** sur `scout_etablissements`, via une adresse d’ancrage synthétisée (`google_poi_fallback_v5.py`, aligné sur le front).

### Conditions métier

- **IRIS** : le fallback n’est déclenché que pour une **composante connexe** de parcelles **déjà retenues à l’export** (même filtre footprint que les lignes CSV) dans laquelle **au moins une** parcelle a `nom_iris` égal à **Parc Industriel** (comparaison insensible à la casse, libellé IRIS Bordeaux Métropole).
- **Déclenchement** : la composante devient éligible dès qu’elle contient au moins une parcelle en IRIS **Parc Industriel** (pas de condition sur `siret_count` / `status_technique`).
- **Signal OSM** : si la composante contient **au moins 1 POI OSM distinct** avec `website` non vide (tags `website` / `contact:website` / `url` normalisés), le fallback Google est **ignoré** pour cette composante.
  - le comptage est fait sur l’union des parcelles du groupe, avec dédoublonnage par paire `(osm_type, osm_id)`.
- **Groupement « domino »** : deux parcelles exportées sont reliées si un même `batiment_construction_id` intersecte les deux ; la relation est **transitive** (chaîne A–B–C → une seule composante).
- **Un appel par composante** : géométrie passée à Google = **union Shapely** des polygones parcelle des membres exportés du groupe ; un seul centroïde pour Nearby. Les compteurs `nearby` / `details` / `api_gouv` du log sont incrémentés **une fois par groupe** ayant tenté l’appel.
- **Propagation** : le résultat du re-match local (même ancrage pour tout le groupe) est appliqué à **chaque** parcelle exportée de la composante, y compris si son IRIS n’est pas « Parc Industriel » (tant qu’au moins une autre parcelle du groupe l’est).
- **Traçabilité** : colonne `google_fallback_group_id` (hash stable des clés parcelle du groupe) renseignée sur les lignes avec `google_fallback_attempted = true`.

### Hors script

- L’API Next `POST /api/matching-v5/google-poi-fallback` reste un outil de test manuel ; elle n’applique pas automatiquement les mêmes règles IRIS / groupement que le pipeline.

## Points d’attention / prochaines étapes

- Les parcelles sans PPM n’auront pas d’adresse passerelle (c’est attendu).
- Le fallback Google consomme des quotas Google et api.gouv ; limiter son usage aux besoins (déjà filtré IRIS Parc Industriel + groupes exportés + OSM avec lien).

