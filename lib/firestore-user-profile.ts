/**
 * Profil utilisateur (données complémentaires à Firebase Auth).
 * Stocké dans Firestore : users/{uid}
 *
 * Pour que la lecture/écriture fonctionne, déployer les règles Firestore :
 *   firebase deploy --only firestore:rules
 */

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export interface UserProfile {
  phone?: string;
  firstName?: string;
  lastName?: string;
}

const COLLECTION = "users";

function isPermissionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("permission") || msg.includes("PERMISSION_DENIED");
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const ref = doc(db, COLLECTION, uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as UserProfile;
  } catch (error) {
    if (isPermissionError(error)) {
      console.warn("Firestore users/ : règles non déployées ou accès refusé. Déployer avec: firebase deploy --only firestore:rules");
      return null;
    }
    throw error;
  }
}

/** Retire les champs undefined (Firestore n'accepte pas undefined) */
function removeUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Record<string, unknown>;
}

export async function setUserProfile(uid: string, data: Partial<UserProfile>): Promise<void> {
  const ref = doc(db, COLLECTION, uid);
  const clean = removeUndefined(data as Record<string, unknown>);
  if (Object.keys(clean).length === 0) return;
  try {
    await setDoc(ref, clean, { merge: true });
  } catch (error) {
    if (isPermissionError(error)) {
      throw new Error("Règles Firestore non déployées. Exécutez : firebase deploy --only firestore:rules");
    }
    throw error;
  }
}
