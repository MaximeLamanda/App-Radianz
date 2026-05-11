# Procédure d'ajout d'une commune (Discovery / Matching V5)

Document de référence **unique** pour alimenter Discovery / Matching V5 (communes INSEE) sur Solar View. Toute autre documentation (data-pipeline, Neon, Matching V5) doit pointer vers ce fichier pour ce sujet précis.

> Périmètre : **Discovery / Matching V5 uniquement**. Côté **résultat** (`scout_matching_v5_features`, Neon), on reste indexé par **code INSEE** (une commune = un INSEE, arrondissements distincts). Côté **préparation des données**, en particulier avec **OSM** et le zip **BDNB départemental**, le fonctionnement naturel est plutôt **département par département** : voir § 1.1.

---

## 1. Décisions structurantes

- **On n'envoie sur Neon qu'une seule table** : `public.scout_matching_v5_features` (alimentée colonne `building_geometries_json` comprise).  
  → Pas de transfert de `batiment_construction`, `batiment_groupe_ffo_bat`, `bdnb_buildings`, `cadastre_france_feuilles_geom`, `parcelles_personnes_morales`, `scout_etablissements`, ni tables OSM locales (`osm_poi`, `osm_building_footprints`, `osm_landuse_areas`, etc.). Ces tables restent **locales** (Docker) pour le calcul.
- **Local Docker first, puis transfert vers Neon.** Le matching V5 et le backfill `building_geometries_json` se font **toujours sur le Postgres local** ; seul le résultat est poussé sur Neon.
- **Local : on accumule les communes** (`--append` obligatoire pour BDNB, sinon DROP/CREATE écrase tout).
- **Neon : on accumule par `code_insee`** (idempotent, DELETE/INSERT par code INSEE côté pipeline).
- **Ajout incrémental côté V5 / Neon** : pour une commune donnée, chaque run ne cible que son **`--code-insee=<INSEE>`** (matching, backfill, `DELETE`/`INSERT` Neon) — sans toucher aux autres INSEE déjà présents. Les **imports OSM du département** (§ 1.1) restent en amont, **une fois par PBF / dep**.
- **GeoJSON statique** `public/geo/matching-v5-<INSEE>.geojson` : **déprécié**. Discovery utilise 100 % Postgres (`/api/matching-v5/features`). On ne crée plus de fichier statique par commune.
- **CSV BDNB extraits du zip département** : 5 fichiers, liste figée (étape 2) — le millésime open data est **déjà découpé par département** (`dep<DEP>_csv.zip`).

### 1.1 Données : département d’abord (OSM), exécution V5 : commune par commune

Avec **`--building-source osm`** ([`docs/MATCHING-V5.md`](MATCHING-V5.md)), les emprises bâtiments viennent des tables **`osm_building_footprints`** (et idéalement **`osm_landuse_areas`**). Ces imports lisent un **`.osm.pbf`** (Geofabrik régional / national, ou extrait **bbox / département** via la CLI `osmium`). En pratique :

- **Une passe par département (ou par extrait PBF qui couvre tout le département)** pour `pipeline:osm-buildings:*`, `pipeline:osm-landuse:*` et, si besoin, `pipeline:osm-poi:*` — pas une relance « une commune = un import OSM ». Les scripts d’import acceptent souvent **`--truncate`** : la table reflète alors **le dernier PBF chargé** ; choisir un PBF dont l’emprise couvre **toutes** les communes du département que tu comptes matcher avant de truncater.
- **BDNB** (zip `dep<DEP>_csv.zip`, étapes 2–4) reste **au niveau département** : un extract, imports avec **`--append`** pour accumuler les communes du dep dans `bdnb_buildings` / `batiment_construction` sans tout écraser.
- **Cadastre et PPM** : chargement **par commune** (`--code-insee=<INSEE>`) ou, si tu disposes d’un fichier couvrant tout le département, tu peux enchaîner les INSEE du dep sans re-télécharger le PBF OSM.
- **Matching V5, backfill et transfert Neon** : le script `run_matching_v5.py` prend **un seul `--code-insee` par invocation** — tu répètes étapes 6–8 pour chaque commune cible **après** avoir posé les données départementales (OSM + BDNB dep + IRIS adapté au périmètre).

En résumé : **préparer et stocker large (département / PBF)** ; **produire et pousser fin (commune / INSEE)**.

---

## 2. Glossaire

- **INSEE** : code commune à 5 caractères (ex. `33318` Pessac, `75056` Paris, `75101` Paris 1er). Le pipeline V5 traite les arrondissements comme des communes distinctes.
- **BDNB** : Base de Données Nationale des Bâtiments (open data). Source des **métadonnées** bâti (et des emprises si `--building-source` reste sur BDNB). Avec **`--building-source osm`**, les **empreintes** viennent d’OSM ; BDNB sert notamment à l’**enrichissement** (ex. intersection `batiment_construction`, FFO).
- **FFO** : Fichiers Fonciers (millésimes annuels). Source de l'année de construction et des usages bâti, jointe à BDNB par `batiment_groupe_id`.
- **PPM** : « Parcelles Personnes Morales » (passerelle parcelle ↔ entreprise / SIREN), table `public.parcelles_personnes_morales`.
- **V5** : pipeline de matching `data-pipeline/matching_v5/run_matching_v5.py` produisant `public.scout_matching_v5_features`.
- **IRIS** : maillage statistique INSEE (sous-commune). Utilisé pour qualifier les parcelles (`code_iris`, `nom_iris` dans `properties_json`).
- **PBF OSM** : fichier binaire OpenStreetMap (`.osm.pbf`). Découpe **département** ou région conseillée pour limiter taille et temps d’import ; voir [data-pipeline/README.md](../data-pipeline/README.md) (OSM PBF, `osmium extract`).

---

## 3. Architecture du flux

```mermaid
flowchart TD
    Zip["Zip BDNB departement<br/>datasource/bdnb/depXX_csv.zip"]
    Extract["Extraction des 5 CSV<br/>datasource/bdnb/depXX_extract/csv"]
    LocalSupport["Postgres Docker local<br/>cadastre + PPM + scout_etablissements<br/>(filtres code_insee)"]
    LocalBdnb["Postgres Docker local<br/>bdnb_buildings + batiment_construction +<br/>batiment_groupe_ffo_bat (--append)<br/>+ si OSM: osm_building_footprints,<br/>osm_landuse_areas (import PBF dep)"]
    IrisLocal["GeoJSON IRIS<br/>public/geo/iris-...geojson"]
    MatchLocal["run_matching_v5.py<br/>--code-insee=&lt;INSEE&gt; --write-postgres<br/>(option: --building-source osm)<br/>(cible: LOCAL_DATABASE_URL)"]
    Backfill["backfill_building_geometries_v5.py<br/>--code-insee=&lt;INSEE&gt;<br/>(cible: LOCAL_DATABASE_URL)"]
    LocalScout["Postgres local<br/>scout_matching_v5_features<br/>(building_geometries_json rempli)"]
    Transfer["Transfert local -> Neon<br/>(psql COPY filtré ou pg_dump table)"]
    Neon["Neon: scout_matching_v5_features<br/>filtre code_insee"]
    Discovery["Discovery (app)<br/>GET /api/matching-v5/features"]

    Zip --> Extract --> LocalBdnb
    Extract --> LocalSupport
    LocalSupport --> MatchLocal
    LocalBdnb --> MatchLocal
    IrisLocal --> MatchLocal
    MatchLocal --> LocalScout
    LocalScout --> Backfill
    Backfill --> LocalScout
    LocalScout --> Transfer --> Neon --> Discovery
```

---

## 4. Prérequis (à valider avant d'ajouter la première commune)

### 4.1 Environnement local

- Docker Desktop lancé, conteneur PostGIS démarré : `npm run postgres:local:up`.
- `.env.local` à la racine contenant **au minimum** :
  - `LOCAL_DATABASE_URL=postgresql://bdnb:bdnb@127.0.0.1:5433/bdnb_local`
  - `Radianz_DATABASE_URL_UNPOOLED=postgresql://...neon.tech...?sslmode=require` (URL Neon directe pour le transfert).
- Schémas appliqués sur le Postgres local :
  - [data-pipeline/sql/001_scout_schema.sql](../data-pipeline/sql/001_scout_schema.sql)
  - [data-pipeline/sql/003_scout_matching_v5_features.sql](../data-pipeline/sql/003_scout_matching_v5_features.sql)
- Schéma appliqué sur Neon :
  - [data-pipeline/sql/003_scout_matching_v5_features.sql](../data-pipeline/sql/003_scout_matching_v5_features.sql) (pour la table cible et les index `code_insee`).
- Outils ligne de commande : `unzip`, `psql`, `node`, `python3` (venv géré par les scripts npm).

### 4.2 Sources de données

- Zip BDNB du département de la commune : `datasource/bdnb/dep<DEP>_csv.zip` (où `<DEP>` est le code département à 2 caractères, ex. `33`, `75`, `06`).
- Sirene établissement (CSV / Parquet national `StockEtablissement_utf8.csv`) — chargé une seule fois pour la France entière (cf. § 5.4).
- Cadastre national `cadastre-france-feuilles.json.gz` — filtrable par INSEE.
- PPM Parquet `datasource/parcelles-personnes-morales/parcelles-personnes-morales-latest.parquet` — filtrable par INSEE.
- IRIS GeoJSON couvrant la commune (cf. § 5.5).
- Les fichiers peuvent être stockés **hors repo** : les scripts acceptent un **chemin absolu local** (ex. `/Volumes/data/parcelles-personnes-morales-latest.parquet`).

### 4.3 État Neon

- La table `public.scout_matching_v5_features` existe (cf. schéma SQL ci-dessus).
- Les anciennes tables BDNB éventuellement présentes sur Neon (`batiment_construction`, `batiment_groupe_ffo_bat`, `bdnb_buildings`, etc.) peuvent être supprimées une fois ce flux en place : voir § 8 « Nettoyage Neon (option B) ».

---

## 5. Étapes numérotées

> Remplacer `<INSEE>` par le code INSEE de la commune (ex. `33522`) et `<DEP>` par son département (ex. `33`).

### Étape 1 — Identifier la commune

- Récupérer le **code INSEE** sur [https://insee.fr](https://www.insee.fr/fr/information/2114819).
- Noter le **code département** correspondant (`33`, `75`, …) — il détermine le zip BDNB à extraire.

### Étape 2 — Extraire les 5 CSV BDNB du zip département

Cinq fichiers extraits, **liste figée** :

```bash
mkdir -p datasource/bdnb/dep<DEP>_extract
unzip -o datasource/bdnb/dep<DEP>_csv.zip \
  "csv/batiment_groupe.csv" \
  "csv/batiment_groupe_ffo_bat.csv" \
  "csv/batiment_groupe_synthese_propriete_usage.csv" \
  "csv/batiment_groupe_dpe_representatif_logement.csv" \
  "csv/batiment_construction.csv" \
  -d datasource/bdnb/dep<DEP>_extract
```

Les fichiers atterrissent sous `datasource/bdnb/dep<DEP>_extract/csv/...`.

Important :

- Cette extraction sert de **préparation de dataset** départemental. Elle n'est **pas** à refaire à chaque commune si `dep<DEP>_extract/csv` est déjà présent et à jour.
- La ré-extraction n'est utile qu'en cas de mise à jour du zip BDNB départemental, d'absence des fichiers, ou de correction d'un extract incomplet/corrompu.

### Étape 3 — Importer BDNB local (`bdnb_buildings`) avec `--append`

```bash
node scripts/import-bdnb-postgres.mjs \
  --data-dir=datasource/bdnb/dep<DEP>_extract/csv \
  --commune=<INSEE> \
  --append
```

Référence : [scripts/import-bdnb-postgres.mjs](../scripts/import-bdnb-postgres.mjs).

- `--append` est **obligatoire** : sans ce flag, le script passe en mode `replace` (DROP/CREATE) et **efface** les communes déjà importées.
- Cible : `BDNB_BUILDINGS_TABLE` (défaut `public.bdnb_buildings`), conflit géré par `ON CONFLICT (batiment_groupe_id) DO NOTHING`.

### Étape 4 — Dériver `batiment_construction` localement

```bash
node scripts/import-bdnb-constructions-local.mjs \
  --data-dir=datasource/bdnb/dep<DEP>_extract
```

> Note : le script npm `npm run import:bdnb-constructions:local` est codé en dur sur `dep33_extract`. Pour un autre département, **invoquer le script directement** comme ci-dessus avec le bon `--data-dir`.

Référence : [scripts/import-bdnb-constructions-local.mjs](../scripts/import-bdnb-constructions-local.mjs).

Ce script :

- charge `public.batiment_groupe_ffo_bat` depuis `batiment_groupe_ffo_bat.csv`,
- crée/complète `public.batiment_construction` en dérivant la géométrie depuis `bdnb_buildings.geom_groupe` (un building unitaire = un polygone du `MultiPolygon`).

### Étape 5 — Charger les données support locales pour la commune

#### 5.1 Cadastre

```bash
./data-pipeline/python/.venv-v311/bin/python data-pipeline/python/import_cadastre_france_feuilles.py \
  --geojson-gz "/chemin/local/cadastre-<DEP>-parcelles.json.gz" \
  --code-insee=<INSEE> \
  --apply-schema \
  --truncate
```

- `--truncate` ici **ne TRUNCATE PAS toute la table** : combiné à `--code-insee`, il fait un `DELETE FROM cadastre_france_feuilles_geom WHERE code_insee = <INSEE>` (cf. l. 113-118 de [data-pipeline/python/import_cadastre_france_feuilles.py](../data-pipeline/python/import_cadastre_france_feuilles.py)).
- Idempotent (UPSERT sur `(code_insee, section, numero_norm)`).
- Exemple repo (dep 33) : `datasource/cadastre/cadastre-33-parcelles.json.gz`.

#### 5.2 PPM (parcelles personnes morales)

```bash
./data-pipeline/python/.venv-v311/bin/python data-pipeline/python/import_parcelles_personnes_morales.py \
  --parquet "/chemin/local/parcelles-personnes-morales-latest.parquet" \
  --code-insee=<INSEE> \
  --apply-schema \
  --truncate
```

Idempotent par `code_insee` : `--truncate` supprime uniquement les lignes du même INSEE avant insertion.
- Exemple repo : `datasource/parcelles-personnes-morales/parcelles-personnes-morales-latest.parquet`.

#### 5.3 SIRENE établissements (`scout_etablissements`)

`scout_etablissements` est chargée en bloc à partir du dump Sirene **national** (pas de filtre par INSEE dans le script). Si ce n'est pas déjà fait, lancer **une seule fois** :

```bash
./data-pipeline/python/.venv-v311/bin/python data-pipeline/python/import_etablissements_to_postgres.py \
  --input "/chemin/vers/StockEtablissement_utf8.csv" \
  --apply-schema
```

Le script fait un UPSERT par `siret`, donc rejouer le chargement sur un dump plus récent met simplement à jour les colonnes.
- Exemple local filtré département : `datasource/Siren/StockEtablissement_dep33_utf8.csv`.

> Si l'étape n'a jamais été faite et que la machine ne peut pas tenir un dump national complet, filtrer le CSV en amont par `codeCommuneEtablissement IN ('<INSEE>', ...)` et réutiliser le même script.

#### 5.4 OSM : footprints, landuse, POI (optionnel, **logique département**)

Même principe que le § 1.1 : **un import OSM par extrait PBF** (souvent **tout le département** ou la région découpée avec `osmium`), pas par commune.

- **Footprints bâtiments** (requis si `--building-source osm`) : [data-pipeline/README.md](../data-pipeline/README.md) — `npm run pipeline:osm-buildings:schema` puis `pipeline:osm-buildings:import` (adapter `--input` vers ton `.osm.pbf` dans `package.json` ou appeler le script Python avec le chemin du PBF du département).
- **Landuse** (recommandé avec OSM) : `pipeline:osm-landuse:schema` / `pipeline:osm-landuse:import`, même PBF.
- **POI** (optionnel, `osm_pois_json`) : section « POI OpenStreetMap » du même README et [data-pipeline/sql/004_osm_poi.sql](../data-pipeline/sql/004_osm_poi.sql).

```bash
npm run pipeline:osm-poi:import
```

Ne pas relancer ces imports pour **chaque** commune du département si le PBF couvre déjà tout le dep.

#### 5.5 IRIS (limitation à connaître)

Le script V5 lit l'IRIS depuis un chemin **codé en dur** : `public/geo/iris-bordeaux-metropole.geojson` (cf. [data-pipeline/matching_v5/run_matching_v5.py](../data-pipeline/matching_v5/run_matching_v5.py) l. 487).

Conséquence pour les communes **hors Bordeaux Métropole** : il faut **remplacer** ce fichier par un GeoJSON IRIS contenant la commune visée, **avant** de lancer le matching V5. Sources possibles :

- IRIS open data INSEE / IGN (national, à filtrer ; export par département disponible).
- Bibliothèques géographiques (geopandas / mapshaper) pour filtrer par `code_insee`.

Le GeoJSON doit conserver les colonnes `code_insee`, `code_iris`, `nom_iris`. Conserver une copie du fichier original (`iris-bordeaux-metropole.geojson.bak`) avant remplacement si nécessaire.

> Évolution future possible (hors scope ici) : paramétrer le chemin via une variable d'environnement et/ou héberger un IRIS national filtré par commune au moment du run.

### Étape 6 — Lancer le matching V5 sur le Postgres **local**

Commande recommandée (direct Python, cible explicite) :

```bash
bash -lc 'set -a; [ -f .env.local ] && . ./.env.local; set +a; \
./data-pipeline/python/.venv-v311/bin/python data-pipeline/matching_v5/run_matching_v5.py \
  --code-insee=<INSEE> \
  --min-parcelle-footprint-sum-m2 400 \
  --write-postgres \
  --no-geojson'
```

Avec emprises **OSM** (après § 5.4 et tables locales prêtes), ajouter notamment **`--building-source osm`** sur cette même commande. Détails et seuils : [`docs/MATCHING-V5.md`](MATCHING-V5.md).

- `LOCAL_DATABASE_URL` est utilisé en priorité par le pipeline (cf. [scripts/lib/resolve-database-url.mjs](../scripts/lib/resolve-database-url.mjs)) → l'écriture va bien sur le Postgres local.
- `--write-postgres` fait un `DELETE FROM scout_matching_v5_features WHERE code_insee=<INSEE>` puis un `INSERT` (idempotent par commune).
- `--no-geojson` évite de regénérer un fichier statique (déprécié).
- Vérification immédiate recommandée : les logs doivent commencer par `Commune INSEE <INSEE>`.
- Ne pas utiliser `npm run pipeline:matching-v5:run -- --code-insee=<INSEE>` tant que le script npm ne relaie pas correctement les arguments : selon le shell, cela peut relancer la commune par défaut (`33318`) au lieu de la cible.

### Étape 7 — Backfill `building_geometries_json` localement

```bash
npm run pipeline:matching-v5:backfill-building-geometries -- \
  --code-insee=<INSEE>
```

Référence : [data-pipeline/matching_v5/backfill_building_geometries_v5.py](../data-pipeline/matching_v5/backfill_building_geometries_v5.py).

À l'issue de cette étape, les lignes `grain='parcelle'` du Postgres local ont leur colonne `building_geometries_json` remplie avec les polygones bâtiments — Discovery pourra les afficher sans appeler `/api/matching-v5/buildings`.

### Étape 8 — Transférer la commune vers Neon

> On ne pousse **que** les lignes `code_insee=<INSEE>` de `scout_matching_v5_features`. Aucune autre table n'est transférée.

#### Méthode recommandée : `psql … COPY` (ciblé, idempotent)

Depuis la racine du repo, en s'appuyant sur les variables `.env.local` :

```bash
LOCAL_URL="$(grep -E '^LOCAL_DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')"
NEON_URL="$(grep -E '^Radianz_DATABASE_URL_UNPOOLED=' .env.local | cut -d= -f2- | tr -d '"')"
INSEE=<INSEE>

# 1) Idempotence Neon : supprimer la commune cible avant insertion
psql "$NEON_URL" -c "DELETE FROM public.scout_matching_v5_features WHERE code_insee='$INSEE';"

# 2) Copier les lignes locales vers Neon
psql "$LOCAL_URL" -c "\\copy (SELECT scout_v5_id, ST_AsEWKT(geom), grain, code_insee, section, numero_norm, nb_batiments, footprint_sum_m2, siret_count, status_technique, status_metier, matching_confidence, siren_status, building_geometries_json::text, properties_json::text, source_run, imported_at FROM public.scout_matching_v5_features WHERE code_insee='$INSEE') TO STDOUT" \
| psql "$NEON_URL" -c "\\copy public.scout_matching_v5_features (scout_v5_id, geom, grain, code_insee, section, numero_norm, nb_batiments, footprint_sum_m2, siret_count, status_technique, status_metier, matching_confidence, siren_status, building_geometries_json, properties_json, source_run, imported_at) FROM STDIN"
```

**Sans `psql` installé** : `npm run neon:transfer:v5-features:dry -- --code-insee=<INSEE>` puis `npm run neon:transfer:v5-features -- --code-insee=<INSEE>` ([`scripts/neon-transfer-scout-v5-features-by-insee.mjs`](../scripts/neon-transfer-scout-v5-features-by-insee.mjs)) — même logique `DELETE` puis insert depuis `LOCAL_DATABASE_URL` vers Neon.

> Le `ST_AsEWKT(geom)` côté source garantit que `geom` est restauré avec son SRID 4326 sur Neon. Les colonnes `building_geometries_json` et `properties_json` sont sérialisées en texte pour traverser le pipe.

#### Méthode alternative : `pg_dump` table-only

Pour transférer la table entière (toutes les communes accumulées localement) :

```bash
pg_dump --data-only --table=public.scout_matching_v5_features \
  -h 127.0.0.1 -p 5433 -U bdnb -d bdnb_local \
  -Fc -f var/scout-v5-features.dump

pg_restore --no-owner --no-acl --data-only \
  -d "$Radianz_DATABASE_URL_UNPOOLED" \
  var/scout-v5-features.dump
```

> Cette méthode est **non idempotente** sur les conflits de `scout_v5_id` : utiliser uniquement après `TRUNCATE public.scout_matching_v5_features` côté Neon (reset complet), ou s'assurer que les lignes existantes ont d'abord été supprimées.

#### Méthode lourde (mirroir complet) — non recommandée pour cette procédure

`npm run neon:transfer` dump et restaure **tout** le Postgres local sur Neon. Utile pour un reset/miroir initial, pas pour ajouter une commune. Voir [docs/NEON-MIGRATION-DOCKER.md](NEON-MIGRATION-DOCKER.md).

---

## 6. Validation

Exécuter ces vérifications après l'étape 8.

### 6.1 SQL (Neon)

```sql
-- 1) La commune existe
SELECT COUNT(*) AS rows
FROM public.scout_matching_v5_features
WHERE code_insee = '<INSEE>';
-- attendu : > 0

-- 2) Les bâtiments sont enrichis (preuve du backfill)
SELECT COUNT(*) AS rows_with_buildings
FROM public.scout_matching_v5_features
WHERE code_insee = '<INSEE>'
  AND grain = 'parcelle'
  AND jsonb_typeof(building_geometries_json) = 'array'
  AND jsonb_array_length(building_geometries_json) > 0;
-- attendu : > 0 et proche du nombre total de parcelles avec bâtiments
```

### 6.2 Application Discovery

- Ouvrir `/discovery`, recentrer la carte sur la commune.
- Vérifier que les **parcelles** s'affichent.
- Vérifier que les **polygones bâtiments** s'affichent **sans** requête `POST /api/matching-v5/buildings` dans l'onglet Network du navigateur (signe que `building_geometries_json` est bien lu côté Postgres).

### 6.3 Contrôle anti-régression (commune par défaut)

Quand on ajoute une commune différente de `33318`, contrôler que le run n'a pas relancé la commune par défaut par erreur :

```sql
SELECT code_insee, COUNT(*) AS rows
FROM public.scout_matching_v5_features
WHERE code_insee IN ('<INSEE>', '33318')
GROUP BY code_insee
ORDER BY code_insee;
```

Attendu :

- `<INSEE>` : `rows > 0`.
- `33318` : pas de variation inattendue causée par l'opération d'ajout en cours.

---

## 7. Pièges « reliquat » à éviter

- **Oublier `--append` à l'étape 3** → le script BDNB passe en mode `replace`, écrase les communes déjà importées en local.
- **Relancer les étapes départementales lourdes à chaque commune** (extraction zip BDNB, **import OSM PBF**, landuse/POI) → inutile ; une fois le **dep** chargé, enchaîner uniquement les runs **`--code-insee=<INSEE>`** (et cadastre/PPM si tu ne les avais pas déjà pour cette commune).
- **Importer un PBF OSM trop petit puis `--truncate`** sur `osm_building_footprints` avant de matcher une autre commune du même département → la table ne contient plus que le dernier extrait ; préférer **un PBF couvrant tout le département** (ou stratégie sans truncate + upsert si tu adaptes les scripts).
- **Oublier l'étape 7 (backfill)** → Discovery retombe sur le fallback HTTP `/api/matching-v5/buildings`, qui exige les tables `batiment_construction` + `batiment_groupe_ffo_bat` sur Neon (donc casse l'option B).
- **Créer un fichier `public/geo/matching-v5-<INSEE>.geojson`** → déprécié, ne plus en générer. Le fichier historique `public/geo/matching-v5-33318.geojson` peut être conservé pour archive mais n'est plus consommé par Discovery.
- **Hors Bordeaux Métropole sans remplacer le GeoJSON IRIS** → `run_matching_v5.py` lève `FileNotFoundError` ou produit un export sans IRIS. Cf. § 5.5.
- **Schéma BDNB versionné `bdnb_2025_07_a_open_data_dep33`** : présent en fallback dans [app/api/matching-v5/buildings/route.ts](../app/api/matching-v5/buildings/route.ts), non utilisé sur Neon en option B. Ignorer.
- **`pg_dump --table=` méthode alternative étape 8** : non idempotent sur les `scout_v5_id` existants — privilégier la méthode `psql COPY`.
- **Commande npm de run V5 sans garde-fou** → peut ignorer la commune demandée et repartir sur la valeur par défaut du script ; préférer la commande Python explicite de l'étape 6.

---

## 8. Nettoyage Neon (option B)

Si Neon contient encore des restes d'un précédent flux complet (tables BDNB, cadastre, PPM, etc.), une fois ce flux en place et la première commune validée :

```bash
# Vérifier d'abord (DRY_RUN)
DRY_RUN=1 node scripts/neon-drop-bdnb-after-v5-enrichment.mjs
DRY_RUN=1 node scripts/neon-drop-discovery-artifact-tables.mjs

# Puis appliquer
npm run neon:drop-bdnb-after-v5-enrichment
npm run neon:drop-discovery-artifacts
```

- [scripts/neon-drop-bdnb-after-v5-enrichment.mjs](../scripts/neon-drop-bdnb-after-v5-enrichment.mjs) refuse d'exécuter tant que `building_geometries_json` n'est pas rempli pour toutes les lignes parcelle.
- [scripts/neon-drop-discovery-artifact-tables.mjs](../scripts/neon-drop-discovery-artifact-tables.mjs) cible uniquement les hôtes `*.neon.tech`.

Après nettoyage, Neon ne contient plus que `public.scout_matching_v5_features` (+ extensions PostGIS).

---

## 9. Hors scope (notes pour itérations futures)

- **Script agrégé** `npm run commune:add -- --insee=<INSEE> --dep=<DEP>` regroupant les étapes 2 à 8 dans une commande unique.
- **Suppression définitive** de [app/api/matching-v5/buildings/route.ts](../app/api/matching-v5/buildings/route.ts) une fois le backfill devenu systématique pour toutes les communes en base.
- **Paramétrage du chemin IRIS** via variable d'environnement (ex. `MATCHING_V5_IRIS_GEOJSON`) pour éviter le remplacement physique de `public/geo/iris-bordeaux-metropole.geojson` à chaque commune hors BM.

---

## 10. Références

- Pipeline technique : [docs/MATCHING-V5.md](MATCHING-V5.md)
- Migration / dump Neon : [docs/NEON-MIGRATION-DOCKER.md](NEON-MIGRATION-DOCKER.md)
- Sources de données BDNB : [bdnb/README.md](../bdnb/README.md)
- Pipeline complet (POI, OSM, ETL) : [data-pipeline/README.md](../data-pipeline/README.md)
- Schéma cible Neon : [data-pipeline/sql/003_scout_matching_v5_features.sql](../data-pipeline/sql/003_scout_matching_v5_features.sql)
- Route Discovery : [app/api/matching-v5/features/route.ts](../app/api/matching-v5/features/route.ts)
