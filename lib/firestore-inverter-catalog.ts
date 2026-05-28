/**
 * Catalogue global d'onduleurs (Firestore : inverter_catalog/{refId}).
 * Lecture publique ; alimenté par scripts/admin (DEFAULT_INVERTER_REFERENCES).
 */

import { collection, doc, getDocs, setDoc, Timestamp } from "firebase/firestore";
import { db } from "./firebase";
import type { InverterReference } from "@/types";
import { DEFAULT_INVERTER_REFERENCES } from "./solar-settings";
import {
  inverterReferenceFromFirestore,
  inverterReferenceToFirestore,
} from "./firestore-inverter-references";

const CATALOG_COLLECTION = "inverter_catalog";

/**
 * Catalogue global : Firestore si peuplé, sinon défauts embarqués (dev / avant seed).
 */
export async function getInverterCatalogFromFirebase(): Promise<InverterReference[]> {
  try {
    const colRef = collection(db, CATALOG_COLLECTION);
    const snapshot = await getDocs(colRef);
    if (snapshot.empty) {
      return [...DEFAULT_INVERTER_REFERENCES].sort((a, b) => a.name.localeCompare(b.name));
    }
    const list = snapshot.docs
      .map((d) => inverterReferenceFromFirestore(d.data()))
      .filter((r) => r.id && r.name);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("Erreur lecture catalogue onduleurs:", error);
    return [...DEFAULT_INVERTER_REFERENCES].sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Enregistre ou met à jour une entrée du catalogue global */
export async function saveInverterCatalogEntryToFirebase(ref: InverterReference): Promise<void> {
  const docRef = doc(db, CATALOG_COLLECTION, ref.id);
  await setDoc(
    docRef,
    {
      ...inverterReferenceToFirestore(ref),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );
}

/** Alimente le catalogue à partir des références par défaut (idempotent) */
export async function seedInverterCatalogFromDefaults(): Promise<number> {
  await Promise.all(
    DEFAULT_INVERTER_REFERENCES.map((ref) => saveInverterCatalogEntryToFirebase(ref))
  );
  return DEFAULT_INVERTER_REFERENCES.length;
}
