/**
 * Alimente le catalogue global inverter_catalog depuis DEFAULT_INVERTER_REFERENCES.
 *
 * Usage:
 *   npx tsx scripts/seed-inverter-catalog.ts
 *   npm run seed:inverter-catalog
 */

import { seedInverterCatalogFromDefaults } from "../lib/firestore-inverter-catalog";

async function main() {
  console.log("🔄 Alimentation du catalogue global onduleurs…");
  const count = await seedInverterCatalogFromDefaults();
  console.log(`✅ ${count} référence(s) enregistrée(s) dans inverter_catalog.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Erreur:", err);
  process.exit(1);
});
