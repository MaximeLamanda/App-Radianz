/**
 * Gestion des références d'onduleurs dans Firebase Firestore
 * Collection : inverter_references (un document par référence, id = ref.id)
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type { InverterReference } from "@/types";
import { DEFAULT_INVERTER_REFERENCES } from "./solar-settings";

const INVERTER_REFERENCES_COLLECTION = "inverter_references";

/** Supprime les champs undefined pour Firestore */
function toFirestoreData(ref: InverterReference): Record<string, unknown> {
  return {
    id: ref.id,
    name: ref.name,
    inverterType: ref.inverterType,
    powerW: ref.powerW,
    efficiencyPercent: ref.efficiencyPercent,
    countryOfOrigin: ref.countryOfOrigin,
    costEur: ref.costEur,
    ...(ref.countryCode != null && { countryCode: ref.countryCode }),
    ...(ref.imageUrl != null && { imageUrl: ref.imageUrl }),
    ...(ref.warrantyYears != null && { warrantyYears: ref.warrantyYears }),
    ...(ref.recommended != null && { recommended: ref.recommended }),
  };
}

/** Reconstruit un InverterReference depuis les données Firestore */
function fromFirestoreData(data: Record<string, unknown>): InverterReference {
  return {
    id: String(data.id ?? ""),
    name: String(data.name ?? ""),
    inverterType: (data.inverterType as InverterReference["inverterType"]) ?? "string_inverter",
    powerW: Number(data.powerW ?? 0),
    efficiencyPercent: Number(data.efficiencyPercent ?? 0),
    countryOfOrigin: String(data.countryOfOrigin ?? ""),
    costEur: Number(data.costEur ?? 0),
    countryCode: data.countryCode != null ? String(data.countryCode) : undefined,
    imageUrl: data.imageUrl != null ? String(data.imageUrl) : undefined,
    warrantyYears: data.warrantyYears != null ? Number(data.warrantyYears) : undefined,
    recommended: data.recommended === true,
  };
}

/**
 * Récupère toutes les références d'onduleurs depuis Firebase
 */
export async function getInverterReferencesFromFirebase(): Promise<InverterReference[]> {
  try {
    const snapshot = await getDocs(collection(db, INVERTER_REFERENCES_COLLECTION));
    if (snapshot.empty) return [];
    const list = snapshot.docs
      .map((d) => fromFirestoreData(d.data()))
      .filter((r) => r.id && r.name);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("Erreur lors de la récupération des références onduleurs Firebase:", error);
    return [];
  }
}

/**
 * Enregistre ou met à jour une référence d'onduleur dans Firebase
 */
export async function saveInverterReferenceToFirebase(ref: InverterReference): Promise<void> {
  try {
    const docRef = doc(db, INVERTER_REFERENCES_COLLECTION, ref.id);
    await setDoc(
      docRef,
      {
        ...toFirestoreData(ref),
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error("Erreur lors de la sauvegarde de la référence onduleur Firebase:", error);
    throw error;
  }
}

/**
 * Supprime une référence d'onduleur dans Firebase
 */
export async function deleteInverterReferenceFromFirebase(id: string): Promise<void> {
  try {
    const docRef = doc(db, INVERTER_REFERENCES_COLLECTION, id);
    await deleteDoc(docRef);
  } catch (error) {
    console.error("Erreur lors de la suppression de la référence onduleur Firebase:", error);
    throw error;
  }
}

/**
 * Sauvegarde toute la liste de références dans Firebase (écrase les documents existants pour ces ids)
 */
export async function saveAllInverterReferencesToFirebase(
  references: InverterReference[]
): Promise<void> {
  try {
    await Promise.all(references.map((ref) => saveInverterReferenceToFirebase(ref)));
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des références onduleurs Firebase:", error);
    throw error;
  }
}

/**
 * Initialise la collection avec les références par défaut si elle est vide
 */
export async function initializeInverterReferencesInFirebase(): Promise<void> {
  try {
    const existing = await getInverterReferencesFromFirebase();
    if (existing.length > 0) {
      console.log(`Références onduleurs déjà présentes (${existing.length}), skip init.`);
      return;
    }
    await saveAllInverterReferencesToFirebase(DEFAULT_INVERTER_REFERENCES);
    console.log(`✅ ${DEFAULT_INVERTER_REFERENCES.length} référence(s) onduleur initialisées dans Firebase`);
  } catch (error) {
    console.error("Erreur lors de l'initialisation des références onduleurs Firebase:", error);
    throw error;
  }
}
