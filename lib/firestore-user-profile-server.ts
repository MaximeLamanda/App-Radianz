/**
 * Accès serveur au profil utilisateur via Firebase Admin.
 * Utilisé dans les routes API pour vérifier les quotas.
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "./firebase-admin";
import type { UserProfile } from "./firestore-user-profile";

const COLLECTION = "users";

/**
 * Récupère le profil utilisateur côté serveur (Firebase Admin).
 * Utilise Firestore Admin pour contourner les règles de sécurité.
 */
export async function getServerUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const db = getAdminDb();
    const ref = db.collection(COLLECTION).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) return null;
    return snap.data() as UserProfile;
  } catch (error) {
    console.warn("[getServerUserProfile]", error);
    return null;
  }
}

/**
 * Réinitialise les compteurs et creditsResetAt pour une nouvelle période.
 */
export async function resetProfileCounters(
  uid: string,
  data: Partial<UserProfile> & { creditsResetAt: { seconds: number; nanoseconds: number } }
): Promise<void> {
  try {
    const db = getAdminDb();
    const ref = db.collection(COLLECTION).doc(uid);
    await ref.set(
      {
        creditsResetAt: new Timestamp(data.creditsResetAt.seconds, data.creditsResetAt.nanoseconds),
        bdnbRequestCount: data.bdnbRequestCount ?? 0,
        osmRequestCount: data.osmRequestCount ?? 0,
        sitadelMapRequestCount: data.sitadelMapRequestCount ?? 0,
      },
      { merge: true }
    );
  } catch (error) {
    console.warn("[resetProfileCounters]", error);
  }
}

/**
 * Incrémente le compteur BDNB ou OSM côté serveur.
 */
export async function incrementServerCount(
  uid: string,
  field: "bdnbRequestCount" | "osmRequestCount" | "sitadelMapRequestCount"
): Promise<void> {
  try {
    const db = getAdminDb();
    const ref = db.collection(COLLECTION).doc(uid);
    await ref.set({ [field]: FieldValue.increment(1) }, { merge: true });
  } catch (error) {
    console.warn(`[incrementServerCount ${field}]`, error);
  }
}
