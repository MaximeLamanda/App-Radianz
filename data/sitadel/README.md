# SITADEL (locaux industriels) — données locales

## Fichiers suivis dans le dépôt

- **`meta/`** — URLs par millésime (`url_*.txt`), index (`dataset.json`, `datafile_locaux.json`), notes.
- Pas de **`.zip`** ni de **`.csv`** extraits dans git : trop volumineux ; ils sont listés dans `.gitignore`.

## Récupérer les jeux

1. Lire les URL dans `meta/url_<année>.txt` (ou le catalogue HTML / JSON).
2. Télécharger les archives dans `raw/` (ex. `sitadel_locaux_ci_2026.zip`).
3. Dézipper les CSV dans `extracted/<année>/` (ex. `extracted/2026/sitadel_locaux_ci_2026.csv`).

Les scripts d’enrichissement / import du repo pointent en général vers `data/sitadel/extracted` (voir `scripts/enrich-sitadel-*.mjs` et la doc des scripts legacy si besoin).
