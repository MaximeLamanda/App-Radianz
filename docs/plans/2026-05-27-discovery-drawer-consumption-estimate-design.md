# Discovery — consommation estimée dans l’onglet Solaire (tiroir)

**Date :** 2026-05-27  
**Statut :** Implémenté (2026-05-27)

## Problème

Dans le tiroir Discovery (onglet **Solaire**), la consommation est calculée uniquement à partir de l’empreinte et du type de bâtiment. Le commercial ne peut pas l’ajuster **en amont** de la propale, alors que la page partagée `/p/` permet au prospect d’affiner sa facture plus tard.

Le graphe production / consommation, le dimensionnement **Perfect fit**, la simulation (batterie, économies, CO₂) et les KPI financiers doivent partager **une même** consommation annuelle pilotée par le commercial.

## Périmètre

| Inclus | Exclu |
|--------|--------|
| Tiroir **Discovery** uniquement (`ProspectDrawerDiscoverySection`, onglet Solaire) | Tiroir prospect scout classique |
| Slider + KPI **MWh/an** + graphe mensuel lecture seule | Saisie mois par mois (réservée à `/p/`) |
| Recalcul live Perfect fit + graphe + simulation | Persistance debounced à chaque mouvement de slider |
| Persistance `annualConsumptionKwhOverride` à **Enregistrer** / **Ajouter au pipeline** | Override Enedis automatique (hors scope) |

## Décisions produit

1. **Premier bloc** de l’onglet Solaire : carte « Consommation estimée » (avant Perfect fit / Highest production).
2. **Point de départ** : estimation surface × profil type (`discoveryAnnualConsumptionKwhFromProfile`).
3. **Réglage** : slider + champ MWh/an ; profil mensuel via `monthlyConsumptionKwhFromAnnualProfile` (saisonnalité conservée).
4. **Perfect fit** : recalcul du kWp cible avec la conso ajustée (`70 % × conso / productible kWh/kWp`), comme `/p/`.
5. **Réinitialiser** : retour à la baseline surface ; à la sauvegarde, pas d’`annualConsumptionKwhOverride` si égal à la baseline (arrondi kWh).
6. **Persistance** : état local dans le tiroir ; écriture Firebase uniquement à l’ajout pipeline ou **Enregistrer** sur un prospect existant.
7. **Réouverture** : si le prospect a déjà `annualConsumptionKwhOverride`, initialiser le slider sur cette valeur.

## UI — ordre onglet Solaire

1. `DiscoveryConsumptionEstimateCard` — KPI MWh/an, hint baseline, slider, champ, Réinitialiser, `MonthlyConsumptionOnlyChart` (lecture seule, MWh uniquement)
2. Onglets Perfect fit / Highest production
3. `ProspectEnergyChartsPanel`
4. Cartes facture / CO₂ / projet (inchangées)

**Slider** : bornes typiques 50 %–200 % de la baseline (avec plancher absolu raisonnable en kWh).

## Flux de données

```
baselineKwh = discoveryAnnualConsumptionKwhFromProfile(placeType, footprintM2)
targetKwh   = state local (init: prospect.annualConsumptionKwhOverride ?? baselineKwh)
monthlyKwh  = monthlyConsumptionKwhFromAnnualProfile(placeType, footprintM2, targetKwh)
```

- `computeDiscoveryKwpEstForPipeline` / `computeDiscoveryChoiceCardsConfig` : paramètre `annualConsumptionKwh` optionnel (défaut = profil surface).
- `buildDiscoveryMonthlyChartData` : accepte `consumptionMonthlyKwh: number[]` (12 valeurs) au lieu de recalculer `getEnergyConsumptionForMonth × m²`.
- `computeDiscoveryDrawerFinancialSummary` : `totalConsumptionKwh` = somme des 12 mois (ou `targetKwh` arrondi).
- Simulation journalière : `buildTypicalConsumptionDayForMonth` reste basé sur le profil type × surface, **scalé** par le ratio `targetKwh / baselineKwh` (ou dérivation depuis `monthlyKwh` du mois) pour cohérence horaire.

**Sauvegarde** (`handleDiscoveryPipelineSave`, `handleDiscoveryAddToPipeline`) :

```ts
annualConsumptionKwhOverride:
  Math.round(targetKwh) !== Math.round(baselineKwh) ? Math.round(targetKwh) : undefined // ou null en Firestore
```

Ne pas persister `monthlyConsumptionKwhOverride` depuis Discovery (le prospect affine sur `/p/`).

## Fichiers impactés

| Fichier | Rôle |
|---------|------|
| `components/discovery/DiscoveryConsumptionEstimateCard.tsx` | Nouveau bloc UI |
| `components/solar-scout/ProspectDrawer.tsx` | State, props, save / add, ordre onglet |
| `lib/discovery-combo-energy-charts.ts` | Conso mensuelle paramétrable |
| `lib/discovery-pipeline-add-financials.ts` | kWp Perfect fit + résumé pipeline |
| `lib/discovery-drawer-financial-summary.ts` | Conso dans simulation pied de drawer |
| `lib/discovery-pipeline-add-financials.test.ts` | Tests kWp avec override conso |
| `lib/discovery-combo-energy-charts.test.ts` | (optionnel) somme barres = target |

## Références

- Page partagée : `app/p/[shareToken]/page.tsx` (`liveAnnualConsumptionKwh`, `MonthlyConsumptionOnlyChart`)
- Profil mensuel : `lib/building-energy-consumption.ts` (`monthlyConsumptionKwhFromAnnualProfile`)
- Modèle : `types/index.ts` (`annualConsumptionKwhOverride`)

## Hors scope

- Couche Enedis sur la carte Discovery comme source du slider
- Édition mensuelle dans le tiroir commercial
- Duplication du bloc sur le tiroir prospect non-Discovery
