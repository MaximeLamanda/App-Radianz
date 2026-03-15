# Design : Ajout batterie dans Solar-view

**Date :** 2025-03-15  
**Statut :** Validé  
**Périmètre :** Section batterie avec switch (ON par défaut), références batterie, simulation horaire, impact graph / économies / prix.

## Objectif

Ajouter une option batterie au projet solaire : switch (inclure batterie), références batterie comme panneau/onduleur, batterie par défaut au scan, simulation horaire charge/décharge, et impact sur le graphique (autoconsommation directe vs via batterie), les économies et le prix du projet.

## Décisions de conception

| Décision | Choix |
|----------|--------|
| Persistance du switch | Réglage global utilisateur + override par prospect (`includeBatteryOverride`) |
| Références par défaut | Gamme LUNA2000 : 7/14/21-S1 pour < 100 kWp, LUNA2000-215-2S10 pour ≥ 100 kWp |
| Rendu graphique | Distinguer autoconsommation directe et autoconsommation via batterie (4 barres ou 2 empilées) |
| Modèle batterie | Références complètes (BatteryReference) + simulation horaire |

---

## 1. Types et modèle de données

**Nouveau type `BatteryReference`** (`types/index.ts`) :

- `id`, `name`
- `capacityKwh` : capacité utile (kWh)
- `powerChargeKw`, `powerDischargeKw` : puissances max (kW)
- `roundTripEfficiencyPercent` : ex. 90
- `costEur`, `countryOfOrigin`, `countryCode?`, `imageUrl?`, `warrantyYears?`, `recommended?`
- Optionnel : `maxKwpRecommended?: number` (ex. 100) pour suggérer 215-2S10 au-dessus de 100 kWp

**SolarEquipmentSettings** : `includeBattery?: boolean` (défaut `true`).

**Prospect** : `includeBatteryOverride?: boolean` (override par prospect ; si absent, utiliser le réglage global).

---

## 2. Références batterie (Firestore + Settings)

- Collection Firestore : `users/{userId}/battery_references`
- Fichiers : `lib/firestore-battery-references.ts`, hook `useBatteryReferences` dans `lib/swr-hooks.ts`
- SettingsDrawer : onglet Batteries (même pattern que Panneaux/Onduleurs)
- Références par défaut (LUNA2000) :
  - **LUNA2000-7-S1** : 7 kWh, ~10,5 kW, coût ~4–5 k€
  - **LUNA2000-14-S1** : 14 kWh, ~10,5 kW, coût ~7–8 k€
  - **LUNA2000-21-S1** : 21 kWh, ~10,5 kW, coût ~10–11 k€
  - **LUNA2000-215-2S10** : 215 kWh, 108 kW, pour installations ≥ 100 kWp (coût à définir)

---

## 3. Switch « Inclure batterie » et persistance

- **Emplacement** : ProspectDrawer, onglet Projet (à côté du mode Perfect fit / Highest production).
- **Valeur effective** : `prospect.includeBatteryOverride ?? getSolarEquipmentSettings().includeBattery`.
- **Persistance** : 
  - Option A : modifier le prospect uniquement → sauver `includeBatteryOverride` sur le prospect.
  - Option B : proposer « Pour ce prospect » vs « Pour tous » (override vs global).

---

## 4. Batterie par défaut au scan

- À la création du prospect : `includeBattery` vient des settings (défaut `true`).
- Batterie utilisée : référence recommandée (ou première) ; si `effectiveKwp >= 100`, suggérer / utiliser la gamme 215-2S10 si configurée.

---

## 5. Logique de calcul (à définir en brainstorming)

À préciser dans un échange dédié /brainstorming. Points à trancher :

- **Périmètre horaire** : journée type 24 h × 365, ou saisonnier (ex. 4 jours types) ?
- **État initial batterie** : vide en début de jour type, ou état cyclique (état final = état initial) ?
- **Priorités à chaque pas de temps** :
  - Consommation : 1) PV direct, 2) décharge batterie, 3) réseau.
  - Surplus PV : 1) charge batterie (jusqu’à capacité/puissance max), 2) injection.
- **Limites** : puissance max charge/décharge, capacité utile, rendement (symétrique ou charge/décharge séparés).
- **Agrégation** : somme horaire → annuel (ou pondération saisonnière).
- **Valorisation** : autoconsommation directe vs via batterie (même prix retail ?), injection (tarif rachat).

Une fois ces règles fixées, les documenter ici et les implémenter dans `lib/battery-simulation.ts`.

---

## 6. Simulation horaire et impact graph / économies / prix

- **Module** `lib/battery-simulation.ts` : entrées = production 24h, consommation 24h, `BatteryReference` ; sorties = par heure puis agrégées : autoconsommation directe, autoconsommation via batterie, injection, tirage réseau.
- **Graphique** : distinguer autoconsommation directe et via batterie (4 barres ou 2 barres empilées « Autoconsommation »).
- **Prix** : `estimateInstallationPriceEur` et `estimateTotalPriceRangeEur` incluent le coût batterie si batterie incluse.
- **Économies** : basées sur les sorties de la simulation (selfConsumption direct + via batterie valorisés au prix retail, injection au tarif rachat).

---

## 7. Fichiers principaux

| Fichier | Action |
|---------|--------|
| `types/index.ts` | Ajouter `BatteryReference`, `includeBattery` / `includeBatteryOverride` |
| `lib/firestore-battery-references.ts` | Nouveau — CRUD Firestore |
| `lib/battery-simulation.ts` | Nouveau — simulation horaire (logique à finaliser en §5) |
| `lib/solar-settings.ts` | Références par défaut LUNA2000, prix/économies avec batterie |
| `lib/swr-hooks.ts` | `useBatteryReferences` |
| `components/solar-scout/SettingsDrawer.tsx` | Onglet Batteries, formulaire référence |
| `components/solar-scout/Sidebar.tsx` | `BatteryReferenceForm` |
| `components/solar-scout/ProspectDrawer.tsx` | Switch batterie, override, intégration simulation + prix/économies |
| `components/solar-scout/MonthlyProductionChart.tsx` | 4 séries (autoconsommation directe, via batterie, injection, tirage) |
| `app/p/[shareToken]/page.tsx` | Même logique batterie pour la page partagée |

---

## Références

- Contexte matériel actuel : `lib/firestore-panel-references.ts`, `lib/firestore-inverter-references.ts`, `components/solar-scout/SettingsDrawer.tsx`
- Graph et économies : `lib/solar-settings.ts`, `components/solar-scout/MonthlyProductionChart.tsx`, `lib/pvgis.ts` (`buildTypicalDayFromMonthly`, `getProductionFromPerKwp`)
- Specs LUNA2000 : Huawei LUNA2000-7/14/21-S1, LUNA2000-215-2S10 (capacités, puissances, ordres de grandeur prix)
