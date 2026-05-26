# Discovery — personnalisation combo via Firebase (`matchingV5ComboId`)

**Date :** 2026-05-25  
**Statut :** Validé

## Problème

Lors d’un clic sur un polygone ou un autre combo, l’application affiche parfois la version personnalisée du combo « Point P » (déjà en pipeline), alors que l’utilisateur attend les **données classiques du combo cliqué**.

### Causes identifiées

1. **Rattachement pipeline trop permissif** — `matchingV5SelectionMatchesProspect` retourne vrai si `anchor.id` ∈ `matchingV5ParcelleIds`, même pour un **autre** combo qui partage une parcelle (lien « partage »).
2. **Session mémoire** — `comboSelectionSessionByKeyRef` persiste périmètre / bâtiments hors Firebase et peut primer sur le combo réellement sélectionné.
3. **Pas de clé combo stable en base** — seuls `matchingV5RowId` et des listes de parcelles ; pas de `matchingV5ComboId`.

## Objectifs

| Situation | Comportement |
|-----------|--------------|
| Clic sur un combo **sans** prospect Discovery en Firebase | Données **classiques** : cluster SQL / matching transitif, tous les bâtiments cochés par défaut |
| Clic sur un combo **avec** prospect (`matchingV5ComboId` identique) | **Personnalisation** : `matchingV5ParcelleIds` + `matchingV5BuildingSelectionIds` depuis Firebase |
| Édition avant « Ajouter au pipeline » | Brouillon **uniquement** en state React ; perdu au changement de combo ou rechargement |
| Après ajout pipeline | Persistance **uniquement** Firebase (plus de session carte en mémoire) |

## Décisions produit

- **Clé officielle :** `matchingV5ComboId` (format `combo:parcelleA|parcelleB|…`, aligné `comboIdFromParcelleIds` / marqueurs overview).
- **Brouillon pré-pipeline :** state React local seulement (choix A).
- **Approche technique retenue :** lookup strict par `comboId` dans la liste pipeline déjà chargée (`useProspectsForPipeline`), pas de requête Firestore ad hoc par clic.

## Modèle de données (Firestore / `Prospect`)

Nouveau champ :

```ts
matchingV5ComboId?: string;
```

Champs existants conservés pour le contenu personnalisé :

- `matchingV5ParcelleIds`
- `matchingV5BuildingSelectionIds`
- `matchingV5RowId` — ancre au moment de l’ajout (deep link, affichage) ; **ne sert plus** au rattachement inter-combos

Règle : **1 prospect Discovery personnalisé par `matchingV5ComboId`** (en cas de doublon, premier trouvé ou le plus récent — à documenter dans le code).

## Flux de sélection

```
Clic marqueur combo ou polygone MVT
  → résoudre comboId + anchorParcelleId
  → prospect = findByComboId(comboId, pipelineProspects)
  → si absent : état classique (edit vide, bâtiments tous cochés)
  → si présent : parcelleEditStateFromPersisted(parcelleIds, baseline du combo cliqué)
                 + bâtiments depuis matchingV5BuildingSelectionIds
```

**Changement de combo :** reset complet du state local (edit, bâtiments, mode édition). Aucune lecture de `comboSelectionSessionByKeyRef`.

## Suppressions / corrections code

| Élément | Action |
|---------|--------|
| `comboSelectionSessionByKeyRef` | Supprimer |
| `discovery-combo-selection-session.ts` | Supprimer si plus référencé |
| `matchingV5SelectionMatchesProspect` (matching flou) | Remplacer par `findDiscoveryProspectByComboId` |
| `persistDiscoveryComboSelectionSession` au pipeline add | Supprimer |
| Restauration liée à `selectedRowId` seul | Toujours passer par `selectedComboId` |

## Migration prospects existants

- **Écriture :** toujours renseigner `matchingV5ComboId` à l’ajout pipeline.
- **Lecture (transition) :** si `matchingV5ComboId` absent, dériver `comboIdFromParcelleIds(matchingV5ParcelleIds)` pour le lookup ; **ne plus** utiliser `persisted.includes(anchor.id)` pour matcher un autre combo.
- Backfill Firestore batch : hors scope immédiat (option ultérieure).

## Tests cibles

- Deux combos partageant une parcelle : prospect pipeline sur A → clic B = classique ; clic A = personnalisé.
- `findDiscoveryProspectByComboId` : égalité stricte sur `comboId`, pas de faux positif.
- Ajout pipeline enregistre `matchingV5ComboId` dans le document Firestore.

## Hors scope

- Sync Firebase à chaque « Valider » en mode édition (choix C écarté).
- Index Firestore / requête par combo à la volée (approche 2 écartée).
- Réécriture du calcul `comboId` côté SQL.

## Références

- `lib/discovery-combo-markers.ts` — `comboIdFromParcelleIds`
- `lib/discovery-combo-effective-parcelles.ts` — `parcelleEditStateFromPersistedParcelleIds`
- `lib/firestore-prospect.ts` — sérialisation prospect
- Design clusters : `docs/plans/2026-05-20-discovery-combo-clusters-design.md`
