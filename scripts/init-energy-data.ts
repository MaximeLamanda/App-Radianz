/**
 * Script pour initialiser les données de consommation énergétique dans Firebase
 * 
 * Usage:
 *   npx tsx scripts/init-energy-data.ts
 * 
 * Ou depuis le code:
 *   import { initializeEnergyConsumptionData } from "@/lib/firestore-energy-data";
 *   await initializeEnergyConsumptionData();
 */

import { initializeEnergyConsumptionData } from "../lib/firestore-energy-data";

async function main() {
  try {
    console.log("🚀 Démarrage de l'initialisation des données de consommation énergétique...");
    await initializeEnergyConsumptionData();
    console.log("✅ Initialisation terminée avec succès!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erreur lors de l'initialisation:", error);
    process.exit(1);
  }
}

main();
