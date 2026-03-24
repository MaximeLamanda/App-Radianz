/**
 * Gestion des références de panneaux solaires dans Firebase Firestore
 * Collection : users/{userId}/panel_references (un document par référence, id = ref.id)
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
import type { PanelReference } from "@/types";
import { DEFAULT_PANEL_REFERENCES } from "./solar-settings";

/** Supprime les champs undefined pour Firestore */
function toFirestoreData(ref: PanelReference): Record<string, unknown> {
  return {
    id: ref.id,
    name: ref.name,
    panelType: ref.panelType,
    powerW: ref.powerW,
    efficiencyPercent: ref.efficiencyPercent,
    countryOfOrigin: ref.countryOfOrigin,
    costEur: ref.costEur,
    ...(ref.countryCode != null && { countryCode: ref.countryCode }),
    ...(ref.widthM != null && ref.widthM > 0 && { widthM: ref.widthM }),
    ...(ref.lengthM != null && ref.lengthM > 0 && { lengthM: ref.lengthM }),
    ...(ref.imageUrl != null && { imageUrl: ref.imageUrl }),
    ...(ref.warrantyYears != null && { warrantyYears: ref.warrantyYears }),
    ...(ref.recommended != null && { recommended: ref.recommended }),
    ...(ref.visible != null && { visible: ref.visible }),
  };
}

/** Reconstruit un PanelReference depuis les données Firestore */
function fromFirestoreData(data: Record<string, unknown>): PanelReference {
  return {
    id: String(data.id ?? ""),
    name: String(data.name ?? ""),
    panelType: (data.panelType as PanelReference["panelType"]) ?? "monocrystalline",
    powerW: Number(data.powerW ?? 0),
    efficiencyPercent: Number(data.efficiencyPercent ?? 0),
    countryOfOrigin: String(data.countryOfOrigin ?? ""),
    costEur: Number(data.costEur ?? 0),
    countryCode: data.countryCode != null ? String(data.countryCode) : undefined,
    widthM: data.widthM != null && Number(data.widthM) > 0 ? Number(data.widthM) : (data.surfaceM2 != null && Number(data.surfaceM2) > 0 ? 1 : undefined),
    lengthM: data.lengthM != null && Number(data.lengthM) > 0 ? Number(data.lengthM) : (data.surfaceM2 != null && Number(data.surfaceM2) > 0 ? Number(data.surfaceM2) : undefined),
    imageUrl: data.imageUrl != null ? String(data.imageUrl) : undefined,
    warrantyYears: data.warrantyYears != null ? Number(data.warrantyYears) : undefined,
    recommended: data.recommended === true,
    visible: data.visible === true,
  };
}

/**
 * Récupère toutes les références de panneaux depuis Firebase pour un utilisateur
 */
export async function getPanelReferencesFromFirebase(userId: string): Promise<PanelReference[]> {
  if (!userId) return [];
  try {
    const colRef = collection(db, "users", userId, "panel_references");
    const snapshot = await getDocs(colRef);
    if (snapshot.empty) return [];
    const list = snapshot.docs
      .map((d) => fromFirestoreData(d.data()))
      .filter((r) => r.id && r.name);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error("Erreur lors de la récupération des références panneaux Firebase:", error);
    return [];
  }
}

/**
 * Enregistre ou met à jour une référence de panneau dans Firebase
 */
export async function savePanelReferenceToFirebase(ref: PanelReference, userId: string): Promise<void> {
  if (!userId) throw new Error("userId requis pour sauvegarder une référence panneau");
  try {
    const docRef = doc(db, "users", userId, "panel_references", ref.id);
    await setDoc(
      docRef,
      {
        ...toFirestoreData(ref),
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error("Erreur lors de la sauvegarde de la référence panneau Firebase:", error);
    throw error;
  }
}

/**
 * Supprime une référence de panneau dans Firebase
 */
export async function deletePanelReferenceFromFirebase(id: string, userId: string): Promise<void> {
  if (!userId) throw new Error("userId requis pour supprimer une référence panneau");
  try {
    const docRef = doc(db, "users", userId, "panel_references", id);
    await deleteDoc(docRef);
  } catch (error) {
    console.error("Erreur lors de la suppression de la référence panneau Firebase:", error);
    throw error;
  }
}

/**
 * Sauvegarde toute la liste de références dans Firebase (écrase les documents existants pour ces ids)
 */
export async function saveAllPanelReferencesToFirebase(
  references: PanelReference[],
  userId: string
): Promise<void> {
  if (!userId) throw new Error("userId requis pour sauvegarder les références panneaux");
  try {
    await Promise.all(references.map((ref) => savePanelReferenceToFirebase(ref, userId)));
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des références panneaux Firebase:", error);
    throw error;
  }
}

/**
 * Initialise la sous-collection avec les références par défaut si elle est vide
 */
export async function initializePanelReferencesInFirebase(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const existing = await getPanelReferencesFromFirebase(userId);
    if (existing.length > 0) {
      console.log(`Références panneaux déjà présentes (${existing.length}), skip init.`);
      return;
    }
    await saveAllPanelReferencesToFirebase(DEFAULT_PANEL_REFERENCES, userId);
    console.log(`✅ ${DEFAULT_PANEL_REFERENCES.length} référence(s) panneau initialisées dans Firebase`);
  } catch (error) {
    console.error("Erreur lors de l'initialisation des références panneaux Firebase:", error);
    throw error;
  }
}
