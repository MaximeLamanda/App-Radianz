## Contexte

Dans le graphique ROI (Recharts), les graduations de l’axe Y affichent des nombres trop “gros” (valeurs en € sans mise à l’échelle) et deviennent illisibles.

## Objectif

Rendre les graduations Y compactes et lisibles, **sans symbole €**, en adaptant automatiquement l’unité au range du graphe.

## Proposition

- Calculer `maxAbs = max(|netEur|)` sur la série affichée.
- Choisir une unité d’affichage :
  - `M` si `maxAbs >= 1_000_000`
  - sinon `k`
- Formater les ticks :
  - en `k`: `round(value / 1_000)` + suffixe `k`
  - en `M`: `(value / 1_000_000)` avec 1 décimale si nécessaire + suffixe `M`
- Utiliser la locale `fr-FR` pour la virgule décimale (ex. `1,2M`).

## Non-objectifs

- Ne pas modifier les valeurs du tooltip (elles restent en € avec séparateurs FR).
- Ne pas changer l’échelle du graphe ni le calcul des données.

## Critères de succès

- Les ticks Y sont courts (ex. `-120k`, `0`, `450k` ou `-1,2M`, `0`, `2M`).
- Aucun symbole `€` n’apparaît sur les graduations.
- Le rendu reste stable (pas de labels vides / NaN).

