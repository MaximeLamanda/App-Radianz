# Nouveau projet Neon à partir du Postgres Docker local

Ce document décrit comment **remplacer** un projet Neon par un neuf, y copier la base **PostGIS** actuelle du conteneur `docker-compose.yml`, puis brancher l’app (Vercel / local) et continuer à **ajouter d’autres communes INSEE** sans tout recréer à la main.

## Prérequis

- Docker local en cours avec le service `postgres-bdnb` (port **5433**, base `bdnb_local`, utilisateur `bdnb`) — voir la racine [`docker-compose.yml`](../docker-compose.yml).
- **Option A** : `pg_dump` / `pg_restore` sur la machine (`brew install libpq` sur macOS). **Option B** : rien d’autre que Docker — le script `npm run neon:transfer` utilise alors `pg_dump` **dans** le conteneur `postgres-bdnb` et `pg_restore` dans une image **`postgres:16`** (pull au premier run).
- Accès à la [console Neon](https://console.neon.tech) pour créer le projet et copier les chaînes de connexion.

## 1. Neon : supprimer l’ancien projet, en créer un nouveau

1. Console Neon → projet actuel → **Settings** → **Delete project** (ou équivalent). Confirmez que vous n’avez plus besoin des branches / backups de ce projet.
2. **Create project** : choisir une région proche de vos utilisateurs ou de Vercel (ex. `aws-eu-central-1` / Francfort).
3. Après création, ouvrir le projet → **Connection details** :
   - copier l’URL **pooled** (souvent `-pooler` dans le host) pour l’application ;
   - copier l’URL **direct / unpooled** pour les grosses opérations (`pg_restore`, migrations lourdes).

Neon fournit en général `?sslmode=require` : gardez-le.

## Transfert automatique (dump + restore)

Sur **ta machine** (Docker Desktop lancé, `pg_dump` / `pg_restore` installés), à la racine du repo :

```bash
npm run neon:transfer
```

Le script lit **`Radianz_DATABASE_URL_UNPOOLED`** dans `.env.local`, fait un dump du conteneur local puis `pg_restore` vers Neon. Voir [`scripts/neon-transfer-local-docker-to-neon.sh`](../scripts/neon-transfer-local-docker-to-neon.sh).

### Limite Neon (ex. 512 Mo) : transfert en deux temps

`pg_restore` crée d’abord le schéma et les **données**, puis la phase **post-data** (index GIST/BTREE, etc.). Les index peuvent faire dépasser le quota alors que **schéma + données** tiennent encore.

1. **Étape 1 — sans index** (dump + `pre-data` + `data` uniquement) :

   ```bash
   npm run neon:transfer:no-indexes
   ```

   Option pour un dump plus léger si tu n’utilises pas les schémas PostGIS *tiger* (géocodage US) :

   ```bash
   NEON_DUMP_EXCLUDE_TIGER=1 npm run neon:transfer:no-indexes
   ```

2. **Augmenter le stockage / le plan Neon** (ou supprimer des données inutiles sur Neon).

3. **Étape 2 — index et fin** (à partir du **même** fichier `.dump` affiché à la fin de l’étape 1, ou le plus récent sous `var/solar-view-transfer-*.dump`) :

   ```bash
   NEON_TRANSFER_DUMP=var/solar-view-transfer-YYYYMMDD-HHMMSS.dump npm run neon:transfer:indexes
   ```

   Si tu ne définis pas `NEON_TRANSFER_DUMP`, le script prend le dump **`var/solar-view-transfer-*.dump` le plus récent**.

Les requêtes peuvent être **plus lentes** tant que la phase *post-data* n’est pas passée (pas d’index). Le mode `full` (`npm run neon:transfer`) reste disponible si le quota suffit d’un coup.

## 2. Dump du Postgres local (Docker)

Depuis la racine du dépôt, avec le conteneur démarré (`docker compose up -d`) :

```bash
chmod +x scripts/neon-dump-local-docker.sh
./scripts/neon-dump-local-docker.sh
```

Cela produit un fichier `*.dump` au format **custom** (`-Fc`), adapté à `pg_restore`.

Sans le script, équivalent manuel :

```bash
export PGPASSWORD=bdnb
pg_dump -h 127.0.0.1 -p 5433 -U bdnb -d bdnb_local -Fc -f solar-view-bdnb_local.dump
```

## 3. Restaurer sur Neon

Utilisez l’URL **non poolée** (directe) dans `NEON_RESTORE_URL` pour éviter les timeouts et les limites du pooler pendant un gros `pg_restore`.

```bash
export NEON_RESTORE_URL='postgresql://…@…neon.tech/neondb?sslmode=require'
pg_restore --no-owner --no-acl --verbose -d "$NEON_RESTORE_URL" solar-view-bdnb_local.dump
```

Notes :

- **`--no-owner --no-acl`** : le dump Docker contient des rôles (`bdnb`) inexistants sur Neon ; ces options évitent des erreurs de propriétaire / ACL.
- Si Neon a déjà des objets en conflit (schéma `public` peuplé), soit un **nouveau projet / base vierge**, soit supprimez les objets concernés avant un second restore. Pour une base vierge, un restore complet suffit.
- **PostGIS** : l’image `postgis/postgis` inclut l’extension ; le dump la recréera si elle est dans le dump. Si `pg_restore` se plaint d’une extension, activez PostGIS sur la branche Neon (SQL : `CREATE EXTENSION IF NOT EXISTS postgis;`) puis relancez la partie manquante ou refaites un restore sur base vide.

## 4. Variables d’environnement (app + scripts)

L’ordre de résolution côté serveur est documenté dans [`lib/server-database-url.ts`](../lib/server-database-url.ts) :

- En **développement local** avec Docker : gardez **`LOCAL_DATABASE_URL=postgresql://bdnb:bdnb@127.0.0.1:5433/bdnb_local`** dans `.env.local` pour que l’app et les scripts utilisent **toujours le conteneur en priorité**.
- Pour **Vercel / prod** pointant vers Neon : définissez par exemple  
  **`Radianz_DATABASE_URL`** = URL **poolée** Neon,  
  et optionnellement **`Radianz_DATABASE_URL_UNPOOLED`** = URL **directe** (si vous en avez besoin pour des jobs ponctuels).

Après migration, mettez à jour ces variables dans le tableau Vercel (ou `.env.local` si vous testez Neon en local en **retirant** ou commentant `LOCAL_DATABASE_URL` le temps du test).

Les scripts Node (`import-bdnb-neon.mjs`, `clean-bdnb-postgres.mjs`, etc.) utilisent la même résolution via [`scripts/lib/resolve-database-url.mjs`](../scripts/lib/resolve-database-url.mjs).

## 5. Agrégation de nouvelles communes INSEE

Une fois Neon alimenté avec le même schéma et les mêmes tables que votre Docker :

- **BDNB** : réutilisez `node scripts/import-bdnb-neon.mjs` avec `--commune=<INSEE>` ou `--departements=…` en pointant `DATABASE_URL` (ou `.env.local`) vers **Neon** pour ingérer directement dans le cloud, **ou** continuez sur Docker puis refaites un **dump + restore** / logique ETL incrémentale selon votre rythme.
- **Pipeline POI** : `BDNB_POI_SAMPLE_COMMUNE_INSEE` avec [`scripts/build-bdnb-poi-sample.ts`](../scripts/build-bdnb-poi-sample.ts) pour chaque commune, puis import table si vous utilisez MS2 (`npm run bdnb:poi-sample:import`).
- **Matching V5** : `run_matching_v5.py` avec `--code-insee` et `--write-postgres` — voir [`docs/MATCHING-V5.md`](MATCHING-V5.md).

Le nouveau projet Neon sert de **cible unique agrégée** : les lignes et tables multi-communes coexistent (filtre `code_insee` / `code_commune_insee` selon les tables).

## 6. Stratégie « pipeline local » vs « Neon client » (Discovery / Matching V5)

Tu peux **séparer** ce qui vit sur ta machine (tout ce qui sert à **calculer** le matching) de ce qui doit être sur **Neon** pour l’**app client** (Vercel).

### Rôle du Postgres local (Docker ou autre)

- Tables d’entrée et d’ancrage : cadastre, PPM, `scout_etablissements`, `bdnb_buildings`, éventuellement `bdnb_*_geom_raw`, tables de test, rejouer des imports, etc.
- Exécution de `run_matching_v5.py` et scripts associés jusqu’à obtenir un export fiable.

Rien n’oblige à **dupliquer** ces artefacts sur Neon s’ils ne servent qu’au pipeline.

### Ce que l’app expose au client (Discovery)

Les routes utilisées par `/discovery` ne lisent que :

| Besoin | Table / objet (défaut courant) | Variable d’environnement |
|--------|-------------------------------|---------------------------|
| Empreintes + propriétés Matching V5 | `public.scout_matching_v5_features` | `SCOUT_MATCHING_V5_TABLE` |
| Polygones bâtiments sur la carte | `batiment_construction` + `batiment_groupe_ffo_bat` (même schéma) | `BDNB_CONSTRUCTIONS_TABLE` (ex. `public.batiment_construction`) |

L’extension **PostGIS** doit rester activée sur Neon (requêtes `ST_*`).

### Ce que tu peux volontairement **ne pas** migrer sur Neon

Tant que tu n’utilises pas sur Vercel les écrans ou API qui les interrogent, des restes d’anciens tests ou du pipeline pur peuvent rester **local uniquement**, par exemple : `bdnb_buildings`, `bdnb_pessac_geom_raw`, `bdnb_talence_geom_raw`, `cadastre_france_feuilles_geom`, `parcelles_personnes_morales`, `scout_etablissements`, `scout_leads`, etc. Ce n’est **pas** une liste à `DROP` aveugle : certaines routes (Solar Scout, cadastre, leads, Sitadel…) les utilisent encore si elles sont déployées.

### Alimenter Neon avec « seulement le résultat »

1. **Écrire le matching vers Neon** : lancer `run_matching_v5.py` avec `--write-postgres` en pointant la connexion vers Neon (URL unpooled), après avoir appliqué sur Neon le schéma minimal (colonnes attendues pour `scout_matching_v5_features` + tables BDNB constructions / FFO).  
2. **Ou** `pg_dump` / `pg_restore` **ciblé** depuis le local : tables `scout_matching_v5_features`, `batiment_construction`, `batiment_groupe_ffo_bat` (+ index), au lieu d’un dump complet du conteneur.

Le flux « dump Docker entier → Neon » reste utile pour un **miroir** dev/prod ; pour un Neon **allégé client**, préfère l’une des deux options ci-dessus.

Script prêt à l’emploi (URL Neon **uniquement** — `neon.tech` ; `LOCAL_DATABASE_URL` ignoré) : `npm run neon:drop-discovery-artifacts:dry` puis `npm run neon:drop-discovery-artifacts`. Voir [`scripts/neon-drop-discovery-artifact-tables.mjs`](../scripts/neon-drop-discovery-artifact-tables.mjs).

## 7. Vérifications rapides

```bash
# Contre Neon (sans LOCAL_DATABASE_URL, ou avec DATABASE_URL=Neon)
psql "$Radianz_DATABASE_URL_UNPOOLED" -c "SELECT COUNT(*) FROM public.scout_matching_v5_features;"
psql "$Radianz_DATABASE_URL_UNPOOLED" -c "SELECT postgis_version();"
```

Pour un Neon encore alimenté en « miroir » complet, tu peux aussi contrôler `public.bdnb_buildings` si la table y est présente.

Côté app : ouvrir **Discovery** (et éventuellement Solar Scout en mode Postgres) et vérifier `/api/matching-v5/features` et `/api/matching-v5/buildings`.

---

**Résumé** : suppression / création projet côté **console Neon** ; **pg_dump** depuis `127.0.0.1:5433` ; **pg_restore** vers l’URL **directe** Neon ; **variables** `Radianz_DATABASE_URL` (+ unpooled si besoin) ; local inchangé avec `LOCAL_DATABASE_URL` pour le Docker. Pour n’exposer au client que Discovery, voir **§6** (Neon minimal vs pipeline local).
