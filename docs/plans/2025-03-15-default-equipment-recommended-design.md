# Design : Matériel recommandé par défaut (Panneau vs Onduleur / Batterie)

**Date :** 2025-03-15  
**Contexte :** Le « recommandé par défaut » ne fonctionnait pas correctement pour la batterie. Clarification des règles : panneau = recommandé **global** ; onduleur et batterie = **recommandé par calcul**, avec plusieurs modèles visibles pour le prospect.

---

## 1. Règles métier

| Élément   | Notion « recommandé »              | Visibilité pour le prospect | Sélection par défaut |
|----------|-------------------------------------|------------------------------|------------------------|
| **Panneau** | **Global** : un seul « recommandé » dans les paramètres (flag) | Liste des panneaux configurés | Choix prospect (byId) **sinon** ref avec `recommended === true` **sinon** premier de la liste |
| **Onduleur** | **Calcul** : adapté au kWp du prospect (ex. nombre d’onduleurs ≤ 8) | Plusieurs visibles (tous les modèles) | Choix prospect (byId) **sinon** onduleur calculé **sinon** premier de la liste |
| **Batterie** | **Calcul** : capacité la plus proche du surplus (existant `recommendedBatteryFromSurplus`) | Plusieurs visibles (tous les modèles) | Choix prospect (byId) **sinon** batterie calculée (surplus) **sinon** premier de la liste |

- **Panneau** : le badge « recommandé » = ref avec le flag global `recommended`.
- **Onduleur / Batterie** : le badge « recommandé » = « recommandé **pour ce prospect** » (résultat du calcul), pas le flag global.

---

## 2. Règle technique commune

**La valeur affichée (usedPanelRef / usedInverterRef / usedBatteryRef) doit toujours être un élément de la liste passée au composant** (`panelsData` / `invertersData` / `batteriesData`).  
On ne doit jamais assigner une ref venue d’une autre source (ex. `getRecommendedBatteryReferenceSync()` sans liste, ou `DEFAULT_BATTERY_REFERENCES`) pour éviter une ref absente de la liste et des incohérences d’affichage.

---

## 3. Panneau (inchangé conceptuellement)

- **useEffect** : `isOpen && panelsData` → `byId ?? panelsData.find(r => r.recommended === true) ?? panelsData[0] ?? getPanelReferences()[0]`.
- **Fallback** : si tout est vide, le dernier fallback peut rester `getPanelReferences()[0]` **à condition** de ne l’utiliser que lorsque `panelsData` est vide (sinon on privilégie toujours un élément de `panelsData`).
- **Badge** : `showRecommendedBadge={!!usedPanelRef?.recommended}` (recommandé global).

---

## 4. Onduleur (recommandé par calcul)

- **Calcul « onduleur recommandé pour ce prospect »** :  
  Parmi `invertersData`, premier onduleur tel que `calculateInverterCount(effectiveKwp, inv) <= MAX_INVERTER_COUNT` (ex. 8). Option : privilégier celui avec `recommended === true` s’il respecte la limite, sinon premier qui convient, sinon `invertersData[0]`.
- **useEffect** :  
  `byId ?? recommendedInverterFromCalculation ?? invertersData[0]`.  
  Ne plus utiliser `getRecommendedInverterReferenceSync()` comme fallback (risque de ref hors liste). Si la liste est vide, ne rien mettre.
- **Badge** :  
  `showRecommendedBadge={usedInverterRef?.id === recommendedInverterFromCalculation?.id && !inverterCountExceedsLimit}`.  
  Garder `warningBadge` « Changer de modèle » quand le nombre d’onduleurs dépasse la limite.
- **Dépendances** : inclure `isOpen` si on aligne avec le panneau (effet uniquement à l’ouverture du drawer).

---

## 5. Batterie (recommandé par calcul, simplification)

- **Calcul** : garder `recommendedBatteryFromSurplus` (capacité la plus proche du surplus).
- **useEffect** :  
  `byId ?? recommendedBatteryFromSurplus ?? batteriesData.find(r => r.recommended === true) ?? batteriesData[0]`.  
  **Supprimer** le fallback `getRecommendedBatteryReferenceSync()` (ou, si conservé, l’appeler uniquement avec `getRecommendedBatteryReferenceSync(batteriesData)` pour rester dans la liste). Idéalement : uniquement des refs dans `batteriesData`.
- **Badge** : déjà correct : `isRecommendedForProspect={usedBatteryRef?.id === recommendedBatteryFromSurplus?.id}`.
- **Dépendances** : ajouter `isOpen` pour cohérence avec le panneau (effet seulement quand le drawer est ouvert).

---

## 6. Résumé des changements (implémentation)

| Fichier / zone | Action |
|----------------|--------|
| `ProspectDrawer.tsx` – panneau | Vérifier que le fallback final ne pose jamais une ref hors de `panelsData` quand `panelsData.length > 0`. |
| `ProspectDrawer.tsx` – onduleur | Introduire `recommendedInverterFromCalculation` (useMemo) selon `effectiveKwp` et `calculateInverterCount <= 8`. useEffect : byId ?? ce ref calculé ?? invertersData[0]. Badge = « recommandé pour ce prospect » (id égal au calcul). Ajouter `isOpen` en dépendance si souhaité. |
| `ProspectDrawer.tsx` – batterie | useEffect : retirer `getRecommendedBatteryReferenceSync()` du fallback ; utiliser uniquement `batteriesData`. Ajouter `isOpen` en dépendance de l’effet batterie. |
| Optionnel | Dans `lib/solar-settings.ts`, `getRecommendedBatteryReferenceSync(batteryRefs?)` : déjà utilisé avec liste ailleurs ; pas de changement obligatoire si on ne l’appelle plus sans liste dans le drawer. |

---

## 7. Critères de succès

- À l’ouverture du drawer, panneau = choix prospect ou recommandé global ou premier de la liste, toujours dans `panelsData`.
- Onduleur = choix prospect ou premier onduleur « qui convient » au kWp (ex. count ≤ 8) ou premier de la liste ; badge « recommandé » uniquement quand c’est le modèle calculé (et pas de warning).
- Batterie = choix prospect ou batterie surplus ou premier de la liste, **toujours dans** `batteriesData` ; plus de ref par défaut hors liste ; badge = batterie calculée (surplus).
