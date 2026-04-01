/**
 * Données du référent commercial (personne qui génère le lien).
 * Peut être construites à partir de l'utilisateur connecté ou du mock/localStorage.
 */

import type { CommercialReferent } from "@/types";
import type { UserProfile } from "@/lib/firestore-user-profile";

const STORAGE_KEY = "commercialReferent";

/** Valeurs par défaut mock */
export const DEFAULT_COMMERCIAL_REFERENT: CommercialReferent = {
  name: "Jean Dupont",
  email: "jean.dupont@exemple.fr",
  phone: "+33 6 12 34 56 78",
  company: "Solar Pro France",
  logoUrl: undefined,
  calendlyUrl: undefined,
};

/**
 * Récupère le référent commercial (localStorage ou mock).
 */
export function getCommercialReferent(): CommercialReferent {
  if (typeof window === "undefined") {
    return DEFAULT_COMMERCIAL_REFERENT;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as CommercialReferent;
      return {
        ...DEFAULT_COMMERCIAL_REFERENT,
        ...parsed,
      };
    }
  } catch (error) {
    console.error("Erreur lecture commercial referent:", error);
  }
  return DEFAULT_COMMERCIAL_REFERENT;
}

/**
 * Construit un CommercialReferent à partir de l'utilisateur connecté (Auth + profil Firestore).
 * Utilisé lors de la génération du lien pour enregistrer l'identité de la personne qui a généré la page.
 */
export function buildCommercialReferentFromUser(
  user: { displayName?: string | null; email?: string | null; phoneNumber?: string | null; photoURL?: string | null },
  userProfile: UserProfile | null
): CommercialReferent {
  const name =
    user.displayName?.trim() ||
    (userProfile?.firstName || userProfile?.lastName
      ? [userProfile.firstName, userProfile.lastName].filter(Boolean).join(" ").trim()
      : "") ||
    user.email?.split("@")[0] ||
    "";
  const email = user.email?.trim() || "";
  const phone = user.phoneNumber?.trim() || userProfile?.phone?.trim() || undefined;
  const photoURL = user.photoURL?.trim() || undefined;
  const company = userProfile?.companyName?.trim() || undefined;
  const logoUrl = userProfile?.companyLogoUrl?.trim() || undefined;
  return {
    name,
    email,
    ...(phone && { phone }),
    ...(photoURL && { photoURL }),
    ...(company && { company }),
    ...(logoUrl && { logoUrl }),
  };
}

/**
 * Sauvegarde le référent commercial dans localStorage.
 */
export function saveCommercialReferent(referent: CommercialReferent): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(referent));
  } catch (error) {
    console.error("Erreur sauvegarde commercial referent:", error);
  }
}
