# Design : Correction OSM – rechargement polygones et duplication surfaces

**Date :** 2025-03-08  
**Statut :** Validé  
**Périmètre :** solar-scout, lib/swr-hooks

## Objectif

Corriger deux bugs : (1) les polygones OSM bleus qui se rechargent à chaque déplacement de carte ; (2) la surface comptée en double et la clé React dupliquée (ex. `osm-389226789-0`) lors du clic sur un bâtiment OSM.

## Problème 1 : Rechargement des polygones

### Cause

La clé SWR utilise les bounds bruts. À chaque pan/zoom, les coordonnées changent légèrement → nouvelle clé → nouveau fetch. Le debounce 400 ms limite la fréquence mais pas la précision des valeurs.

### Solution

1. **Quantifier les bounds** : arrondir à 4 décimales (~11 m) dans `useOsmBuildings` avant de construire la clé SWR.
2. **Augmenter le debounce** : passer de 400 ms à 600 ms dans `MapComponent` pour l’événement `idle` qui met à jour `viewBounds`.

### Fichiers

- `lib/swr-hooks.ts` : quantifier les bounds dans la clé
- `components/solar-scout/MapComponent.tsx` : debounce 400 → 600 ms

## Problème 2 : Duplication des surfaces

### Cause

`handleOsmPolygonClick` appelle `onProspectUpdate` et `onBdnbSurface`. Le prospect contient déjà `roofSurfaces`. Dans `onBdnbSurface`, le filtre `!s.id?.startsWith("bdnb-")` garde les surfaces OSM dans `manualSurfaces`. On fusionne `[...bdnbSurfaces, ...manualSurfaces]` → doublon (même surface OSM deux fois).

### Solution

Exclure aussi les ids préfixés `osm-` du filtre des surfaces manuelles. Ainsi :

- `manualSurfaces` = surfaces réellement dessinées à la main (ex. `surface-123`)
- Surfaces OSM/BDNB = remplacées par les nouvelles venues de `bdnbSurfaces`
- **Résultat final** : surfaces OSM du clic + surfaces BDNB (si existantes) + surfaces manuelles, sans duplication

### Fichier

- `app/solar-scout/page.tsx` : modifier le filtre ligne ~423

```ts
const manualSurfaces = (prev.roofSurfaces ?? []).filter(
  (s) => !s.id?.startsWith("bdnb-") && !s.id?.startsWith("osm-")
);
```

## Périmètre

- `app/page.tsx` : pas de modification. Les prospects viennent du pipeline ; la duplication se produit uniquement lors de la création dans solar-scout.

## Vérification

- **Problème 1** : Déplacer/zoomer légèrement la carte → les polygones ne doivent pas se recharger tant que les bounds quantifiés restent identiques.
- **Problème 2** : Cliquer sur un bâtiment OSM → une seule entrée par surface, surface totale correcte, pas d’avertissement React sur les clés dupliquées.
