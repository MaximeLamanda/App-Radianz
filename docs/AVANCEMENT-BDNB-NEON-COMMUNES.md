# BDNB & Pipeline Scout — suivi

## Jalons (ordre imposé)

| # | Phase | Rôle | Statut |
|---|--------|------|--------|
| **MS1** | **GeoJSON** (généré sous `data-pipeline/out/`, **hors git**) | Itérer sur les champs, jointures BDNB + Google Places + SIRENE, **sans** engagement base distante. Bac à sable pour le schéma des `properties`. | En cours / référence |
| **MS2** | **PostgreSQL local** (Docker, `LOCAL_DATABASE_URL`) | Table **`public.scout_bdnb_poi_sample`** : même contenu que le GeoJSON enrichi ; **source par défaut** de l’API Pipeline dès qu’une URL Postgres est dispo. Commandes : `npm run bdnb:poi-sample:schema` puis `npm run bdnb:poi-sample:import` (après `npm run build:bdnb-poi-sample`). Voir [`pipeline-bdnb-demarche-local.md`](pipeline-bdnb-demarche-local.md). | À activer après validation MS1 |
| **MS3** | **Neon (prod / partagé)** | Bascule **uniquement** quand MS2 est stable : même schéma, `DATABASE_URL` Neon — pas d’export ni de cible Neon pendant les phases test. | Plus tard |

**Règle :** le processus Pipeline **ne vise pas Neon** tant que MS1 (GeoJSON) et MS2 (Postgres local) ne sont pas validés. Neon n’est **pas** la sortie du flux de test.

---

## Technique (rappel)

- **Table canonique BDNB** : `public.bdnb_buildings` par défaut — variable **`BDNB_BUILDINGS_TABLE`** (voir [`lib/bdnb-buildings-table.ts`](../lib/bdnb-buildings-table.ts)).
- **Import CSV** : [`scripts/import-bdnb-neon.mjs`](../scripts/import-bdnb-neon.mjs) — le nom du script est historique ; en phase locale il alimente **Postgres Docker**, pas obligatoirement Neon.
- **Pipeline leads** (Python / Parquet / `scout_leads`) : [`data-pipeline/README.md`](../data-pipeline/README.md).
- **Démarche GeoJSON détaillée** : [`pipeline-bdnb-demarche-local.md`](pipeline-bdnb-demarche-local.md).

---

## Ancien chargement « dep33 figé »

Le chargement département 33 figé (`bdnb_2025_07a_33`, ancien `import-bdnb-dep33-neon.mjs`) est **remplacé** par le flux générique ci-dessus (`import-bdnb-neon.mjs`, `--data-dir=...`, filtres communes / `--departements=`).
