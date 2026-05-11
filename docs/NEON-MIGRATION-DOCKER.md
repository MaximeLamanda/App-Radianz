# Nouveau projet Neon à partir du Postgres Docker local

Ce document décrit comment **remplacer** un projet Neon par un neuf, y copier la base **PostGIS** actuelle du conteneur `docker-compose.yml`, puis brancher l’app (Vercel / local).

> Pour **ajouter une commune** à Discovery / Matching V5, ne pas suivre ce document : utiliser la procédure unique [`docs/PROCEDURE-AJOUT-COMMUNE.md`](PROCEDURE-AJOUT-COMMUNE.md). Le présent fichier reste utile pour le **bootstrap initial** d’un projet Neon (création, dump complet, variables d’environnement).

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

> Procédure unique consolidée : [`docs/PROCEDURE-AJOUT-COMMUNE.md`](PROCEDURE-AJOUT-COMMUNE.md). Ce fichier décrit étape par étape l’extraction BDNB, les imports support locaux, le matching V5 local, le backfill `building_geometries_json` et le transfert ciblé vers Neon (option B : seule `public.scout_matching_v5_features` est envoyée sur Neon).

Le projet Neon sert de **cible unique agrégée** : les lignes du `scout_matching_v5_features` multi-communes coexistent et sont accumulées par `code_insee` (idempotent par DELETE/INSERT côté pipeline).

## 6. Stratégie « pipeline local » vs « Neon client » (Discovery / Matching V5)

Le calcul vit **sur la machine locale** (Docker), Neon ne reçoit que la table de résultat.

### Rôle du Postgres local (Docker ou autre)

- Tables d’entrée et d’ancrage : cadastre, PPM, `scout_etablissements`, `bdnb_buildings`, `batiment_construction`, `batiment_groupe_ffo_bat`, éventuellement `osm_poi`.
- Exécution de `run_matching_v5.py`, du backfill `building_geometries_json` et des autres scripts jusqu’à obtenir un export complet — détail par étape : [`docs/PROCEDURE-AJOUT-COMMUNE.md`](PROCEDURE-AJOUT-COMMUNE.md).

Rien n’oblige à **dupliquer** ces artefacts sur Neon s’ils ne servent qu’au pipeline.

### Ce que l’app expose au client (Discovery)

Une seule table sur Neon (option B) :

| Besoin | Table / objet (défaut courant) | Variable d’environnement |
|--------|-------------------------------|---------------------------|
| Empreintes, propriétés et polygones bâtiments Matching V5 | `public.scout_matching_v5_features` (colonne `building_geometries_json` remplie via le backfill local) | `SCOUT_MATCHING_V5_TABLE` |

L’extension **PostGIS** doit rester activée sur Neon (requêtes `ST_*`).

> Le fallback HTTP `/api/matching-v5/buildings`, qui requiert `batiment_construction` + `batiment_groupe_ffo_bat`, n’est plus déclenché tant que `building_geometries_json` est rempli. Voir [`data-pipeline/matching_v5/backfill_building_geometries_v5.py`](../data-pipeline/matching_v5/backfill_building_geometries_v5.py) et [`scripts/sync-scout-v5-building-geometries-json.mjs`](../scripts/sync-scout-v5-building-geometries-json.mjs).

### Alimenter Neon avec « seulement le résultat »

Suivre l’étape 8 de [`docs/PROCEDURE-AJOUT-COMMUNE.md`](PROCEDURE-AJOUT-COMMUNE.md) (méthode `psql … COPY` filtrée par `code_insee`, ou `pg_dump --table=` selon le besoin).

### Nettoyage des reliquats Neon

Si Neon contient encore les tables BDNB / artefacts d’un précédent flux complet :

```bash
DRY_RUN=1 node scripts/neon-drop-bdnb-after-v5-enrichment.mjs
DRY_RUN=1 npm run neon:drop-discovery-artifacts:dry

npm run neon:drop-bdnb-after-v5-enrichment
npm run neon:drop-discovery-artifacts
```

Voir [`scripts/neon-drop-bdnb-after-v5-enrichment.mjs`](../scripts/neon-drop-bdnb-after-v5-enrichment.mjs) (refuse d’exécuter tant que `building_geometries_json` n’est pas rempli sur les lignes `grain='parcelle'`) et [`scripts/neon-drop-discovery-artifact-tables.mjs`](../scripts/neon-drop-discovery-artifact-tables.mjs) (cible Neon uniquement, `LOCAL_DATABASE_URL` ignoré).

## 7. Vérifications rapides

```bash
# Contre Neon (sans LOCAL_DATABASE_URL, ou avec DATABASE_URL=Neon)
psql "$Radianz_DATABASE_URL_UNPOOLED" -c "SELECT COUNT(*) FROM public.scout_matching_v5_features;"
psql "$Radianz_DATABASE_URL_UNPOOLED" -c "SELECT postgis_version();"
```

Côté app : ouvrir **Discovery** et vérifier `/api/matching-v5/features`. En option B (`building_geometries_json` rempli), aucun appel à `/api/matching-v5/buildings` n’est attendu.

---

**Résumé** : suppression / création projet côté **console Neon** ; **pg_dump** depuis `127.0.0.1:5433` ; **pg_restore** vers l’URL **directe** Neon ; **variables** `Radianz_DATABASE_URL` (+ unpooled si besoin) ; local inchangé avec `LOCAL_DATABASE_URL` pour le Docker. Pour ajouter une commune au flux Discovery, voir [`docs/PROCEDURE-AJOUT-COMMUNE.md`](PROCEDURE-AJOUT-COMMUNE.md).
