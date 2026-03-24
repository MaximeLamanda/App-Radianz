/**
 * Gestion des références de batteries dans Firebase Firestore
 * Collection : users/{userId}/battery_references (un document par référence, id = ref.id)
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
import type { BatteryReference } from "@/types";
import { DEFAULT_BATTERY_REFERENCES } from "./solar-settings";

/** Supprime les champs undefined pour Firestore */
function toFirestoreData(ref: BatteryReference): Record<string, unknown> {
  return {
    id: ref.id,
    name: ref.name,
    capacityKwh: ref.capacityKwh,
    powerChargeKw: ref.powerChargeKw,
    powerDischargeKw: ref.powerDischargeKw,
    roundTripEfficiencyPercent: ref.roundTripEfficiencyPercent,
    costEur: ref.costEur,
    countryOfOrigin: ref.countryOfOrigin,
    ...(ref.countryCode != null && { countryCode: ref.countryCode }),
    ...(ref.imageUrl != null && { imageUrl: ref.imageUrl }),
    ...(ref.warrantyYears != null && { warrantyYears: ref.warrantyYears }),
    ...(ref.recommended != null && { recommended: ref.recommended }),
    ...(ref.maxKwpRecommended != null && { maxKwpRecommended: ref.maxKwpRecommended }),
    ...(ref.maxBatteriesPerRack != null && { maxBatteriesPerRack: ref.maxBatteriesPerRack }),
    ...(ref.visible != null && { visible: ref.visible }),
  };
}

/** Reconstruit un BatteryReference depuis les données Firestore */
function fromFirestoreData(data: Record<string, unknown>): BatteryReference {
  return {
    id: String(data.id ?? ""),
    name: String(data.name ?? ""),
    capacityKwh: Number(data.capacityKwh ?? 0),
    powerChargeKw: Number(data.powerChargeKw ?? 0),
    powerDischargeKw: Number(data.powerDischargeKw ?? 0),
    roundTripEfficiencyPercent: Number(data.roundTripEfficiencyPercent ?? 90),
    costEur: Number(data.costEur ?? 0),
    countryOfOrigin: String(data.countryOfOrigin ?? ""),
    countryCode: data.countryCode != null ? String(data.countryCode) : undefined,
    imageUrl: data.imageUrl != null ? String(data.imageUrl) : undefined,
    warrantyYears: data.warrantyYears != null ? Number(data.warrantyYears) : undefined,
    recommended: data.recommended === true,
    maxKwpRecommended: data.maxKwpRecommended != null ? Number(data.maxKwpRecommended) : undefined,
    maxBatteriesPerRack: data.maxBatteriesPerRack != null ? Number(data.maxBatteriesPerRack) : undefined,
    visible: data.visible !== false,
  };
}

/**
 * Récupère toutes les références de batteries depuis Firebase pour un utilisateur
 */
export async function getBatteryReferencesFromFirebase(userId: string): Promise<BatteryReference[]> {
  if (!userId) return [];
  try {
    const colRef = collection(db, "users", userId, "battery_references");
    const snapshot = await getDocs(colRef);
    if (snapshot.empty) return [];
    const list = snapshot.docs
      .map((d) => fromFirestoreData(d.data()))
      .filter((r) => r.id && r.name);
    const sorted = list.sort((a, b) => a.name.localeCompare(b.name));
    const visibleCount = sorted.filter((r) => r.visible !== false).length;
    console.log("[Firestore] getBatteryReferences", { total: sorted.length, visible: visibleCount, refs: sorted.map((r) => ({ id: r.id, name: r.name, visible: r.visible })) });
    return sorted;
  } catch (error) {
    console.error("Erreur lors de la récupération des références batteries Firebase:", error);
    return [];
  }
}

/**
 * Enregistre ou met à jour une référence de batterie dans Firebase
 */
export async function saveBatteryReferenceToFirebase(ref: BatteryReference, userId: string): Promise<void> {
  if (!userId) throw new Error("userId requis pour sauvegarder une référence batterie");
  console.log("[Firestore] saveBatteryReference", { refId: ref.id, name: ref.name, visible: ref.visible });
  try {
    const docRef = doc(db, "users", userId, "battery_references", ref.id);
    await setDoc(
      docRef,
      {
        ...toFirestoreData(ref),
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error("Erreur lors de la sauvegarde de la référence batterie Firebase:", error);
    throw error;
  }
}

/**
 * Supprime une référence de batterie dans Firebase
 */
export async function deleteBatteryReferenceFromFirebase(id: string, userId: string): Promise<void> {
  if (!userId) throw new Error("userId requis pour supprimer une référence batterie");
  try {
    const docRef = doc(db, "users", userId, "battery_references", id);
    await deleteDoc(docRef);
  } catch (error) {
    console.error("Erreur lors de la suppression de la référence batterie Firebase:", error);
    throw error;
  }
}

/**
 * Sauvegarde toute la liste de références dans Firebase (écrase les documents existants pour ces ids)
 */
export async function saveAllBatteryReferencesToFirebase(
  references: BatteryReference[],
  userId: string
): Promise<void> {
  if (!userId) throw new Error("userId requis pour sauvegarder les références batteries");
  try {
    await Promise.all(references.map((ref) => saveBatteryReferenceToFirebase(ref, userId)));
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des références batteries Firebase:", error);
    throw error;
  }
}

/**
 * Initialise la sous-collection avec les références par défaut si elle est vide
 */
export async function initializeBatteryReferencesInFirebase(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const existing = await getBatteryReferencesFromFirebase(userId);
    if (existing.length > 0) {
      console.log(`Références batteries déjà présentes (${existing.length}), skip init.`);
      return;
    }
    await saveAllBatteryReferencesToFirebase(DEFAULT_BATTERY_REFERENCES, userId);
    console.log(`✅ ${DEFAULT_BATTERY_REFERENCES.length} référence(s) batterie initialisées dans Firebase`);
  } catch (error) {
    console.error("Erreur lors de l'initialisation des références batteries Firebase:", error);
    throw error;
  }
}
