# Initialisation des Données de Consommation Énergétique dans Firebase

## Méthode 1 : Via l'interface web (Recommandé)

1. Démarrez le serveur de développement :
   ```bash
   npm run dev
   ```

2. Ouvrez votre navigateur et allez à :
   ```
   http://localhost:3000/admin/init-energy-data
   ```

3. Cliquez sur le bouton "Initialiser les données dans Firebase"

4. Les données seront ajoutées dans la collection `building_energy_consumption` de Firebase Firestore

## Méthode 2 : Via l'API directement

Vous pouvez aussi appeler l'API directement :

```bash
curl http://localhost:3000/api/init-energy-data
```

Ou depuis le navigateur :
```
http://localhost:3000/api/init-energy-data
```

## Vérification dans Firebase Console

Après l'initialisation, vous pouvez vérifier dans Firebase Console :

1. Allez sur [Firebase Console](https://console.firebase.google.com/)
2. Sélectionnez votre projet `solarview-8aec9`
3. Allez dans Firestore Database
4. Vous devriez voir la collection `building_energy_consumption` avec tous les types de bâtiments

## Structure des données dans Firebase

Chaque document dans `building_energy_consumption` contient **par type de bâtiment** la consommation annuelle, la moyenne mensuelle, le **détail par mois** (janvier à décembre) et le **profil horaire** (24 h) :

```json
{
  "googlePlaceType": "supermarket",
  "category": "supermarket",
  "consumptionKwhPerM2": 350,
  "consumptionKwhPerM2PerMonth": 29.2,
  "consumptionKwhPerM2ByMonth": [33.6, 30.6, 29.2, 26.9, 25.7, 26.3, 27.7, 27.7, 28.6, 29.8, 32.1, 33.6],
  "consumptionKwhPerM2PerHours": [0.014, 0.011, ...],
  "source": "US EIA - Food sales parmi les plus énergivores",
  "notes": "Réfrigération intensive",
  "createdAt": "<Timestamp>",
  "updatedAt": "<Timestamp>"
}
```

- `consumptionKwhPerM2ByMonth` : tableau de 12 valeurs en kWh/m² (index 0 = janvier, 11 = décembre), profil saisonnier (chauffage hiver, climatisation été).
- `consumptionKwhPerM2PerHours` : tableau de 24 valeurs en kWh/m² par heure (index 0 = 0h-1h, 23 = 23h-24h), profil horaire type tertiaire.

## Utilisation dans le code

Une fois les données initialisées :

```typescript
import {
  getEnergyConsumptionFromFirebase,
  getEnergyConsumptionForMonthFromFirebase,
  getHourlyConsumptionProfileFromFirebase,
  getEnergyConsumptionForHourFromFirebase,
} from "@/lib/firestore-energy-data";

// Tout le type de bâtiment (annuel + détail par mois)
const data = await getEnergyConsumptionFromFirebase("supermarket");
console.log(data?.consumptionKwhPerM2); // 350
console.log(data?.consumptionKwhPerM2ByMonth); // [33.6, 30.6, ...]

// Consommation pour un mois donné (0 = janvier, 11 = décembre)
const jan = await getEnergyConsumptionForMonthFromFirebase("supermarket", 0);

// Profil horaire (24 valeurs kWh/m² par heure) — à utiliser de préférence
const hourlyProfile = await getHourlyConsumptionProfileFromFirebase("supermarket");
const consumptionAt14h = await getEnergyConsumptionForHourFromFirebase("supermarket", 14);
```

### Intégrer le profil horaire (consumptionKwhPerM2PerHours) dans Firebase

Si les documents existaient avant l’ajout du champ horaire, exécutez une fois :

```bash
npm run update-hourly-consumption
```

ou `npx tsx scripts/update-hourly-consumption-firebase.ts`. Cela met à jour (merge) uniquement `consumptionKwhPerM2PerHours` pour chaque type de bâtiment.

## Notes importantes

- Cette opération peut être exécutée plusieurs fois sans problème (les données seront mises à jour)
- Les données sont basées sur des études UK et US - pour une application française, considérez utiliser des données ADEME si disponibles
- La valeur par défaut pour les types non trouvés est 150 kWh/m²/an
