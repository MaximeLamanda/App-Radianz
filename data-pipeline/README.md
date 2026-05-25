# Pipeline données leads

> **Ajout d'une commune à Discovery / Matching V5 ?** Référence unique : [`docs/PROCEDURE-AJOUT-COMMUNE.md`](../docs/PROCEDURE-AJOUT-COMMUNE.md). Ce README couvre les imports techniques (BDNB, OSM POI, ETL, FastAPI) appelés par cette procédure.

Le dossier **`out/`** ne contient dans git que des **`.gitkeep`** : `.geojson`, **`.parquet`** et les **CSV** de matching générés sont ignorés (`.gitignore` à la racine). Régénère en local (`npm run build:bdnb-poi-sample`, extractions OSM, `npm run pipeline:matching-v5:run`, etc.) ou utilise Postgres.

## Échantillon Solar Scout : BDNB → POI Google → SIRENE (Pessac INSEE 33318)

Pour la carte **Pipeline** dans Solar Scout, l’API FastAPI expose `GET /bdnb-poi-sample/bbox`, alimentée par un **GeoJSON** généré hors ligne :

1. Filtrer les bâtiments BDNB en **33318** (Pessac), emprise `ST_Area(geom_groupe) > 1000` m².
2. Pour chaque emprise : **Google Places Nearby** au centroïde, tri des POI (comme le client `listPoisNearPolygon`), **un POI retenu** par défaut.
3. **Place Details** (par défaut) pour l’adresse formatée, puis **recherche-entreprises** + **`findLocalSiren`** (même logique que l’app). `PESSAC_GOOGLE_PLACE_DETAILS=0` pour désactiver Details (économie d’appels, jointure SIRENE moins fiable).

Génération depuis la racine du repo :

```bash
npm run build:bdnb-poi-sample
```

Sortie par défaut : [`data-pipeline/out/scout_bdnb_poi_pessac.geojson`](out/scout_bdnb_poi_pessac.geojson). **`PESSAC_SAMPLE_LIMIT` absent** → **toutes** les emprises (&gt; 1000 m², plafond **50 000**). Pour **limiter** (ex. 80) : définir `PESSAC_SAMPLE_LIMIT=80`. `PESSAC_SAMPLE_ALL=1` ou `PESSAC_SAMPLE_LIMIT=0` / `all` : idem tout périmètre. `PESSAC_MAX_POIS_PER_BUILDING` (défaut **1**), `PESSAC_GOOGLE_PLACE_DETAILS=0` pour **sans** Place Details (défaut : Details **activés**), `PESSAC_OUT` (chemin du fichier).

`npm run build:bdnb-poi-sample:all` force tout Pessac même si une limite traîne dans l’environnement (équivalent `PESSAC_SAMPLE_ALL=1`).

**BDNB brut** : Pessac **33318** — `bdnb_pessac_geom_raw` / `GET /api/bdnb-pessac-raw/bbox`. **Talence** **33522** — `bdnb_talence_geom_raw` / `GET /api/bdnb-talence-raw/bbox` (couche violette sur la carte Pipeline). Emprises &gt; 1000 m². Le GeoJSON Pipeline ne couvre que Pessac (enrichissement Google + SIRENE).

Nettoyage Postgres BDNB + réimport dep33 : `npm run bdnb:reimport` (voir `scripts/clean-bdnb-postgres.mjs`).

Côté API Python, définir **`SCOUT_BDNB_POI_SAMPLE_GEOJSON`** sur le fichier GeoJSON généré, par exemple depuis la racine du repo :

```bash
export SCOUT_BDNB_POI_SAMPLE_GEOJSON="$PWD/data-pipeline/out/scout_bdnb_poi_pessac.geojson"
cd data-pipeline/python && uvicorn scout_pipeline.api:app --reload --port 8787
```

L’ancien flux **SIRENE → jointure spatiale BDNB** et l’endpoint **`/sirene-geo/bbox`** ne sont plus utilisés par l’app ; le script Python [`scout_pipeline/run.py`](python/scout_pipeline/run.py) peut encore produire des exports Parquet pour d’autres usages.

---

Flux ETL classique (optionnel) : ingestion **SIRENE** (stock établissement), liaison spatiale vers **BDNB**, **dédoublonnage par bâtiment** (effectif maximal), enrichissement **Overture** optionnel, puis table **`public.scout_leads`**.

## Prérequis Postgres

- Extension `postgis`
- Appliquer [`sql/001_scout_schema.sql`](sql/001_scout_schema.sql)
- Option MS2 (échantillon Pipeline en table locale) : [`sql/002_scout_bdnb_poi_sample.sql`](sql/002_scout_bdnb_poi_sample.sql) — `npm run bdnb:poi-sample:schema` puis `npm run bdnb:poi-sample:import` ; côté app : `SCOUT_BDNB_POI_SAMPLE_SOURCE=postgres`.

## Neon : nouveau projet + copie depuis Docker local

Procédure pas à pas (console Neon, `pg_dump`, `pg_restore`, variables Vercel) : **[`docs/NEON-MIGRATION-DOCKER.md`](../docs/NEON-MIGRATION-DOCKER.md)**. Dump rapide : `npm run neon:dump-local`.

## Mode 100 % local (sans Neon)

Les scripts et l’app utilisent **`DATABASE_URL`** (voir [`scripts/lib/resolve-database-url.mjs`](../scripts/lib/resolve-database-url.mjs) et [`lib/server-database-url.ts`](../lib/server-database-url.ts)). **Aucune obligation d’utiliser Neon** : il suffit de pointer vers un Postgres local.

1. Démarrer PostGIS en local (Docker) :

```bash
docker compose up -d
```

2. Dans **`.env.local`**, pointer vers le Postgres local. La variable **`LOCAL_DATABASE_URL`** est lue en **priorité** sur Neon / `Radianz_*` (voir [`lib/server-database-url.ts`](../lib/server-database-url.ts)) :

```bash
LOCAL_DATABASE_URL=postgresql://bdnb:bdnb@127.0.0.1:5433/bdnb_local
BDNB_BUILDINGS_TABLE=public.bdnb_buildings
```

(Sans `LOCAL_DATABASE_URL`, vous pouvez aussi ne définir que `DATABASE_URL` **et** retirer les variables Neon / `Radianz_*` du fichier pour éviter qu’elles ne prennent le dessus.)

3. Importer les CSV BDNB (dep 33 exemple, après extraction du zip open data dans un dossier contenant les 4 CSV requis) :

```bash
node scripts/import-bdnb-neon.mjs --data-dir=chemin/vers/extract_csv --all --departements=33
```

4. Générer l’échantillon Pessac (même `DATABASE_URL` local) :

```bash
npm run build:bdnb-poi-sample
```

Le service Docker écoute sur le port **5433** pour éviter un conflit avec un Postgres déjà installé sur **5432**.

## Import BDNB (table canonique)

Le script [`scripts/import-bdnb-neon.mjs`](../scripts/import-bdnb-neon.mjs) cible **n’importe quel Postgres** (local Docker, machine locale, Neon, etc.). Le nom « neon » est historique.

Variable **`BDNB_BUILDINGS_TABLE`** (défaut `public.bdnb_buildings`) — alignée avec [`lib/bdnb-buildings-table.ts`](../lib/bdnb-buildings-table.ts), l’import [`scripts/import-bdnb-neon.mjs`](../scripts/import-bdnb-neon.mjs) et le build [`scripts/build-bdnb-poi-sample.ts`](../scripts/build-bdnb-poi-sample.ts). Les emprises « brutes » Pessac / Talence côté app sont servies par [`/api/bdnb-pessac-raw/bbox`](../app/api/bdnb-pessac-raw/bbox/route.ts) et [`/api/bdnb-talence-raw/bbox`](../app/api/bdnb-talence-raw/bbox/route.ts) (tables dédiées).  
Migration depuis une ancienne table nommée par département : soit renommer la table en SQL (`ALTER TABLE … RENAME TO bdnb_buildings`), soit définir `BDNB_BUILDINGS_TABLE=public.nom_ancienne_table` le temps de la bascule.

Supprimer les groupes **résidentiel individuel** (usage BDNB / FFO) et les lignes liées (`BDNB_CONSTRUCTIONS_TABLE`, `BDNB_FFO_TABLE` défaut `public.batiment_groupe_ffo_bat`, couches brutes Pessac/Talence) : `npm run bdnb:delete-residentiel-individuel:dry-run` puis `npm run bdnb:delete-residentiel-individuel` — voir [`scripts/delete-bdnb-residentiel-individuel.mjs`](../scripts/delete-bdnb-residentiel-individuel.mjs). Sur la table FFO, le libellé exact `Résidentiel individuel` est utilisé par défaut ; pour un `ILIKE '%résidentiel%individuel%'` (plus large), définir **`BDNB_FFO_USAGE_LOOSE=1`**.

## Variables Next.js (proxy + viz)

- **`SCOUT_PIPELINE_API_URL`** — URL du serveur FastAPI (ex. `http://127.0.0.1:8787`), utilisée par [`app/api/scout-pipeline/[...path]/route.ts`](../app/api/scout-pipeline/%5B...path%5D/route.ts). **En local, tu peux t’en passer** : après `npm run build:bdnb-poi-sample`, Next lit directement `data-pipeline/out/scout_bdnb_poi_pessac.geojson`. Ne définis `SCOUT_PIPELINE_API_URL` que si tu lances **uvicorn** (section « API FastAPI » ci-dessus) avec `SCOUT_BDNB_POI_SAMPLE_GEOJSON` pointant vers ce GeoJSON.

> Pour l'enchaînement complet d'ajout d'une commune (extraction CSV, imports support, matching, transfert Neon), suivre [`docs/PROCEDURE-AJOUT-COMMUNE.md`](../docs/PROCEDURE-AJOUT-COMMUNE.md).

## ETL Python

```bash
cd data-pipeline/python
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m scout_pipeline.run --help
```

## OSM PBF → Parquet (extrait POI)

Pour lire un **`.osm.pbf`** (ex. extrait Geofabrik), le projet utilise le paquet PyPI **`osmium`** (bindings libosmium), en général **installable sans compilation** sur macOS / Linux (`pip install -r requirements.txt`).

- **Découpe bbox (fortement recommandée)** : installez la CLI système **`osmium`** (`brew install osmium` sur macOS). Le script détecte `osmium` dans le `PATH` et exécute `osmium extract -b min_lon,min_lat,max_lon,max_lat` vers un fichier temporaire, puis ne lit que ce fragment — beaucoup plus rapide sur un gros PBF (ex. Aquitaine entière).
- Sans cette CLI, le fichier **entier** est parcouru : correct mais lent sur une grande région.
- **Ancien lecteur pyrosm** (souvent cassé à l’installation pip sur Python récents) : `export SCOUT_OSM_PBF_BACKEND=pyrosm` avant la commande, si pyrosm est disponible chez vous.

Exemple :

```bash
cd data-pipeline/python
export PYTHONPATH=.
python3 -m scout_pipeline.osm_poi_extract \
  --pbf "$HOME/Downloads/aquitaine-260419.osm.pbf" \
  --bbox -0.67 44.78 -0.55 44.84 \
  --out-parquet out/osm_poi_pessac_bbox.parquet
```

## Matching V5 (export local)

Voir [`docs/MATCHING-V5.md`](../docs/MATCHING-V5.md) (référence pipeline) et [`matching/README.md`](matching/README.md). Commande typique : `npm run pipeline:matching-v5:run`. Pour ajouter une nouvelle commune au flux Discovery, utiliser [`docs/PROCEDURE-AJOUT-COMMUNE.md`](../docs/PROCEDURE-AJOUT-COMMUNE.md) plutôt que d'invoquer ces commandes manuellement.

### POI OpenStreetMap (table `public.osm_poi`)

Enrichissement optionnel du matching V5 : POI dont le point (nœud ou centroïde de way fermée) est **dans la géométrie cadastrale** des parcelles retenues à l’export.

1. PostGIS requis sur la base (même instance que le matching V5).
2. Télécharger un extrait **`.osm.pbf`** (ex. [Geofabrik](https://download.geofabrik.de/)) ; une **bbox** plus petite accélère l’import (voir aussi la section « OSM PBF → Parquet » ci-dessus pour découper avec la CLI `osmium`).
3. Import (crée la table `public.osm_poi` si besoin — pas obligatoire d’avoir `psql`) :

```bash
npm run pipeline:osm-poi:import
# ou : python3 data-pipeline/matching_v5/import_osm_poi.py --input chemin/extrait.osm.pbf --truncate
```

`--truncate` exécute `TRUNCATE` sur la table cible avant chargement. Surcharge du nom qualifié : variable **`OSM_POI_TABLE`** (défaut `public.osm_poi`). Puis relancer le matching V5 ; options **`--no-osm-poi`** et **`--osm-poi-max N`** sur [`matching_v5/run_matching_v5.py`](matching_v5/run_matching_v5.py).

La colonne **`tags`** ne stocke qu’un **sous-ensemble** des clés OSM (types POI `shop` / `amenity` / …, `name`, `brand`, `website`, `phone`, etc.) — pas `building`, `source`, `wikidata`, adresses complètes, etc. Voir `tags_stored_for_postgres` dans [`matching_v5/osm_poi_v5.py`](matching_v5/osm_poi_v5.py).

### Footprints bâtiments OSM (table `public.osm_building_footprints`)

Pour exécuter le matching V5 avec **géométrie OSM prioritaire** (`--building-source osm`), charger d’abord les footprints :

```bash
npm run pipeline:osm-buildings:schema
npm run pipeline:osm-buildings:import
```

Table cible surchargeable via `OSM_BUILDINGS_TABLE` (défaut `public.osm_building_footprints`).  
Puis exécuter :

```bash
npm run pipeline:matching-v5:run -- --building-source osm
```

Seuils disponibles côté script Python : `--osm-parcel-intersection-min-m2` et `--osm-bdnb-match-min-m2`.

## API FastAPI (lecture locale)

```bash
cd data-pipeline/python
uvicorn scout_pipeline.api:app --reload --port 8787
```

Next.js : définir **`SCOUT_PIPELINE_API_URL=http://127.0.0.1:8787`** et utiliser le proxy [`/api/scout-pipeline/*`](../app/api/scout-pipeline/%5B...path%5D/route.ts).

## Passerelle parcelles personnes morales (Lead Inbox)

Référentiel unique des communes : table **`public.scout_leads_communes`** (`code_insee` en clé primaire). Pour couvrir une commune : `INSERT INTO public.scout_leads_communes (code_insee) VALUES ('33547') ON CONFLICT DO NOTHING;` puis importer le parquet PPM pour cet INSEE (voir `import_parcelles_personnes_morales.py --code-insee=…`).

La vue **`public.scout_leads_enriched`** joint `scout_leads` et l’agrégation PPM sur **tous** les `code_insee` présents dans `scout_leads_communes`. `GET /api/leads` lit cette vue.

Import exemple (schéma + PPM pour Pessac, idempotent par commune) :

```bash
npm run import:parcelles-pessac
```

Cette commande applique `data-pipeline/sql/001_scout_schema.sql` si besoin, recharge `parcelles_personnes_morales` pour `33318`, et s’appuie sur `scout_leads_communes` + `scout_leads_enriched` pour l’API leads.

### Migration depuis `scout_leads_pessac_enriched`

Si la base a encore l’ancienne vue : exécuter une fois dans Postgres le bloc allant de `CREATE TABLE … scout_leads_communes` jusqu’à `DROP VIEW … scout_leads_pessac_enriched` dans [`sql/001_scout_schema.sql`](sql/001_scout_schema.sql) (rejeu du fichier entier sur une base neuve est aussi valide).

## Téléversement Neon

Après validation : réutiliser la même URL Postgres que l’app (`Radianz_DATABASE_URL` / `DATABASE_URL`) et relancer l’import / `COPY` des tables ciblées.
