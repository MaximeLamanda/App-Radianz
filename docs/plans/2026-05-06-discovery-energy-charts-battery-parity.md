# Parité batterie graphiques drawer Découverte — plan d’implémentation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Faire en sorte que l’onglet Solaire du drawer Découverte alimente `ProspectEnergyChartsPanel` avec les mêmes calculs de simulation batterie que `/p/` et le drawer prospect (séries mensuelles et journalières, switch effectif, carte facture cohérente).

**Architecture:** Réutiliser `computeDiscoveryDrawerFinancialSummary` pour `batteryByMonth` et les totaux ; calculer la cible kWh et la composition batterie comme pour un prospect équivalent (`computeRecommendedBatteryTargetKwh` + même logique de choix modèle/count) ; dériver `discoveryChartMonthlyData` / `discoveryChartDailyData` depuis ces résultats et `runSimulationOneDayForChart`. Voir `docs/plans/2026-05-06-discovery-energy-charts-battery-parity-design.md`.

**Tech stack:** Next.js, React, TypeScript, modules existants `@/lib/battery-simulation`, `@/lib/discovery-drawer-financial-summary`, `@/lib/recommended-battery-sizing`, `@/components/solar-scout/ProspectDrawer.tsx`.

---

### Task 1: Cartographier les appels actuels (lecture)

**Files:**

- Read: `components/solar-scout/ProspectDrawer.tsx` (discovery chart useMemos, `discoveryFinancialSummary`, `discoveryIncludeBattery`)
- Read: `lib/discovery-drawer-financial-summary.ts`
- Read: `app/p/[shareToken]/page.tsx` (`chartData`, `chartDailyData` pour référence)

**Step 1:** Noter les dépendances exactes de `discoveryFinancialSummary` et pourquoi `includeBattery` vient des settings globaux aujourd’hui.

**Step 2:** Commit — aucun (lecture seule).

---

### Task 2: Cible kWh + composition batterie en mode découverte

**Files:**

- Modify: `components/solar-scout/ProspectDrawer.tsx`
- Optional create: `lib/recommended-battery-composition.ts` (si extraction réduit duplication avec `recommendedBatteryComposition` existant)

**Step 1:** Ajouter un `useMemo` « découverte » qui, lorsque `discoveryPvgis`, `kwpEst`, `footprintSumTotal` et 12 mois de `monthlyProduction` sont valides, appelle `computeRecommendedBatteryTargetKwh` avec `placeType: discoveryPlaceType`, `surfaceM2: footprintSumTotal`, `effectiveKwp: kwpEst`, `annualProductionKwh` / `productionPerKwpMonthly` dérivés de PVGIS (même conventions que `discoveryPipelineFinanceInputs`).

**Step 2:** À partir de cette cible et de `batteriesData` filtré `visible`, produire `{ model, count }` en reprenant la logique de `recommendedBatteryComposition` (copie minimale ou fonction extraite).

**Step 3:** Lorsque le mode découverte sans prospect est actif, utiliser cette composition pour `discoveryFinancialSummary` (remplacer le `batteryCount` figé à 1 quand la composition est disponible).

**Step 4:** `npm run lint` — attendu : pas d’erreurs nouvelles sur les fichiers modifiés.

**Step 5:** Commit — `feat(discovery): battery sizing for discovery financial summary`

---

### Task 3: Brancher `discoveryIncludeBattery` sur le résumé financier découverte

**Files:**

- Modify: `components/solar-scout/ProspectDrawer.tsx`

**Step 1:** Remplacer `includeBattery: getSolarEquipmentSettings().includeBattery ?? true` dans l’appel à `computeDiscoveryDrawerFinancialSummary` par `includeBattery: discoveryIncludeBattery`.

**Step 2:** Initialiser `useState` de `discoveryIncludeBattery` depuis `getSolarEquipmentSettings().includeBattery ?? true` (ou `useEffect` à l’ouverture du drawer découverte) pour cohérence avec les paramètres globaux au premier rendu.

**Step 3:** Mettre à jour le tableau de dépendances du `useMemo` `discoveryFinancialSummary` pour inclure `discoveryIncludeBattery`.

**Step 4:** `npm run lint`

**Step 5:** Commit — `feat(discovery): tie battery toggle to discovery simulation`

---

### Task 4: Données mensuelles du graphique avec `batteryByMonth`

**Files:**

- Modify: `components/solar-scout/ProspectDrawer.tsx`

**Step 1:** Remplacer ou fusionner `discoveryChartMonthlyData` pour qu’après calcul de la production mensuelle (comme aujourd’hui), chaque mois enrichisse les champs depuis `discoveryFinancialSummary?.batteryByMonth[monthIndex]` quand présent (même forme que `chartData` prospect : `selfConsumptionDirect`, `selfConsumptionViaBattery`, `injectionBattery`, `excess`, `gridDraw`).

**Step 2:** Dépendances du `useMemo` : inclure `discoveryFinancialSummary?.batteryByMonth`, `discoveryFinancialSummary` (ou équivalent stable).

**Step 3:** `npm run lint`

**Step 4:** Commit — `feat(discovery): monthly chart uses battery simulation aggregates`

---

### Task 5: Données journalières avec `runSimulationOneDayForChart`

**Files:**

- Modify: `components/solar-scout/ProspectDrawer.tsx`

**Step 1:** Dans `discoveryChartDailyData`, après `prodDay` / `consDay`, obtenir la batterie scalée comme dans le résumé : `discoveryIncludeBattery && batteryRef ? scaleBatteryForCount(batteryRef, batteryCount) : null` (mêmes `batteryRef` / `count` que Task 2–3).

**Step 2:** Appeler `runSimulationOneDayForChart(prodDay, consDay, batteryForChart)` et mapper les heures avec les mêmes clés que le drawer prospect.

**Step 3:** `npm run lint`

**Step 4:** Commit — `feat(discovery): daily chart uses hourly battery simulation`

---

### Task 6: `discoveryBillReductionCard` aligné sur la simulation

**Files:**

- Modify: `components/solar-scout/ProspectDrawer.tsx`

**Step 1:** Quand `discoveryFinancialSummary?.breakdownFromHourlySim` est vrai, calculer les segments avec `selfConsumptionDirectKwhTotal`, `selfConsumptionViaBatteryKwhTotal`, `injectionReseauKwhTotal` et les tarifs par défaut déjà utilisés ailleurs (`DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH`, `DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH`), sur le modèle de `prospectBillReductionCard`.

**Step 2:** Conserver un repli sur la logique simplifiée actuelle si pas de simulation.

**Step 3:** `npm run lint`

**Step 4:** Commit — `feat(discovery): bill reduction card uses battery breakdown`

---

### Task 7: Vérification globale

**Files:**

- Modify: none sauf correctifs

**Step 1:** `npm run lint` — attendu : succès.

**Step 2:** `npm run test:unit` — attendu : succès (ou corriger tests / ajouter test ciblé si introduit).

**Step 3:** Vérification manuelle : drawer Découverte → onglet Solaire → toggle Batterie, vues mensuelle et journalière.

**Step 4:** Commit final si correctifs — `fix(discovery): chart battery parity follow-ups`

---

## Exécution

Plan enregistré dans ce fichier. Deux options :

1. **Subagent-Driven (cette session)** — une sous-tâche à la fois avec revue.
2. **Session parallèle** — nouvelle session avec le skill `executing-plans` sur une worktree dédiée.

Indiquer l’option souhaitée pour enchaîner l’implémentation.
