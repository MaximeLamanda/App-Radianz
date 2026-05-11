# Données BDNB (département 33, local)

Ce dossier sert de **cible locale** pour l’import Postgres (`npm run import:bdnb-dep33` → `bdnb/dep33_millesime_2025_07a/extract`).

> Pour ajouter une commune à Discovery / Matching V5 (extraction CSV BDNB, imports support, matching, transfert Neon), suivre la procédure unique [`docs/PROCEDURE-AJOUT-COMMUNE.md`](../docs/PROCEDURE-AJOUT-COMMUNE.md).

## Contenu versionné (léger)

- **`dep33_communes_insee.txt`**, **`dep33_communes_missing.txt`** — listes INSEE utiles aux lots d’import.
- **`batch20_communes.txt`**, **`batch50_communes.txt`**, **`batch100_communes.txt`**, **`batch200_communes.txt`** — lots manuels (une ligne = code INSEE).

## Contenu lourd (hors git)

Le répertoire **`dep33_millesime_2025_07a/`** (zip / CSV extraits) est ignoré par `.gitignore` : à télécharger depuis l’open data BDNB puis dézipper dans `extract/` comme attendu par le script d’import.

L’ancien doublon **`dep33_extract/`** a été retiré : une seule arborescence (`dep33_millesime_2025_07a/extract`) suffit.
