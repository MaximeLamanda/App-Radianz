/**
 * Script pour intégrer consumptionKwhPerM2PerHours dans la collection Firebase
 * building_energy_consumption pour chaque type de bâtiment.
 *
 * Usage:
 *   npx tsx scripts/update-hourly-consumption-firebase.ts
 *
 * Ce script met à jour (merge) uniquement le champ consumptionKwhPerM2PerHours
 * sur les documents existants, ou crée les documents avec toutes les données
 * si vous préférez tout réécrire, exécutez plutôt l’init complète :
 *   npx tsx scripts/init-energy-data.ts
 */

import { doc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { BUILDING_ENERGY_CONSUMPTION_DATA } from "../lib/building-energy-consumption";

const ENERGY_DATA_COLLECTION = "building_energy_consumption";

async function main() {
  console.log("🔄 Mise à jour de consumptionKwhPerM2PerHours dans Firebase...\n");

  let updated = 0;

  for (const data of BUILDING_ENERGY_CONSUMPTION_DATA) {
    const docRef = doc(db, ENERGY_DATA_COLLECTION, data.googlePlaceType);

    if (!data.consumptionKwhPerM2PerHours || data.consumptionKwhPerM2PerHours.length !== 24) {
      console.warn(`⚠️ ${data.googlePlaceType}: pas de profil horaire valide (24h), ignoré.`);
      continue;
    }

    await setDoc(
      docRef,
      {
        consumptionKwhPerM2PerHours: data.consumptionKwhPerM2PerHours,
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );

    updated++;
    console.log(`  ✓ ${data.googlePlaceType}`);
  }

  console.log(`\n✅ ${updated} types de bâtiments mis à jour avec consumptionKwhPerM2PerHours.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Erreur:", err);
  process.exit(1);
});
