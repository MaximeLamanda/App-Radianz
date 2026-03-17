# Démarche de calcul production / autoconsommation

Une seule chaîne de calcul, avec ou sans batterie.

## Principe

1. **Journalier (horaire)**  
   Pour chaque heure de l'année (12 mois × jours du mois × 24 h, plafonné à 365 jours), on applique la même logique :
   - **Autoconsommation directe** = min(production, consommation).
   - Conso restante et surplus PV :
     - **Avec batterie** : décharge batterie puis réseau ; charge batterie puis injection réseau.
     - **Sans batterie** : conso restante → tirage réseau ; surplus → injection réseau.

2. **Consolidation mensuelle**  
   Pour chaque mois, on somme les flux horaires du mois → `byMonth[month]` (direct, via batterie, injection batterie, injection réseau, tirage réseau).

3. **Consolidation annuelle**  
   Les totaux annuels sont la somme des 12 mois (ou la somme directe dans la même boucle).

## Implémentation

- **Une seule fonction** : `runProductionSimulation(productionTypicalDayByMonth, consumptionTypicalDayByMonth, battery?)`.
  - `battery` optionnel : si absent ou `null`, pas de batterie (même boucle, pas de SoC).
  - Retour : même type (totaux annuels + `byMonth`). Sans batterie, `selfConsumptionViaBatteryKwh` et `injectionBatteryKwh` à 0.
- **Vue journalière** : une seule fonction qui, selon présence de batterie, appelle la simu un jour (ou deux avec report) et retourne le détail horaire.
- **Page / drawer** : un seul appel à `runProductionSimulation` avec `battery: includeBattery ? usedBatteryRef : null` lorsque les profils mensuels sont disponibles ; sinon fallback annuel (sans détail par poste).

## Résultat

- Autoconsommation directe (et tous les postes) identiques avec ou sans batterie lorsque les profils sont disponibles.
- Code simplifié : une voie de calcul, pas de duplication.
