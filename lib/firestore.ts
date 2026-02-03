import { 
  collection, 
  addDoc, 
  doc, 
  updateDoc, 
  getDoc,
  Timestamp 
} from "firebase/firestore";
import { db } from "./firebase";
import type { Prospect, Lead } from "@/types";

/**
 * Ajoute un prospect au pipeline Firebase
 */
export async function addProspectToPipeline(prospect: Prospect): Promise<string> {
  try {
    const prospectData = {
      ...prospect,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    const docRef = await addDoc(collection(db, "prospects"), prospectData);
    return docRef.id;
  } catch (error) {
    console.error("Erreur lors de l'ajout du prospect:", error);
    throw error;
  }
}

/**
 * Crée un lead à partir d'un prospect
 */
export async function createLeadFromProspect(
  prospectId: string,
  name: string,
  contactName?: string
): Promise<string> {
  try {
    // Récupérer le prospect
    const prospectDoc = await getDoc(doc(db, "prospects", prospectId));
    
    if (!prospectDoc.exists()) {
      throw new Error("Prospect introuvable");
    }

    const prospectData = prospectDoc.data() as Prospect;
    
    const leadData: Omit<Lead, "id"> = {
      prospectId,
      name,
      qualityScore: prospectData.qualityScore,
      contactName,
      thumbnailUrl: prospectData.thumbnailUrl,
      createdAt: new Date(),
    };

    const docRef = await addDoc(collection(db, "leads"), {
      ...leadData,
      createdAt: Timestamp.now(),
    });
    
    return docRef.id;
  } catch (error) {
    console.error("Erreur lors de la création du lead:", error);
    throw error;
  }
}

/**
 * Met à jour un prospect
 */
export async function updateProspect(
  prospectId: string,
  updates: Partial<Prospect>
): Promise<void> {
  try {
    const prospectRef = doc(db, "prospects", prospectId);
    await updateDoc(prospectRef, {
      ...updates,
      updatedAt: Timestamp.now(),
    });
  } catch (error) {
    console.error("Erreur lors de la mise à jour du prospect:", error);
    throw error;
  }
}
