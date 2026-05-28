/**
 * Gestion des références d'onduleurs dans Firebase Firestore
 * Collection : users/{userId}/inverter_references (un document par référence, id = ref.id)
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type { InverterReference } from "@/types";
import { DEFAULT_INVERTER_REFERENCES } from "./solar-settings";

/** Supprime les champs undefined pour Firestore */
export function inverterReferenceToFirestore(ref: InverterReference): Record<string, unknown> {
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
    ...(ref.visible != null && { visible: ref.visible }),
  };
}

/** Reconstruit un InverterReference depuis les données Firestore */
export function inverterReferenceFromFirestore(data: Record<string, unknown>): InverterReference {
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
    visible: data.visible !== false,
  };
}

/**
 * Récupère toutes les références d'onduleurs depuis Firebase pour un utilisateur
 */
export async function getInverterReferencesFromFirebase(userId: string): Promise<InverterReference[]> {
  if (!userId) return [];
  try {
    const colRef = collection(db, "users", userId, "inverter_references");
    const snapshot = await getDocs(colRef);
    if (snapshot.empty) return [];
    const list = snapshot.docs
      .map((d) => inverterReferenceFromFirestore(d.data()))
      .filter((r) => r.id && r.name);
    const sorted = list.sort((a, b) => a.name.localeCompare(b.name));
    const visibleCount = sorted.filter((r) => r.visible !== false).length;
    console.log("[Firestore] getInverterReferences", { total: sorted.length, visible: visibleCount, refs: sorted.map((r) => ({ id: r.id, name: r.name, visible: r.visible })) });
    return sorted;
  } catch (error) {
    console.error("Erreur lors de la récupération des références onduleurs Firebase:", error);
    return [];
  }
}

/**
 * Enregistre ou met à jour une référence d'onduleur dans Firebase
 */
export async function saveInverterReferenceToFirebase(ref: InverterReference, userId: string): Promise<void> {
  if (!userId) throw new Error("userId requis pour sauvegarder une référence onduleur");
  console.log("[Firestore] saveInverterReference", { refId: ref.id, name: ref.name, visible: ref.visible });
  try {
    const docRef = doc(db, "users", userId, "inverter_references", ref.id);
    await setDoc(
      docRef,
      {
        ...inverterReferenceToFirestore(ref),
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
export async function deleteInverterReferenceFromFirebase(id: string, userId: string): Promise<void> {
  if (!userId) throw new Error("userId requis pour supprimer une référence onduleur");
  try {
    const docRef = doc(db, "users", userId, "inverter_references", id);
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
  references: InverterReference[],
  userId: string
): Promise<void> {
  if (!userId) throw new Error("userId requis pour sauvegarder les références onduleurs");
  try {
    await Promise.all(references.map((ref) => saveInverterReferenceToFirebase(ref, userId)));
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des références onduleurs Firebase:", error);
    throw error;
  }
}

/**
 * Initialise la sous-collection avec les références par défaut si elle est vide
 */
export async function initializeInverterReferencesInFirebase(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const existing = await getInverterReferencesFromFirebase(userId);
    if (existing.length > 0) {
      console.log(`Références onduleurs déjà présentes (${existing.length}), skip init.`);
      return;
    }
    await saveAllInverterReferencesToFirebase(DEFAULT_INVERTER_REFERENCES, userId);
    console.log(`✅ ${DEFAULT_INVERTER_REFERENCES.length} référence(s) onduleur initialisées dans Firebase`);
  } catch (error) {
    console.error("Erreur lors de l'initialisation des références onduleurs Firebase:", error);
    throw error;
  }
}
