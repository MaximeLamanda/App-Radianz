# Plan d'implémentation : Ajout batterie Solar-view

**Référence design :** [2025-03-15-batterie-design.md](./2025-03-15-batterie-design.md)  
**Prérequis :** Finaliser la section « Logique de calcul » du design (brainstorming dédié) avant ou en parallèle du module de simulation.

---

## Phase 1 — Types et références batterie

1. **Types** (`types/index.ts`)
   - Ajouter l’interface `BatteryReference` (id, name, capacityKwh, powerChargeKw, powerDischargeKw, roundTripEfficiencyPercent, costEur, countryOfOrigin, countryCode?, imageUrl?, warrantyYears?, recommended?, maxKwpRecommended?).
   - Étendre `SolarEquipmentSettings` avec `includeBattery?: boolean`.
   - Étendre `Prospect` avec `includeBatteryOverride?: boolean`.

2. **Firestore batterie**
   - Créer `lib/firestore-battery-references.ts` : `getBatteryReferencesFromFirebase`, `saveBatteryReferenceToFirebase`, `deleteBatteryReferenceFromFirebase`, sérialisation Firestore (toFirestoreData / fromFirestoreData).
   - Ajouter dans `lib/swr-hooks.ts` le hook `useBatteryReferences(userId)`.

3. **Références par défaut**
   - Dans `lib/solar-settings.ts` : `DEFAULT_BATTERY_REFERENCES` (LUNA2000-7-S1, 14-S1, 21-S1, 215-2S10 avec capacités/prix), `getBatteryReferences`, `saveBatteryReferences`, `getRecommendedBatteryReferenceSync`, `getRecommendedBatteryReference(userId)`.
   - Stockage local optionnel (comme panneaux/onduleurs) si besoin avant synchro Firestore.

4. **SettingsDrawer**
   - Ajouter l’onglet « Batteries » (ou 3 onglets Panneaux | Onduleurs | Batteries).
   - Liste des références, bouton Ajouter, édition/suppression, switch « Recommandé ».
   - Créer `BatteryReferenceForm` dans `Sidebar.tsx` (sur le modèle de PanelReferenceForm / InverterReferenceForm).

---

## Phase 2 — Switch et persistance

5. **Réglage global**
   - S’assurer que `getSolarEquipmentSettings()` / `saveSolarEquipmentSettings()` gèrent `includeBattery` (défaut `true`).

6. **ProspectDrawer**
   - Afficher le switch « Inclure batterie » (valeur effective = `prospect.includeBatteryOverride ?? settings.includeBattery`).
   - Au changement : soit mettre à jour `includeBatteryOverride` sur le prospect (et sauvegarder le prospect), soit proposer « Pour ce prospect » / « Pour tous » selon UX retenue.
   - Passer `usedBatteryRef` (batterie recommandée ou sélectionnée) et `includeBattery` aux calculs.

7. **Firestore prospect**
   - Dans `lib/firestore-prospect.ts` : ajouter `includeBatteryOverride` dans la sérialisation / désérialisation du prospect (prepareProspectForFirestore, prospectFromFirestore).

---

## Phase 3 — Simulation batterie et logique de calcul

8. **Logique de calcul**
   - Tenir compte du résultat du brainstorming « Logique de calcul » (section 5 du design) pour les règles exactes (état initial, priorités, rendements, agrégation).

9. **Module `lib/battery-simulation.ts`**
   - Entrées : `dailyProductionKwh: number[]` (24h), `dailyConsumptionKwh: number[]` (24h), `BatteryReference`.
   - Implémenter la boucle heure par heure (charge/décharge, limites capacité et puissance).
   - Sorties : par heure puis agrégées — `selfConsumptionDirectKwh`, `selfConsumptionViaBatteryKwh`, `excessKwh`, `gridDrawKwh` (et éventuellement séries 24h pour le graph).

10. **Intégration économies**
    - Étendre ou créer `estimateAnnualSavingsEurWithBattery` dans `lib/solar-settings.ts` à partir des sorties de la simulation (valorisation autoconsommation directe + via batterie au prix retail, injection au tarif rachat).
    - Sans batterie : garder le comportement actuel `estimateAnnualSavingsEurWithBreakdown`.

---

## Phase 4 — Prix et équipement

11. **Prix équipement**
    - Étendre `estimateInstallationPriceEur` pour accepter un paramètre optionnel batterie (BatteryReference | null) et ajouter le coût batterie si présent.
    - `estimateTotalPriceRangeEur` : l’argument `equipmentEur` inclut déjà panneaux + onduleurs + batterie (calculé en amont).

12. **ProspectDrawer (calculs)**
    - Si `includeBattery` : utiliser la simulation pour les économies et alimenter le graph ; inclure le coût batterie dans le prix.
    - Sinon : comportement actuel (pas de simulation, pas de coût batterie).
    - Break-even : inchangé (prix total / économies annuelles).

---

## Phase 5 — Graphique

13. **MonthlyProductionChart**
    - Accepter des données avec 4 séries : autoconsommation directe, autoconsommation via batterie, injection, tirage réseau.
    - Adapter la config du chart et les Bar/stackId pour afficher ces 4 barres (ou 2 empilées pour autoconsommation) selon le design UX retenu.

14. **ProspectDrawer (données chart)**
    - En mode avec batterie : calculer les données du chart à partir des sorties de la simulation (mensuel = agrégation du jour type × 30/31 selon mois ; journalier = 24h de la simulation).
    - Passer ces données au `MonthlyProductionChart`.

---

## Phase 6 — Page partagée et finition

15. **Page partagée** (`app/p/[shareToken]/page.tsx`)
    - Lire `includeBatteryOverride` ou réglage par défaut ; récupérer la batterie recommandée (ou défaut).
    - Réutiliser la même logique de simulation, prix et économies que dans ProspectDrawer.
    - Afficher le switch batterie si la page permet de modifier les options (sinon affichage en lecture seule cohérent).

16. **Init Firestore**
    - Optionnel : route ou script d’init des références batterie par défaut pour les utilisateurs existants (comme pour panneaux/onduleurs).

17. **Tests et recette**
    - Vérifier : création prospect avec batterie ON par défaut ; override par prospect ; calculs prix/économies avec et sans batterie ; graph 4 séries ; cohérence page partagée.

---

## Ordre recommandé

1. Phase 1 (types + Firestore + Settings + UI références).  
2. Phase 2 (switch + persistance prospect).  
3. Finaliser section 5 du design (brainstorming logique de calcul), puis Phase 3 (simulation + économies).  
4. Phase 4 (prix).  
5. Phase 5 (graph).  
6. Phase 6 (page partagée + init + recette).
