/**
 * Profil utilisateur (données complémentaires à Firebase Auth).
 * Stocké dans Firestore : users/{uid}
 *
 * Pour que la lecture/écriture fonctionne, déployer les règles Firestore :
 *   firebase deploy --only firestore:rules
 */

import { doc, getDoc, setDoc, increment } from "firebase/firestore";
import { db } from "./firebase";
import type { ProfileStatus } from "@/types";

export interface UserProfile {
  phone?: string;
  firstName?: string;
  lastName?: string;
  /** Nombre de requêtes BDNB dans la période courante (mois ou jour selon statut) */
  bdnbRequestCount?: number;
  /** Nombre de requêtes BDNB (via Neon) dans la période courante (mois ou jour selon statut) */
  bdnbNeonRequestCount?: number;
  /** Statut du profil : admin, premium, starter, demo. Défaut: starter */
  status?: ProfileStatus;
  /** Nombre de requêtes OSM dans la période courante (mois ou jour selon statut) */
  osmRequestCount?: number;
  /** Nombre de requêtes carte Sitadel dans la période courante (mois ou jour selon statut) */
  sitadelMapRequestCount?: number;
  /** Début de la période courante (réinitialisation mensuelle ou quotidienne selon statut) */
  creditsResetAt?: { seconds: number; nanoseconds: number };
  // Onboarding
  companyName?: string;
  companyLogoUrl?: string;
  defaultPanelRefId?: string;
  defaultInverterRefId?: string;
  defaultBatteryRefId?: string;
  companySize?: "solo" | "2-10" | "11-50" | "50+";
  geoZones?: string[];
  onboardingCompleted?: boolean;
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

/** Incrémente le compteur de requêtes BDNB pour l'utilisateur (fire-and-forget, ne bloque pas l'UI) */
export async function incrementBdnbRequestCount(uid: string): Promise<void> {
  try {
    const ref = doc(db, COLLECTION, uid);
    await setDoc(ref, { bdnbRequestCount: increment(1) }, { merge: true });
  } catch (error) {
    if (isPermissionError(error)) {
      console.warn("[BDNB] Incrément compteur: règles Firestore ou accès refusé");
    } else {
      console.warn("[BDNB] Incrément compteur:", error);
    }
  }
}

/** Incrémente le compteur de requêtes BDNB Neon pour l'utilisateur (fire-and-forget, ne bloque pas l'UI) */
export async function incrementBdnbNeonRequestCount(uid: string): Promise<void> {
  try {
    const ref = doc(db, COLLECTION, uid);
    await setDoc(ref, { bdnbNeonRequestCount: increment(1) }, { merge: true });
  } catch (error) {
    if (isPermissionError(error)) {
      console.warn("[BDNB-NEON] Incrément compteur: règles Firestore ou accès refusé");
    } else {
      console.warn("[BDNB-NEON] Incrément compteur:", error);
    }
  }
}

/** Incrémente le compteur de requêtes OSM pour l'utilisateur (fire-and-forget, ne bloque pas l'UI) */
export async function incrementOsmRequestCount(uid: string): Promise<void> {
  try {
    const ref = doc(db, COLLECTION, uid);
    await setDoc(ref, { osmRequestCount: increment(1) }, { merge: true });
  } catch (error) {
    if (isPermissionError(error)) {
      console.warn("[OSM] Incrément compteur: règles Firestore ou accès refusé");
    } else {
      console.warn("[OSM] Incrément compteur:", error);
    }
  }
}
