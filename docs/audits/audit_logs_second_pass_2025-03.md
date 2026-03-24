# Audit second passage — Logs et code Solar-view

**Date :** 23 mars 2025  
**Contexte :** Analyse des logs console après implémentation du premier plan d'audit.

---

## 1. Synthèse des observations

| Élément | Statut | Détail |
|--------|--------|--------|
| Google Places API | Hors périmètre | Warning inchangé (PlacesService → Place) |
| Log [Production] | ✅ Amélioré | Apparaît 1× (au lieu de 2×) |
| runProductionSimulation SORTIE | ❌ Problème | Appelé **11+ fois** pour la même configuration |
| Données simulation | ✅ Cohérentes | 4,2 GWh prod / 4,1 GWh conso (ordre de grandeur correct) |

---

## 2. Google Places API (hors périmètre)

**Chaîne d'appel :**
```
handleOsmPolygonClick (MapComponent.tsx:862)
  → searchPoiForPolygon (poi-near-polygon.ts:138)
    → PlacesService.nearbySearch()
```

Aucune modification prévue. Le warning reste visible au clic sur un polygone OSM.

---

## 3. Appels excessifs à runProductionSimulation

### Symptôme

Le log `runProductionSimulation SORTIE` apparaît **11 fois** alors qu’un seul prospect est affiché avec une configuration stable (batterie × 1 ou × 2). Les résultats sont identiques entre les appels.

Exemples de logs :
```
viaBatterie: 198477.69, totalAutoconsommation: 2870378.82 (×2)
viaBatterie: 88039.95, totalAutoconsommation: 2759941.08 (×9)
```

### Cause racine (Phase 1 – systematic debugging)

**Origine des appels :**

`runProductionSimulation` est appelé uniquement dans le `useMemo` de `financialSummary` :

- `ProspectDrawer.tsx` (≈ L.868)
- `app/p/[shareToken]/page.tsx` (≈ L.281)

**Chaîne de re-renders identifiée :**

1. Clic sur un polygone OSM → `handleOsmPolygonClick`
2. Création d’un prospect minimal → `onProspectUpdateRef.current(minimalProspect)` → `setProspect` → re-render
3. Promesses parallèles (geocode, BDNB, POI) → chacune appelle `onProspectUpdateRef.current(partialUpdate)` :
   - geocode → `{ address }`
   - BDNB → `{ anneeConstruction }`
   - POI → `{ name }`, puis `{ name, placeType, contact, ... }`
4. Chaque mise à jour partielle fait `setProspect(prev => ({ ...prev, ...update }))` → nouveau `prospect` → re-render
5. `financialSummary` dépend de `[prospect, effectiveConfig, usedPanelRef, ...]`
6. Comme `prospect` change de référence à chaque mise à jour, le `useMemo` est re-exécuté
7. En dev, React Strict Mode peut doubler certains montages

**Bilan :** 5–6 mises à jour partielles × 2 (Strict Mode) ≈ **10–12** appels à `runProductionSimulation`.

### Recommandations

1. **Stabiliser les dépendances de `financialSummary`**  
   Ne dépendre que des champs utiles à la simulation :
   - Surface (dérivée de `prospect.roofSurfaces` / `prospect.roofSurface`)
   - `prospect.placeType`
   - `effectiveConfig` (ou champs primitifs : `effectiveKwp`, `productionPerKwp`, etc.)
   - `usedBatteryRef`, `batteryCount`, `includeBatteryEffective`
   
   Les champs `address`, `anneeConstruction`, `name` ne doivent pas provoquer de recalcul.

2. **Mémoïser les entrées de simulation**  
   Créer un `useMemo` qui ne renvoie que ces entrées et utiliser son résultat (ou un hash) comme dépendance.

3. **Ou regrouper les mises à jour côté parent**  
   Debouncer ou fusionner les mises à jour partielles avant d’appeler `setProspect`.

---

## 4. Log [Production] — OK

Le log n’apparaît qu’une fois avec les bonnes valeurs :
```json
{
  "highest_production": { "panneaux": 8333, "onduleurs": 375 },
  "perfect_fit": { "panneaux": 5668, "onduleurs": 256 }
}
```

Le correctif avec `choiceCardsConfigLogKeyRef` est efficace.

---

## 5. Données de simulation — Cohérentes

```
productionAnnuelle: 4 184 922 kWh (4,2 GWh)
consommationAnnuelle: 4 079 111 kWh (4,1 GWh)
tauxAutoconsommation: 66–69 %
```

L’ordre de grandeur correspond à une installation de grande taille (type MW), cohérent avec des panneaux de l’ordre de 5 000–8 000. Le log de diagnostic (`productionAnnuelle`, `consommationAnnuelle`) remplit son rôle.

---

## 6. Actions proposées (priorité)

| Priorité | Action |
|----------|--------|
| Haute | Stabiliser les dépendances du `useMemo` de `financialSummary` (ProspectDrawer + page partagée) pour ne pas recalculer quand `address`, `anneeConstruction`, `name` changent |
| Moyenne | Conditionner le log SORTIE de `runProductionSimulation` avec `DEBUG_AUTOCONSO` pour alléger la console en dev |
| Basse | Documenter la chaîne OSM → geocode/BDNB/POI → prospect updates pour les prochaines évolutions |

---

## 7. Fichiers concernés

- `components/solar-scout/ProspectDrawer.tsx` — `financialSummary` useMemo (≈ L.830–920)
- `app/p/[shareToken]/page.tsx` — `financialSummary` useMemo (≈ L.252–330)
- `app/solar-scout/page.tsx` — `onProspectUpdate` (≈ L.422, L.598)
- `components/solar-scout/MapComponent.tsx` — `handleOsmPolygonClick`, appels à `onProspectUpdateRef.current` (≈ L.844, 876, 886, 902, 934)
- `lib/battery-simulation.ts` — log SORTIE (≈ L.242)
