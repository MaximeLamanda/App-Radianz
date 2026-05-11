# Design — Colonne `Nom OSM` dans le tableau Building (Discovery Drawer)

## Contexte

Dans l'onglet `Building` du drawer Discovery (`ProspectDrawer`), le tableau affiche actuellement `N°`, `Année`, `Empreinte`, `Zone`.
Le besoin est d'afficher le nom OSM du bâtiment associé directement dans ce tableau.

## Décision validée

- Ajouter une **nouvelle colonne** `Nom OSM`.
- Supprimer complètement la colonne `Zone` de ce tableau (header, cellule, tooltip et badge associés), car l'information est déjà couverte ailleurs (notamment via POI).

## Structure finale du tableau

Ordre des colonnes :

1. `N°`
2. `Année`
3. `Empreinte`
4. `Nom OSM`

## Règles de rendu

- Source de donnée : `b.osmName` (depuis `buildingDetailRows`, type `V5BuildingsJsonEntry`).
- Valeur affichée :
  - `b.osmName?.trim()` si présent et non vide.
  - `—` sinon.
- UX texte long :
  - rendu tronqué (`truncate`) pour préserver la largeur du tableau,
  - valeur complète visible via attribut `title`.

## Comportement et impact

- Aucun changement de tri : on conserve le tri actuel par empreinte.
- Aucun changement de logique métier/pipeline : affichage UI uniquement.
- Aucune modification attendue sur les autres onglets (`Terrain`, `Entreprises`, etc.).

## Validation attendue

- Cas 1 : bâtiment avec `osmName` renseigné -> le nom s'affiche.
- Cas 2 : `osmName` absent/vide -> `—`.
- Cas 3 : `osmName` long -> table stable + nom complet au survol.
