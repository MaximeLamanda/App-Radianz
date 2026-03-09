/**
 * Gestion des références de panneaux solaires dans Firebase Firestore
 * Collection : panel_references (un document par référence, id = ref.id)
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
import type { PanelReference } from "@/types";
import { DEFAULT_PANEL_REFERENCES } from "./solar-settings";

const PANEL_REFERENCES_COLLECTION = "panel_references";

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
  };
}

/**
 * Récupère toutes les références de panneaux depuis Firebase
 */
export async function getPanelReferencesFromFirebase(): Promise<PanelReference[]> {
  try {
    const snapshot = await getDocs(collection(db, PANEL_REFERENCES_COLLECTION));
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
export async function savePanelReferenceToFirebase(ref: PanelReference): Promise<void> {
  try {
    const docRef = doc(db, PANEL_REFERENCES_COLLECTION, ref.id);
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
export async function deletePanelReferenceFromFirebase(id: string): Promise<void> {
  try {
    const docRef = doc(db, PANEL_REFERENCES_COLLECTION, id);
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
  references: PanelReference[]
): Promise<void> {
  try {
    await Promise.all(references.map((ref) => savePanelReferenceToFirebase(ref)));
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des références panneaux Firebase:", error);
    throw error;
  }
}

/**
 * Initialise la collection avec les références par défaut si elle est vide
 */
export async function initializePanelReferencesInFirebase(): Promise<void> {
  try {
    const existing = await getPanelReferencesFromFirebase();
    if (existing.length > 0) {
      console.log(`Références panneaux déjà présentes (${existing.length}), skip init.`);
      return;
    }
    await saveAllPanelReferencesToFirebase(DEFAULT_PANEL_REFERENCES);
    console.log(`✅ ${DEFAULT_PANEL_REFERENCES.length} référence(s) panneau initialisées dans Firebase`);
  } catch (error) {
    console.error("Erreur lors de l'initialisation des références panneaux Firebase:", error);
    throw error;
  }
}
