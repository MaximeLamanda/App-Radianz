/**
 * Firebase Admin SDK pour la vérification des tokens et l'accès Firestore côté serveur.
 * Utilisé dans les routes API (BDNB, OSM) pour l'authentification et les quotas.
 */

import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let adminApp: App | null = null;

function getAdminApp(): App {
  if (adminApp) return adminApp;
  const existing = getApps();
  if (existing.length > 0) {
    adminApp = existing[0] as App;
    return adminApp;
  }
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "solarview-8aec9";

  if (privateKey && clientEmail) {
    adminApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } else {
    try {
      adminApp = initializeApp({ projectId });
    } catch (e) {
      console.warn("[firebase-admin] Pas de credentials. Configurez FIREBASE_PRIVATE_KEY et FIREBASE_CLIENT_EMAIL pour les quotas.");
      throw e;
    }
  }
  return adminApp;
}

/** Vérifie le token Firebase et retourne l'UID, ou null si invalide. */
export async function verifyIdToken(idToken: string): Promise<string | null> {
  try {
    const app = getAdminApp();
    const auth = getAuth(app);
    const decoded = await auth.verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    return null;
  }
}

/** Firestore Admin (accès sans règles utilisateur, pour lecture users/{uid}). */
export function getAdminDb() {
  const app = getAdminApp();
  return getFirestore(app);
}
