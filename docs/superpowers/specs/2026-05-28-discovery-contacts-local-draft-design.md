# Discovery — contacts en brouillon local (pré-pipeline)

**Date :** 2026-05-28  
**Statut :** Validé — implémenté

## Problème

En Discovery, l’ajout de contacts (manuel, dirigeants api.gouv, Apollo POI) exigeait un prospect déjà au pipeline (`prospectId`). Les commerciaux ne pouvaient pas constituer la liste de contacts avant « Ajouter au pipeline ».

## Décisions produit

| Sujet | Choix |
|--------|--------|
| Persistance brouillon | State React uniquement ; perdu à la fermeture du drawer ou au changement de combo |
| Sources | Manuel + dirigeants + Apollo POI |
| UI brouillon | Aucun badge ; toasts de succès inchangés |
| Avec prospect pipeline | Firestore immédiat (comportement actuel) |

## Comportement

- Sans `prospectId` : merge dans `discoveryContacts`, pas d’écriture Firestore.
- Avec `prospectId` : `updateProspect({ contacts })` puis mise à jour du state.
- `handleDiscoveryAddToPipeline` : inclure `contacts: discoveryContacts` dans le brouillon envoyé à `addProspectToPipeline`.
- Reset : `discoveryRow.id` change → contacts du pipeline du combo ou `[]` ; drawer fermé sans pipeline → `[]`.
- `onDiscoveryPipelineAdded` : uniquement si le combo a déjà un prospect pipeline (refetch après Firestore).

## Technique

- Helper `persistDiscoveryContactList(prospectId, contacts)` dans `lib/discovery-contacts-persist.ts`.
- Composants Discovery : calcul du tableau fusionné puis appel du helper + `onContactsPersisted`.

## Hors scope

- sessionStorage / localStorage
- Indicateur visuel « brouillon »

## Références

- Specs antérieures (brouillon exclu) : `docs/plans/2026-05-26-discovery-poi-manual-contacts-design.md`
