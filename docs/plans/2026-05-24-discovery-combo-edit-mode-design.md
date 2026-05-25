# Discovery — mode édition combo (parcelles adjacentes + fusion)

## Contexte

La personnalisation combo existe déjà au niveau **bâtiment** (checkboxes tiroir, numéros carte, surbrillance grisée). Le **groupe de parcelles** reste figé : composante connexe « partage » (`findMatchingV5LinkedParcelleRowsTransitive`). Les KPIs pipeline et l’ajout prospect utilisent encore le cluster matching complet ; la sélection bâtiment n’est pas persistée.

## Objectifs

- Permettre d’**étendre** le combo avec des parcelles **physiquement adjacentes** (touchantes ou buffer court).
- Si la parcelle cliquée appartient déjà à un **autre combo** → **fusionner** tout ce combo dans la sélection.
- **Mode édition** dédié : voisins visibles sur la carte, clic pour inclure / exclure.
- **Session** : customisation volatile tant que le tiroir est actif.
- **Pipeline** : à l’ajout prospect, persister l’agrégat parcelles + bâtiments cochés sur Firestore.
- **Scout V5** : lecture seule — aucune écriture Postgres.

## Non-objectifs (v1)

- Modifier les tables `scout_matching_v5_*` ou recalculer `scout_matching_v5_combos`.
- Fusionner des combos via clic sur un second marqueur cluster sans passer par les parcelles voisines en mode édition.
- Liste « parcelles voisines » dans le tiroir sans couche carte interactive (reporté).

## Décisions validées

| Sujet | Décision |
|-------|----------|
| Cas d’usage | Parcelles adjacentes libres ou dans un autre combo |
| Fusion | Ajout d’une parcelle d’un autre combo → **toutes** les parcelles de ce combo |
| UX | Mode édition (bouton tiroir + parcelles ajoutables sur carte) |
| Session vs pipeline | Session volatile ; persistance uniquement sur `Prospect` à l’ajout |
| Voisins | **API Postgres** `ST_Touches` / `ST_DWithin` (recommandé vs filtrage client seul) |

## Architecture

### États session (`app/discovery/page.tsx`)

```ts
discoveryEditMode: boolean
customParcelleIds: Set<string>      // ajouts manuels
removedParcelleIds: Set<string>    // retraits du combo matching (v1)
```

**Combo effectif :**

```
effectiveParcelleRows =
  (linkedParcelleRows ∪ rows(customParcelleIds)) \ removedParcelleIds
```

- Ajout d’une parcelle déjà dans un combo B : résoudre `findMatchingV5LinkedParcelleRowsTransitive(parcelleB)` et ajouter tous les `scout_v5_id` au set custom (fusion).
- Sortie mode édition / fermeture tiroir : reset edit mode + sets custom (sauf réouverture prospect avec périmètre persisté).

### Mode édition (UX)

- Bouton **« Modifier le périmètre »** dans `ProspectDrawer` (section Parcelle).
- Bandeau : *Mode édition — cliquez les parcelles voisines pour les ajouter*.
- Carte :
  - **Incluses** : style actuel (`selectedParcellePath`).
  - **Ajoutables** : contour pointillé, fond léger, `interactive: true`, clic = toggle.
- Entrée en édition : `GET /api/matching-v5/parcelles-adjacent` une fois ; pas de refetch à chaque pan.

### API voisins

```
GET /api/matching-v5/parcelles-adjacent
  ?parcelle_ids=id1,id2
  &buffer_m=5
  &exclude_ids=id3,...
```

Réponse :

```json
{
  "parcelles": [
    {
      "scout_v5_id": "...",
      "geometry": { "type": "Polygon", "coordinates": [...] },
      "combo_id": "combo:...",
      "cadastre_label": "..."
    }
  ]
}
```

SQL : voisins issus de **`public.cadastre_france_feuilles_geom`** (toutes les parcelles cadastrales de la commune), pas seulement `scout_matching_v5_features`. Jointure optionnelle matching V5 + `scout_matching_v5_combos` pour `combo_id` / fusion.

### Persistance pipeline (`types/index.ts` + Firestore)

Nouveaux champs optionnels sur `Prospect` :

```ts
matchingV5ParcelleIds?: string[]
matchingV5BuildingSelectionIds?: string[]  // bc:… / osm:…
```

- `matchingV5RowId` reste l’**ancre** tiroir.
- `matchingV5RowsToProspectDraft`, empreinte, contour, SIREN, parking : calculés sur `effectiveParcelleRows` + `selectedBuildingIds`.
- Réouverture Découverte : si `matchingV5ParcelleIds` présent → hydrater le périmètre (fetch par ids) au lieu du seul transitif partage.

### Fichiers impactés (aperçu)

| Fichier | Rôle |
|---------|------|
| `app/api/matching-v5/parcelles-adjacent/route.ts` | Voisins PostGIS |
| `lib/discovery-combo-effective-parcelles.ts` | Résolution combo effectif + fusion |
| `app/discovery/page.tsx` | États edit mode, effective rows |
| `components/discovery/DiscoveryMapView.tsx` | Couche parcelles ajoutables |
| `components/solar-scout/ProspectDrawer.tsx` | Bouton édition, KPIs filtrés |
| `lib/matching-v5-to-prospect.ts` | Draft avec périmètre custom |
| `lib/discovery-pipeline-match.ts` | Match prospect ↔ sélection étendue |
| `types/index.ts` | Nouveaux champs Prospect |

## Comportements limites

| Cas | Comportement |
|-----|----------------|
| Parcelle introuvable en base | Toast erreur |
| Fusion 2 combos | Toutes parcelles du combo cible |
| Retrait parcelle « partage » | Autorisé en session ; ids persistés à la sauvegarde |
| Zoom cluster | Mode édition : géométries voisins via API (pas dépendant du MVT seul) |

## Tests

- Unit : `effectiveParcelleRows` (ajout, fusion, retrait).
- Unit : KPI / empreinte avec sous-ensemble bâtiments.
- API : adjacence touches + buffer (fixture SQL minimale ou mock pg).
- Intégration : edit → ajout voisin → `addProspectToPipeline` avec N parcelles.

## Références

- `docs/plans/2026-05-20-discovery-combo-clusters-design.md` — définition combo matching
- `lib/discovery-combo-building-selection.ts` — sélection bâtiments existante
- `lib/scout-matching-v5-map.ts` — `findMatchingV5LinkedParcelleRowsTransitive`
