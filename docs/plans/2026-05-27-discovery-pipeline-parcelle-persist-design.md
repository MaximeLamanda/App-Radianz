# Discovery — persistance périmètre parcelle pipeline + réhydratation cadastre

**Date :** 2026-05-27  
**Statut :** Implémenté

## Problème

Après édition du périmètre (parcelle ajoutée hors combo matching initial), **Enregistrer** ne mettait pas à jour `matchingV5ParcelleIds` / `matchingV5ComboId`. Au retour via « Voir sur la carte » depuis le pipeline, la parcelle ajoutée n’apparaissait pas.

## Solution

1. **`handleDiscoveryPipelineSave`** — persiste `matchingV5ParcelleIds` + `matchingV5ComboId` dérivés du périmètre effectif (`discoveryPipelinePerimeterPersistFields`).
2. **API `parcelles-adjacent?mode=lookup`** — géométries cadastre exactes par `scout_v5_id`.
3. **`fetchMatchingV5ParcelleRowWithCadastreFallback`** — matching V5 puis cadastre (Découverte + tiroir pipeline).

## Fichiers

| Fichier | Rôle |
|---------|------|
| `lib/discovery-pipeline-perimeter-persist.ts` | Champs Firebase périmètre |
| `lib/discovery-cadastre-parcel-fetch.ts` | Fetch matching + cadastre |
| `app/api/matching-v5/parcelles-adjacent/route.ts` | Mode `lookup` |
| `components/solar-scout/ProspectDrawer.tsx` | Save pipeline |
| `app/discovery/page.tsx` | `ensureMatchingRowsLoaded` |
| `lib/pipeline-matching-v5-drawer-context.ts` | Tiroir pipeline |

## Références

- `docs/plans/2026-05-24-discovery-combo-edit-mode-design.md`
- `docs/plans/2026-05-25-discovery-combo-firebase-personalization-design.md`
