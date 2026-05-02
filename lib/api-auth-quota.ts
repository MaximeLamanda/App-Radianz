/**
 * Vérification auth + quotas pour les routes API BDNB et OSM.
 */

import { NextResponse } from "next/server";
import { verifyIdToken } from "./firebase-admin";
import { getServerUserProfile, resetProfileCounters, incrementServerCount } from "./firestore-user-profile-server";
import { checkQuota, getResetValuesIfNeeded, type ApiType } from "./usage-quotas";

export interface AuthQuotaContext {
  uid: string;
}

export type AuthQuotaResult =
  | { ok: true; context: AuthQuotaContext }
  | { ok: false; response: NextResponse };

/**
 * Vérifie uniquement l'authentification Firebase (Bearer), sans quota ni lecture Firestore profil.
 */
export async function requireAuth(request: Request): Promise<AuthQuotaResult> {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authentification requise. Connectez-vous pour utiliser cette API." },
        { status: 401 }
      ),
    };
  }

  const uid = await verifyIdToken(token);
  if (!uid) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Token invalide ou expiré. Reconnectez-vous." },
        { status: 401 }
      ),
    };
  }

  return { ok: true, context: { uid } };
}

/**
 * Vérifie l'authentification et les quotas.
 * Retourne { ok: true, context } ou { ok: false, response } en cas d'erreur.
 */
export async function requireAuthAndQuota(
  request: Request,
  api: ApiType
): Promise<AuthQuotaResult> {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult;
  const { uid } = authResult.context;

  let profile = await getServerUserProfile(uid);

  const resetValues = getResetValuesIfNeeded(api, profile);
  if (resetValues) {
    await resetProfileCounters(uid, resetValues as Parameters<typeof resetProfileCounters>[1]);
    profile = { ...profile, ...resetValues } as typeof profile;
  }

  const result = checkQuota(api, profile);
  if (!result.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "quota_exceeded",
          message: `Quota ${api.toUpperCase()} atteint. Réessayez après le prochain reset.`,
          resetAt: result.resetAt,
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, context: { uid } };
}

/**
 * Incrémente le compteur après une requête réussie (fire-and-forget).
 */
export function incrementQuotaAfterSuccess(uid: string, api: ApiType): void {
  const field =
    api === "bdnb"
      ? "bdnbRequestCount"
      : api === "osm"
        ? "osmRequestCount"
        : "sitadelMapRequestCount";
  incrementServerCount(uid, field).catch((err) => {
    console.warn(`[${api}] Increment quota:`, err);
  });
}
