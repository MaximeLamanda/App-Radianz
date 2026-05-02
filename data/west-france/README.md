# Données « Grand Ouest » (pipeline leads)

## Périmètre

**19 départements** : Bretagne (22, 29, 35, 56), Pays de la Loire (44, 49, 53, 72, 85), Nouvelle-Aquitaine (16, 17, 24, 33, 40, 47, 64, 79, 86, 87).

Millésime BDNB aligné sur le projet : **2025-07-a**.

Les journaux d’exécution sous `out/*.log` sont **ignorés** par git (`.gitignore`).

## Contenu attendu (après téléchargement)

| Dossier | Fichiers |
|---------|----------|
| `sirene/` | `StockEtablissement_utf8.zip` (~2,8 Go — **stock national** ; le filtre « Ouest » se fait au traitement avec `--departements`) |
| `bdnb_zips/` | Un zip CSV par département (`open_data_millesime_2025-07-a_depXX_csv.zip`, ~0,5–0,8 Go chacun) |

## Télécharger

```bash
bash scripts/download-west-france-data.sh
```

Reprise possible : `curl -C -` reprend un téléchargement interrompu.

## Fusion BDNB pour l’import

Le script [`import-bdnb-neon.mjs`](../scripts/import-bdnb-neon.mjs) attend **un répertoire** avec les 4 CSV BDNB. Après extraction des zips, fusionner les CSV par table (en-tête une seule fois) ou importer département par département avec `--append` — voir la doc du script.

## Pipeline Python

```bash
cd data-pipeline/python
python -m scout_pipeline.run \
  --sirene-zip ../../data/west-france/sirene/StockEtablissement_utf8.zip \
  --bdnb-batiment-csv ../../data/west-france/bdnb_extract/batiment_groupe.csv \
  --departements 16,17,22,24,29,33,35,40,44,47,49,53,56,64,72,79,85,86,87 \
  --out-parquet ../../data/west-france/out/scout_leads.parquet
```

(`bdnb_extract/` = répertoire où tu auras fusionné les `batiment_groupe.csv` — à préparer après extraction des zips.)
