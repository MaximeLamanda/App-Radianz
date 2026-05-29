/**
 * Supprime tous les documents de la collection Firestore `prospects`
 * (y compris la sous-collection `shareSessions` sur chaque prospect).
 *
 * Schéma cible pour les futurs enregistrements : `ProspectDocument` dans
 * `lib/firestore-prospect.ts` (via `prepareProspectForFirestore`).
 *
 * Non touché : `users/*`, références matériel, `building_energy_consumption`,
 * `inverter_catalog`, leads Postgres (`scout_leads`), etc.
 *
 * Prérequis Admin SDK (dans `.env.local` ou l’environnement) :
 *   FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL, FIREBASE_PROJECT_ID (optionnel)
 *
 * Usage :
 *   DRY_RUN=1 npx tsx scripts/purge-firestore-prospects.ts
 *   CONFIRM_PURGE=1 npx tsx scripts/purge-firestore-prospects.ts
 *   CONFIRM_PURGE=1 PURGE_FIRESTORE_LEADS=1 npx tsx scripts/purge-firestore-prospects.ts
 *
 * npm :
 *   npm run firebase:purge-prospects:dry
 *   npm run firebase:purge-prospects
 */

import path from "node:path";
import { loadDotenvMap } from "./lib/resolve-database-url.mjs";
import { getAdminDb } from "../lib/firebase-admin";

const PROSPECTS_COLLECTION = "prospects";
const LEGACY_LEADS_COLLECTION = "leads";
const PAGE_SIZE = 500;

function applyDotenvLocal(): void {
  const dot = loadDotenvMap(path.join(process.cwd(), ".env.local"));
  for (const [key, value] of Object.entries(dot)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function countCollection(collectionId: string): Promise<number> {
  const db = getAdminDb();
  const col = db.collection(collectionId);
  let total = 0;
  let lastId: string | undefined;

  for (;;) {
    let q = col.orderBy("__name__").limit(PAGE_SIZE);
    if (lastId) q = q.startAfter(lastId);
    const snap = await q.get();
    if (snap.empty) break;
    total += snap.size;
    lastId = snap.docs[snap.docs.length - 1]!.id;
    if (snap.size < PAGE_SIZE) break;
  }
  return total;
}

async function sampleProspectIds(limit: number): Promise<string[]> {
  const db = getAdminDb();
  const snap = await db.collection(PROSPECTS_COLLECTION).orderBy("__name__").limit(limit).get();
  return snap.docs.map((d) => d.id);
}

async function main(): Promise<void> {
  applyDotenvLocal();

  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  const confirm = process.env.CONFIRM_PURGE === "1";
  const purgeLegacyLeads = process.env.PURGE_FIRESTORE_LEADS === "1";

  const projectId =
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    "solarview-8aec9";

  if (!dryRun && !confirm) {
    console.error(
      "[purge-prospects] Refus d’exécuter sans garde-fou.\n" +
        "  • DRY_RUN=1     → compte les documents sans supprimer\n" +
        "  • CONFIRM_PURGE=1 → suppression réelle (irréversible)"
    );
    process.exit(1);
  }

  if (!process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
    console.error(
      "[purge-prospects] FIREBASE_PRIVATE_KEY et FIREBASE_CLIENT_EMAIL requis (compte de service Admin)."
    );
    process.exit(1);
  }

  console.error(`[purge-prospects] Projet Firebase : ${projectId}`);
  console.error(`[purge-prospects] Mode : ${dryRun ? "DRY_RUN (aucune suppression)" : "SUPPRESSION"}`);

  const prospectCount = await countCollection(PROSPECTS_COLLECTION);
  const legacyLeadCount = purgeLegacyLeads ? await countCollection(LEGACY_LEADS_COLLECTION) : 0;

  console.log(`\nCollection « ${PROSPECTS_COLLECTION} » : ${prospectCount} document(s)`);
  if (purgeLegacyLeads) {
    console.log(`Collection « ${LEGACY_LEADS_COLLECTION} » (legacy Firestore) : ${legacyLeadCount} document(s)`);
  }

  if (prospectCount > 0) {
    const samples = await sampleProspectIds(5);
    console.log(`Exemples d’IDs : ${samples.join(", ") || "(aucun)"}`);
  }

  if (dryRun) {
    console.error(
      "\n[purge-prospects] DRY_RUN terminé. Relance avec CONFIRM_PURGE=1 pour supprimer définitivement."
    );
    console.error(
      "Les liens publics /p/{shareToken} existants ne fonctionneront plus après purge."
    );
    return;
  }

  const db = getAdminDb();

  if (prospectCount > 0) {
    console.error(`\n[purge-prospects] Suppression récursive de « ${PROSPECTS_COLLECTION} »…`);
    await db.recursiveDelete(db.collection(PROSPECTS_COLLECTION));
    console.log(`✓ ${prospectCount} prospect(s) supprimé(s) (sous-collections incluses).`);
  } else {
    console.log("✓ Collection prospects déjà vide.");
  }

  if (purgeLegacyLeads && legacyLeadCount > 0) {
    console.error(`[purge-prospects] Suppression de « ${LEGACY_LEADS_COLLECTION} » (legacy)…`);
    await db.recursiveDelete(db.collection(LEGACY_LEADS_COLLECTION));
    console.log(`✓ ${legacyLeadCount} lead(s) Firestore legacy supprimé(s).`);
  }

  const remaining = await countCollection(PROSPECTS_COLLECTION);
  if (remaining !== 0) {
    console.error(`[purge-prospects] Attention : il reste ${remaining} document(s) dans prospects.`);
    process.exit(1);
  }

  console.error("\n[purge-prospects] Terminé. Ré-enregistrez les prospects via l’app (schéma actuel).");
}

main().catch((err) => {
  console.error("[purge-prospects] Erreur:", err);
  process.exit(1);
});
