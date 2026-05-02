# Démarche locale : BDNB → POI Google → SIRENE (fichier GeoJSON)

Ce document résume **la méthode actuelle** retenue pour Solar Scout : enrichissement **hors ligne** vers un **GeoJSON**, consommé par l’app Next.js pour la couche **Pipeline**.

**Feuille de route (voir aussi [`AVANCEMENT-BDNB-NEON-COMMUNES.md`](AVANCEMENT-BDNB-NEON-COMMUNES.md)) :** le GeoJSON est la phase **MS1 — test** ; ensuite **MS2 — schéma Postgres local** (Docker) ; **MS3 — Neon** seulement après validation. **Ne pas cibler Neon** comme sortie du processus tant que MS1/MS2 ne sont pas clairs.

---

## 1. Idée générale

| Brique | Rôle |
|--------|------|
| **Docker / Postgres local** | Stocker les données BDNB (import CSV département 33), tables `bdnb_buildings`, `bdnb_pessac_geom_raw`, `bdnb_talence_geom_raw`. Servir la **couche BDNB brut** sur la carte (bbox). |
| **Script `npm run build:bdnb-poi-sample`** | Lire les emprises Pessac dans Postgres, appeler **Google Places** puis l’**API recherche-entreprises** (SIRENE « léger »), écrire **un fichier GeoJSON** sur disque. |
| **`npm run dev`** | L’API Next `GET /api/scout-pipeline/bdnb-poi-sample/bbox` lit **Postgres** (`scout_bdnb_poi_sample`) si une URL base est configurée, sinon le **GeoJSON** local — pas de recalcul Google/SIRENE à chaque pan. |

Le GeoJSON est donc le **résultat enrichi** réutilisable ; Docker ne le remplace pas, il alimente la **source géométrique** et les couches brutes.

---

## 2. Périmètre géographique (codes INSEE)

- **Pessac** : **33318** — seul périmètre **enrichi** dans le GeoJSON Pipeline (`build-bdnb-poi-pessac-sample.ts`).
- **Talence** : **33522** — présent uniquement en **BDNB brut** (`bdnb_talence_geom_raw`, API dédiée), pas dans ce GeoJSON Pipeline.

Filtre surface : **emprise &gt; 1000 m²** (après `ST_Dump` des polygones côté script ; côté import brut, même seuil pour les tables sans jointure).

---

## 3. Prérequis locaux

- **`.env.local`** : au minimum `LOCAL_DATABASE_URL` (ou `DATABASE_URL`) pointant vers le Postgres Docker, `BDNB_BUILDINGS_TABLE`, clés **Google** (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` / `GOOGLE_MAPS_API_KEY`) pour Places.
- **Pipeline (MS2)** : avec une URL Postgres dans `.env.local`, l’app utilise **par défaut** la table (plus besoin de variable sauf cas particulier). Création / import :
  - `npm run bdnb:poi-sample:schema`
  - `npm run build:bdnb-poi-sample` (ou réutiliser un GeoJSON déjà généré)
  - `npm run bdnb:poi-sample:import`
- **Fichier uniquement** : `SCOUT_BDNB_POI_SAMPLE_SOURCE=geojson` (utile sans base ou pour forcer le disque). Les `.geojson` sous `data-pipeline/out/` ne sont **pas** versionnés (`.gitignore`).
- **Pas d’obligation** de lancer FastAPI : pour le Pipeline, le fichier GeoJSON ou la table locale suffit. Ne définir **`SCOUT_PIPELINE_API_URL`** que si tu utilises `npm run pipeline-api:dev`.

---

## 4. Chaîne de commandes typique

À la racine du dépôt :

```bash
# 1) Postgres (Docker)
npm run postgres:local:up

# 2) Nettoyage + import BDNB dep33 + remplissage des tables brut Pessac / Talence
npm run bdnb:reimport

# 3) Génération du GeoJSON Pipeline (Pessac 33318, enrichissement Google + SIRENE)
npm run build:bdnb-poi-sample
```

- **`npm run build:bdnb-poi-sample:all`** : équivalent à forcer tout le périmètre si une variable de limite traîne dans l’environnement.
- Régénérer le GeoJSON **quand** tu changes les filtres, la logique métier, ou tu veux des données Google/SIRENE à jour — pas à chaque `npm run dev` si le fichier est déjà à jour.

**Sortie par défaut du fichier (local uniquement) :**  
`data-pipeline/out/scout_bdnb_poi_pessac.geojson` (non commité ; override avec `PESSAC_OUT` ou `SCOUT_BDNB_POI_SAMPLE_GEOJSON`.)

---

## 5. Variables d’environnement utiles (script de build)

| Variable | Effet |
|----------|--------|
| `PESSAC_SAMPLE_LIMIT` | Nombre max d’emprises enrichies. **Absent** → toutes les emprises (dans la limite de sécurité du script). |
| `PESSAC_SAMPLE_ALL=1` ou `PESSAC_SAMPLE_LIMIT=0` / `all` | Forcer tout le périmètre. |
| `PESSAC_MAX_POIS_PER_BUILDING` | POI retenus par emprise (défaut **1**). |
| `PESSAC_GOOGLE_PLACE_DETAILS=0` | Désactive **Place Details** (économie d’appels Google ; adresse pour SIRENE = lat/lng). **Par défaut** : Details **activés** pour des adresses plus fiables. |
| `PESSAC_OUT` | Chemin de sortie du GeoJSON. |

---

## 6. Où passent les données « SIRENE » ?

Les correspondances **SIRET / SIREN / nom** ne viennent **pas** d’un fichier Stock Établissement importé en local dans ce flux. Le script appelle l’**API web** officielle :

**`https://recherche-entreprises.api.gouv.fr/search`**

via la logique `findLocalSiren` (alignée avec l’app). Chaque run du build peut donc déclencher des requêtes réseau vers cette API (et vers Google).

---

## 7. Côté front (Solar Scout)

- Onglet **Pipeline** : chargement des features via **`/api/scout-pipeline/bdnb-poi-sample/bbox`** (filtre bbox sur le GeoJSON).
- Couches **BDNB brut** : Pessac (gris) + Talence (violet), données issues de **Postgres** (`/api/bdnb-pessac-raw/bbox`, `/api/bdnb-talence-raw/bbox`).

---

## 8. Après le GeoJSON : Postgres local, puis Neon

1. **MS1 (actuel)** : le fichier GeoJSON reste l’artefact d’enrichissement pour **tester** champs et jointures.
2. **MS2** : bascule vers un **schéma PostgreSQL local** (même machine / Docker) pour figer les tables et les requêtes — **sans** Neon.
3. **MS3** : reproduction du schéma sur **Neon** uniquement quand MS2 est validé.

Neon **n’est pas** la cible du flux de test Pipeline ; voir le tableau de jalons dans [`AVANCEMENT-BDNB-NEON-COMMUNES.md`](AVANCEMENT-BDNB-NEON-COMMUNES.md).

---

## 9. Références utiles dans le repo

- Script de génération : `scripts/build-bdnb-poi-pessac-sample.ts`
- Lecture côté serveur : `lib/server/bdnb-poi-sample-bbox.ts`
- Proxy / route : `app/api/scout-pipeline/[...path]/route.ts`
- Import BDNB + tables brut : `scripts/import-bdnb-neon.mjs`, `scripts/clean-bdnb-postgres.mjs`
- Doc pipeline données : `data-pipeline/README.md`
