# Données de Consommation Énergétique par Type de Bâtiment

Ce document décrit la structure de données pour la consommation énergétique typique par type de bâtiment Google Places API.

## Structure des Données

Les données sont stockées dans Firebase Firestore dans la collection `building_energy_consumption` avec la structure suivante :

```typescript
{
  googlePlaceType: string;      // Type exact Google Places API (ex: "supermarket", "warehouse")
  category: string;              // Catégorie regroupée (retail, office, warehouse, etc.)
  consumptionKwhPerM2: number;   // Consommation annuelle en kWh/m²/an
  source: string;                // Source des données
  notes?: string;                // Notes additionnelles
  createdAt: Date;               // Date de création
  updatedAt: Date;               // Date de mise à jour
}
```

## Sources des Données

Les valeurs sont basées sur :
- **UK BEES Survey 2024** (Building Energy Efficiency Survey)
- **UK ND-NEED 2024** (Non-Domestic National Energy Efficiency Data)
- **US EIA** (Energy Information Administration) - Commercial Buildings Energy Consumption Survey

## Valeurs par Type de Bâtiment

### Retail / Commerce
- **Store / Magasin général** : 168 kWh/m²/an
- **Shopping Mall** : 200 kWh/m²/an
- **Electronics Store** : 180 kWh/m²/an
- **Convenience Store** : 250 kWh/m²/an

### Supermarchés
- **Supermarket / Grocery** : 350 kWh/m²/an (réfrigération intensive)

### Restaurants / Hospitality
- **Restaurant** : 464 kWh/m²/an (parmi les plus énergivores)
- **Cafe** : 300 kWh/m²/an
- **Bar** : 350 kWh/m²/an

### Bureaux
- **Office** : 190 kWh/m²/an
- **Bank** : 200 kWh/m²/an
- **Lawyer / Accounting** : 170-180 kWh/m²/an

### Entrepôts
- **Warehouse / Storage** : 55 kWh/m²/an (parmi les plus faibles)

### Industriel
- **Factory / Industrial** : 100 kWh/m²/an
- **Manufacturing** : 120 kWh/m²/an

### Sport / Fitness
- **Gym / Fitness Center** : 250 kWh/m²/an
- **Swimming Pool** : 400 kWh/m²/an (chauffage de l'eau)

## Initialisation dans Firebase

Pour initialiser les données dans Firebase, exécutez :

```typescript
import { initializeEnergyConsumptionData } from "@/lib/firestore-energy-data";

await initializeEnergyConsumptionData();
```

Ou utilisez le script :

```bash
npx tsx scripts/init-energy-data.ts
```

## Utilisation dans le Code

### Récupérer la consommation pour un type de bâtiment

```typescript
import { getEnergyConsumptionFromFirebase } from "@/lib/firestore-energy-data";

const data = await getEnergyConsumptionFromFirebase("supermarket");
console.log(data?.consumptionKwhPerM2); // 350
```

### Utiliser les données locales (sans Firebase)

```typescript
import { getEnergyConsumption } from "@/lib/building-energy-consumption";

const consumption = getEnergyConsumption("supermarket");
console.log(consumption); // 350
```

### Calculer la consommation annuelle totale

```typescript
import { getEnergyConsumptionFromFirebase } from "@/lib/firestore-energy-data";

async function calculateAnnualConsumption(
  googlePlaceType: string,
  buildingAreaM2: number
): Promise<number> {
  const data = await getEnergyConsumptionFromFirebase(googlePlaceType);
  if (!data) return 0;
  
  return data.consumptionKwhPerM2 * buildingAreaM2;
}

// Exemple : Supermarché de 1000 m²
const annualConsumption = await calculateAnnualConsumption("supermarket", 1000);
console.log(annualConsumption); // 350,000 kWh/an
```

## Mise à Jour des Données

Pour mettre à jour les données d'un type de bâtiment :

```typescript
import { updateEnergyConsumptionData } from "@/lib/firestore-energy-data";

await updateEnergyConsumptionData("supermarket", {
  consumptionKwhPerM2: 360,
  notes: "Mise à jour avec nouvelles données 2024"
});
```

## Notes Importantes

1. **Valeurs moyennes** : Les valeurs sont des moyennes et peuvent varier selon :
   - La taille du bâtiment (les petits bâtiments consomment plus par m²)
   - La région/climat
   - L'âge et l'efficacité énergétique du bâtiment
   - Les heures d'ouverture

2. **Valeurs par défaut** : Si un type de bâtiment n'est pas trouvé, la valeur par défaut est **150 kWh/m²/an** (catégorie "other")

3. **Sources** : Les données proviennent principalement de sources UK et US. Pour une application française, il serait recommandé d'utiliser des données ADEME (Agence de l'Environnement et de la Maîtrise de l'Énergie) si disponibles.

## Intégration avec le Potentiel Solaire

Ces données peuvent être utilisées pour calculer le potentiel solaire :

```typescript
async function calculateSolarPotential(
  googlePlaceType: string,
  roofAreaM2: number,
  solarProductionKwhPerM2: number // Production solaire typique par m² de panneau
): Promise<{
  annualConsumption: number;
  solarProduction: number;
  coveragePercentage: number;
}> {
  const energyData = await getEnergyConsumptionFromFirebase(googlePlaceType);
  if (!energyData) {
    throw new Error("Type de bâtiment non trouvé");
  }
  
  // Estimation de la surface de toit disponible (ex: 50% de la surface au sol)
  const availableRoofArea = roofAreaM2 * 0.5;
  
  // Consommation annuelle estimée (basée sur la surface au sol)
  const buildingAreaM2 = roofAreaM2; // Approximation
  const annualConsumption = energyData.consumptionKwhPerM2 * buildingAreaM2;
  
  // Production solaire possible
  const solarProduction = availableRoofArea * solarProductionKwhPerM2;
  
  // Pourcentage de couverture
  const coveragePercentage = Math.min(100, (solarProduction / annualConsumption) * 100);
  
  return {
    annualConsumption,
    solarProduction,
    coveragePercentage
  };
}
```
