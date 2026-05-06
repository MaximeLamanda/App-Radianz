# Design : parité batterie — graphiques énergie (drawer Découverte)

**Date :** 2026-05-06  
**Statut :** validé (approche 2 — parité complète avec `/p/`)

## Contexte

Dans l’onglet Solaire du drawer Découverte, `ProspectEnergyChartsPanel` affiche production et consommation sans appliquer la simulation batterie : le switch « Batterie » ne modifie pas les séries. Sur `/p/[shareToken]`, les mêmes graphiques utilisent `runProductionSimulation` / `runSimulationOneDayForChart` et les agrégats mensuels `batteryByMonth`.

## Objectif

Même composant, mêmes types de séries et mêmes principes de calcul que la page partagée : références équipement recommandées, dimensionnement batterie cohérent avec la logique projet, simulation horaire agrégée, toggle batterie effectif.

---

## 1. Architecture et flux de données

1. **Entrées** : conserver les entrées déjà alignées avec le pipeline (empreinte m², kWp estimé, courbe PVGIS mensuelle `/` kWp, type de lieu découverte — aujourd’hui `"other"`).
2. **Équipement** : panneau et onduleur comme aujourd’hui (`getRecommended*ReferenceSync` ou sélection catalogue si déjà chargée). Batterie : catalogue filtré `visible`, même stratégie de repli que le résumé financier découverte.
3. **Cible kWh batterie** : appeler `computeRecommendedBatteryTargetKwh` avec les mêmes paramètres que pour un prospect « équivalent » : `productionPerKwpMonthly` issu de PVGIS découverte, `effectiveKwp` = kWp estimé, consommation annuelle = `getEnergyConsumption(placeType) × surface`, production annuelle cohérente avec PVGIS × kWp.
4. **Composition (modèle × nombre)** : réutiliser la même règle que `recommendedBatteryComposition` dans `ProspectDrawer` (cible haute / basse, `maxBatteriesPerRack`). Factoriser dans un utilitaire partagé si cela évite une duplication large ; sinon extraire dans un second temps (YAGNI si le diff reste petit).
5. **Résumé financier découverte** : `computeDiscoveryDrawerFinancialSummary` reçoit `includeBattery: discoveryIncludeBattery` (état local du switch), `batteryRef` et `batteryCount` issus de la composition calculée (ou repli : ref recommandée, count 1 si données insuffisantes).
6. **Données mensuelles du graphique** : à partir de `getProductionFromPerKwp` (ou équivalent déjà utilisé pour les barres production), fusionner avec `batteryByMonth` du résumé (champs `selfConsumptionDirectKwh`, `selfConsumptionViaBatteryKwh`, `injectionBatteryKwh`, `injectionReseauKwh`, `gridDrawKwh`) et conserver la consommation mensuelle profil × surface.
7. **Données journalières** : `buildTypicalDayForMonth` + `buildTypicalConsumptionDayForMonth` + `runSimulationOneDayForChart` avec `scaleBatteryForCount` identique au résumé lorsque `discoveryIncludeBattery` est vrai.
8. **Dégradation** : si pas 12 mois de profil ou pas de conso / prod exploitable, ne pas inventer de simulation : graphique prod + conso seulement (comportement actuel).

---

## 2. Interface et cohérence UX

- **Switch Batterie** : pilote uniquement la simulation découverte (`discoveryIncludeBattery`), pas seulement `getSolarEquipmentSettings().includeBattery`. À l’ouverture du drawer découverte, initialiser l’état depuis les paramètres globaux (ou `true` par défaut aligné existant) pour rester prévisible.
- **Carte réduction facture** (`discoveryBillReductionCard`) : lorsque `breakdownFromHourlySim` est vrai, dériver les segments (autoconso directe, autoconso batterie, injection) à partir des totaux de simulation comme pour le bloc prospect, au lieu de forcer la batterie à 0 €.
- **Chiffre « Production » en en-tête** : rester la somme des productions mensuelles affichées (ou la même convention que le drawer prospect pour éviter les écarts visuels).

---

## 3. Tests, régressions et risques

- **Manuel** : onglet Solaire découverte — activer / désactiver Batterie et vérifier l’évolution des séries mensuelles et journalières ; comparer qualitativement avec `/p/` pour un projet aux mêmes ordres de grandeur (surface, kWp).
- **Cas limites** : catalogue batterie vide ; PVGIS en erreur ; un seul mois de données ; kWp ou surface nuls — pas de crash, pas de simulation forcée.
- **Automatisé** : si des tests unitaires couvrent déjà `computeDiscoveryDrawerFinancialSummary` ou la simulation, étendre ou ajouter un cas avec `includeBattery` true/false et vérifier des ordres de grandeur sur un mois type ; sinon privilégier un test ciblé sur une fonction pure extraite (composition batterie ou fusion `batteryByMonth`).
- **Risque** : double maintenance si la logique composition / cible kWh reste dupliquée ; mitiger par extraction minimale dès que les deux blocs (prospect vs découverte) copient plus de ~15 lignes identiques.

---

## Hors périmètre

- Saisie facture mensuelle en découverte (inchangé : profil seulement).
- Modification du comportement `/p/` hors alignement structurel nécessaire (pas de refonte ROI).
