# Audit Vercel React Best Practices – Modifications équipement par prospect

*Référence : [Vercel React Best Practices](https://github.com/vercel-labs/agent-skills/main/skills/react-best-practices/AGENTS.md)*

## Périmètre des modifications auditées

- **types/index.ts** : `panelReferenceId`, `inverterReferenceId`, `batteryReferenceId`, `includeBatteryOverride` sur `Prospect`
- **lib/firestore-prospect.ts** : persistance / lecture des champs ci‑dessus
- **components/solar-scout/ProspectDrawer.tsx** : init des refs depuis le prospect, sauvegarde des IDs, switch batterie
- **app/page.tsx** : table pipeline – résolution du matériel par prospect, affichage batterie selon le switch

---

## Conformité déjà correcte

| Règle | Catégorie | Statut |
|-------|-----------|--------|
| **5.1** Calculer l’état dérivé pendant le rendu | Re-render | OK – `prospectPanelRef`, `prospectInverterRef`, `prospectBatteryRef`, `includeBatteryForProspect` sont dérivés dans le `.map()` |
| **4.3** SWR pour la déduplication | Client data | OK – `usePanelReferences`, `useInverterReferences`, `useBatteryReferences`, `useProspectsForPipeline` déjà utilisés |
| **6.9** Rendu conditionnel explicite | Rendering | OK – cellule batterie en ternaire `condition ? <A /> : <B />`, pas de risque de rendre `0` ou `NaN` |
| **5.7** Dépendances d’effet étroites | Re-render | OK – `useEffect` du drawer avec `prospect?.panelReferenceId` etc. |
| **1.x** Waterfalls | Async | OK – pas de nouveau `await` séquentiel introduit |

---

## Points à corriger (recommandations du guide)

### 1. **7.2 Build Index Maps for Repeated Lookups** (Impact LOW–MEDIUM)

**Constat :** Dans `app/page.tsx`, pour chaque prospect on fait :
- `panelsData?.find((p) => p.id === prospect.panelReferenceId)`
- `invertersData?.find((i) => i.id === prospect.inverterReferenceId)`
- `batteriesData?.find((b) => b.id === prospect.batteryReferenceId)`

Pour N prospects et des listes de taille M, cela fait jusqu’à 3N recherches O(M) = O(N×M).

**Recommandation :** Construire une fois des `Map<id, ref>` avant le `.map()` et utiliser `.get(id)` pour des lookups O(1).

---

### 2. **7.4 / 7.5 Cache Repeated Function Calls & Cache Storage API** (Impact LOW–MEDIUM)

**Constat :** `getSolarEquipmentSettings()` est appelé à chaque itération du `.map(prospect => ...)`. Cette fonction lit très probablement le localStorage (réglages équipement). Appels synchrones répétés = coût I/O inutile.

**Recommandation :** Appeler `getSolarEquipmentSettings()` une seule fois avant la boucle, stocker le résultat (ex. `includeBatteryDefault`) et l’utiliser dans la dérivation de `includeBatteryForProspect`.

---

### 3. **6.2 CSS content-visibility for Long Lists** (optionnel)

**Recommandation :** Pour des listes longues (nombreux prospects), envisager `content-visibility: auto` sur les lignes du tableau pour réduire le travail de rendu hors écran. À appliquer si la table dépasse régulièrement 20–30 lignes visibles.

---

## Résumé

| Priorité | Action | Fichier | Statut |
|----------|--------|---------|--------|
| 1 | Index Maps pour panels / inverters / batteries | app/page.tsx | ✅ Appliqué |
| 2 | Cache `getSolarEquipmentSettings()` hors boucle | app/page.tsx | ✅ Appliqué |
| 3 | (Optionnel) content-visibility sur lignes table | app/page.tsx | Non fait (optionnel) |

Les changements métier (équipement par prospect, batterie selon le switch) sont cohérents avec le guide (état dérivé au rendu, pas de waterfalls, SWR en place). Les optimisations 1 et 2 ont été appliquées (règles 7.2, 7.4/7.5).
