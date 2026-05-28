# Discovery drawer — consommation estimée (onglet Solaire) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Premier bloc de l’onglet Solaire Discovery : KPI MWh/an réglable (slider), baseline surface, graphe conso lecture seule ; alimente Perfect fit, simulation et graphe prod/conso ; persiste `annualConsumptionKwhOverride` à l’ajout pipeline / Enregistrer.

**Architecture:** État `discoveryTargetAnnualKwh` dans `ProspectDrawer`, dérivé en `monthlyKwh` via `monthlyConsumptionKwhFromAnnualProfile`. Étendre les helpers Discovery (`computeDiscoveryKwpEstForPipeline`, `buildDiscoveryMonthlyChartData`, résumé financier) pour accepter la conso explicite. Composant UI dédié `DiscoveryConsumptionEstimateCard`.

**Tech Stack:** Next.js, React, TypeScript, Recharts (`MonthlyConsumptionOnlyChart`), Firestore prospect (`annualConsumptionKwhOverride`), Vitest.

**Design:** `docs/plans/2026-05-27-discovery-drawer-consumption-estimate-design.md`

---

### Task 1: Paramètre conso dans `computeDiscoveryKwpEstForPipeline`

**Files:**
- Modify: `lib/discovery-pipeline-add-financials.ts`
- Test: `lib/discovery-pipeline-add-financials.test.ts`

**Step 1: Write the failing test**

```ts
it("perfect fit kWp uses annualConsumptionKwh when provided", () => {
  const footprintM2 = 500;
  const pvgisAnnualPerKwp = 1100;
  const panelRef = /* fixture */;
  const baseline = discoveryAnnualConsumptionKwhFromProfile("other", footprintM2);
  const doubled = baseline * 2;
  const kwpBaseline = computeDiscoveryKwpEstForPipeline({
    footprintM2,
    pvgisAnnualPerKwp,
    panelRef,
    placeType: "other",
  });
  const kwpDoubled = computeDiscoveryKwpEstForPipeline({
    footprintM2,
    pvgisAnnualPerKwp,
    panelRef,
    placeType: "other",
    annualConsumptionKwh: doubled,
  });
  expect(kwpDoubled).toBeGreaterThan(kwpBaseline);
});
```

**Step 2: Run test**

Run: `npm test -- lib/discovery-pipeline-add-financials.test.ts -t "annualConsumptionKwh"`
Expected: FAIL (unknown param)

**Step 3: Implement**

Add optional `annualConsumptionKwh?: number` to `computeDiscoveryKwpEstForPipeline` and `computeDiscoveryChoiceCardsConfig`; use it instead of `discoveryAnnualConsumptionKwhFromProfile` when `> 0`.

**Step 4: Run test** — PASS

---

### Task 2: `buildDiscoveryMonthlyChartData` avec série conso explicite

**Files:**
- Modify: `lib/discovery-combo-energy-charts.ts`
- Create: `lib/discovery-combo-energy-charts.test.ts` (si absent)

**Step 1: Failing test**

```ts
it("uses consumptionMonthlyKwh when length is 12", () => {
  const monthly = Array(12).fill(1000);
  const data = buildDiscoveryMonthlyChartData({
    /* pvgis fixture, kwp, footprint */,
    consumptionMonthlyKwh: monthly,
  });
  expect(data.every((d, i) => d.consumption === 1000)).toBe(true);
});
```

**Step 2–4:** Implement param `consumptionMonthlyKwh?: number[]`; fallback comportement actuel (`getEnergyConsumptionForMonth × footprint`).

---

### Task 3: Résumé financier Discovery avec conso cible

**Files:**
- Modify: `lib/discovery-drawer-financial-summary.ts`
- Modify: `lib/discovery-pipeline-add-financials.ts` (`computeDiscoveryPipelineFinancialSummaryFromInputs`)

**Step 1:** Ajouter `annualConsumptionKwh?: number` (ou `consumptionMonthlyKwh`) aux params de `computeDiscoveryDrawerFinancialSummary`.

**Step 2:** `totalConsumptionKwh` = somme des 12 mois dérivés de `monthlyConsumptionKwhFromAnnualProfile` quand override fourni.

**Step 3:** Vérifier que `computeDiscoveryPipelineFinancialSummaryAtAdd` propage le paramètre depuis les inputs du drawer (à brancher en Task 5).

---

### Task 4: `DiscoveryConsumptionEstimateCard`

**Files:**
- Create: `components/discovery/DiscoveryConsumptionEstimateCard.tsx`

**Contenu minimal:**
- Props: `baselineAnnualKwh`, `targetAnnualKwh`, `onTargetAnnualKwhChange`, `placeType`, `footprintM2` (pour dériver `monthlyKwh` en interne ou recevoir `monthlyKwh` déjà calculé)
- Affichage KPI MWh/an (`target / 1000`, 1 décimale)
- Hint « Estimation : X MWh/an » si `round(target) !== round(baseline)`
- Slider `min={baseline * 0.5}` `max={baseline * 2}` (clamp kWh entiers)
- Input MWh synchronisé
- Bouton Réinitialiser → `onTargetAnnualKwhChange(baseline)`
- `MonthlyConsumptionOnlyChart` avec `monthlyKwh` dérivé, sans `onUnitModeChange` / sans grille sous le total

Style : reprendre `radianzDefaultCardClass` / bordures comme les autres cartes Discovery.

---

### Task 5: State et câblage dans `ProspectDrawer`

**Files:**
- Modify: `components/solar-scout/ProspectDrawer.tsx`

**Step 1:** Dans le parent (là où `discoveryRow` / `discoveryExistingPipelineProspect` vivent) :

```ts
const discoveryBaselineAnnualKwh = useMemo(
  () => discoveryAnnualConsumptionKwhFromProfile(placeType, discoveryFootprintSumM2),
  [placeType, discoveryFootprintSumM2]
);
const [discoveryTargetAnnualKwh, setDiscoveryTargetAnnualKwh] = useState<number | null>(null);
// Reset when combo/footprint changes: setDiscoveryTargetAnnualKwh(null)
const effectiveTargetKwh = discoveryTargetAnnualKwh ?? discoveryExistingPipelineProspect?.annualConsumptionKwhOverride ?? discoveryBaselineAnnualKwh;
const discoveryMonthlyConsumptionKwh = useMemo(
  () => monthlyConsumptionKwhFromAnnualProfile(placeType, discoveryFootprintSumM2, effectiveTargetKwh),
  [placeType, discoveryFootprintSumM2, effectiveTargetKwh]
);
```

**Step 2:** Passer props à `ProspectDrawerDiscoverySection` : `targetAnnualKwh`, `baselineAnnualKwh`, `monthlyConsumptionKwh`, `onTargetAnnualKwhChange`.

**Step 3:** Dans la section Discovery :
- Insérer `DiscoveryConsumptionEstimateCard` en tête de `<TabsContent value="solaire">`
- Passer `annualConsumptionKwh: effectiveTargetKwh` à `computeDiscoveryChoiceCardsConfig`
- Passer `consumptionMonthlyKwh` à `buildDiscoveryMonthlyChartData`
- Remplacer `discoveryAnnualConsumptionKwh` par `effectiveTargetKwh` pour bill / CO₂
- Scaler simulation journalière : ratio `effectiveTargetKwh / baseline` sur `consDay` OU utiliser mois courant depuis `monthlyConsumptionKwh`

**Step 4:** `onPipelineFinanceInputsChange` — inclure `annualConsumptionKwh` si le callback est étendu (optionnel, pour batterie reco).

**Step 5:** `discoveryRecommendedBatteryKwh` — utiliser `effectiveTargetKwh` au lieu de `discoveryAnnualConsumptionKwhFromProfile` hardcodé.

---

### Task 6: Persistance Firebase

**Files:**
- Modify: `components/solar-scout/ProspectDrawer.tsx` (`handleDiscoveryPipelineSave`, `handleDiscoveryAddToPipeline`)
- Modify: `lib/firestore-prospect.ts` (vérifier que `prepareProspectForFirestore` sérialise déjà `annualConsumptionKwhOverride`)

**Step 1:** Helper local :

```ts
function discoveryConsumptionOverrideForSave(targetKwh: number, baselineKwh: number): number | undefined {
  const t = Math.round(targetKwh);
  const b = Math.round(baselineKwh);
  return t !== b && t > 0 ? t : undefined;
}
```

**Step 2:** Dans `draftForPipeline` / `updatedProspect`, spread :

```ts
...(override != null ? { annualConsumptionKwhOverride: override } : { annualConsumptionKwhOverride: undefined }),
```

Pour save sur prospect existant : si retour baseline, envoyer `null` pour effacer l’override en Firestore (selon API `updateProspect` existante).

---

### Task 7: Tests manuels + Vitest globaux

**Step 1:** Run: `npm test -- lib/discovery-pipeline-add-financials.test.ts lib/discovery-combo-energy-charts.test.ts lib/building-energy-consumption.test.ts`

**Step 2:** Manuel (dev server) :
1. Ouvrir un combo Discovery → onglet Solaire
2. Vérifier bloc conso en premier, baseline affichée
3. Bouger slider → MWh/an, barres conso du graphe prod, kWp Perfect fit changent
4. Réinitialiser → retour baseline
5. Ajouter au pipeline → rouvrir → override conservé si différent de baseline
6. Page `/p/` → total annuel cohérent avec override commercial

---

## Ordre d’exécution recommandé

1 → 2 → 3 → 4 → 5 → 6 → 7

## Notes

- Ne pas dupliquer la logique `/p/` (pas de `editedBillMonthlyKwh` dans le tiroir).
- `placeType` Discovery : utiliser `discoveryPlaceType` existant dans la section, pas `"other"` en dur pour la batterie reco.
- Garder le diff minimal dans `ProspectDrawer.tsx` : extraire le composant carte limite la taille du patch.
