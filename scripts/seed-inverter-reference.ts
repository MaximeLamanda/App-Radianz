/**
 * Pousse une référence onduleur dans Firestore (merge) pour un utilisateur existant.
 * Utile quand la collection inverter_references est déjà initialisée.
 *
 * Usage:
 *   FIREBASE_USER_ID=<uid> npx tsx scripts/seed-inverter-reference.ts
 *   FIREBASE_USER_ID=<uid> npm run seed:inverter-reference
 */

import { saveInverterReferenceToFirebase } from "../lib/firestore-inverter-references";
import { SUN2000_150K_MG0_INVERTER_REFERENCE } from "../lib/solar-settings";

async function main() {
  const userId = process.env.FIREBASE_USER_ID?.trim();
  if (!userId) {
    console.error("❌ Variable FIREBASE_USER_ID requise (uid Firebase Auth de l'utilisateur cible).");
    process.exit(1);
  }

  const ref = SUN2000_150K_MG0_INVERTER_REFERENCE;
  console.log(`🔄 Enregistrement onduleur ${ref.name} pour user ${userId}…`);

  await saveInverterReferenceToFirebase(ref, userId);

  console.log(`✅ Référence ${ref.id} enregistrée (image: ${ref.imageUrl}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Erreur:", err);
  process.exit(1);
});
