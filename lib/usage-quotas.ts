/**
 * Système de quotas par statut utilisateur (Admin, Premium, Starter, Demo).
 * Contrôle les appels aux APIs BDNB et OSM.
 */

import type { UserProfile } from "./firestore-user-profile";
import type { ProfileStatus } from "@/types";

export type ApiType = "bdnb" | "bdnb_neon" | "osm" | "sitadel_map";

export interface QuotaConfig {
  /** Limite mensuelle (Starter, Premium) ou quotidienne (Demo). null = illimité */
  limit: number | null;
  /** Période: "month" ou "day" */
  period: "month" | "day";
}

const QUOTAS: Record<Exclude<ProfileStatus, "admin">, Record<ApiType, QuotaConfig>> = {
  premium: {
    bdnb: { limit: 5000, period: "month" },
    bdnb_neon: { limit: 20000, period: "month" },
    osm: { limit: 2000, period: "month" },
    sitadel_map: { limit: 8000, period: "month" },
  },
  starter: {
    bdnb: { limit: 500, period: "month" },
    bdnb_neon: { limit: 2000, period: "month" },
    osm: { limit: 200, period: "month" },
    sitadel_map: { limit: 1200, period: "month" },
  },
  demo: {
    bdnb: { limit: 10, period: "day" },
    bdnb_neon: { limit: 50, period: "day" },
    osm: { limit: 5, period: "day" },
    sitadel_map: { limit: 80, period: "day" },
  },
};

/** Timezone Paris pour la réinitialisation quotidienne (Demo) */
const TZ = "Europe/Paris";

function getPeriodStart(period: "month" | "day", now: Date): Date {
  const d = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  if (period === "day") {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toParisDate(ts: Date): Date {
  return new Date(ts.toLocaleString("en-US", { timeZone: TZ }));
}

export interface CheckQuotaResult {
  allowed: boolean;
  resetAt?: string; // ISO string
  current: number;
  limit: number | null;
}

/**
 * Vérifie si l'utilisateur peut effectuer une requête API.
 * Retourne { allowed, resetAt?, current, limit }.
 * Si la période a changé, les compteurs doivent être réinitialisés côté appelant (avant d'incrémenter).
 */
export function checkQuota(
  api: ApiType,
  profile: UserProfile | null,
  now: Date = new Date()
): CheckQuotaResult {
  const status: ProfileStatus = (profile?.status as ProfileStatus) ?? "starter";
  if (status === "admin") {
    return { allowed: true, current: 0, limit: null };
  }
  const config = QUOTAS[status][api];

  if (config.limit === null) {
    return { allowed: true, current: 0, limit: null };
  }

  const periodStart = getPeriodStart(config.period, now);
  const nextPeriodStart = new Date(periodStart);
  if (config.period === "day") {
    nextPeriodStart.setDate(nextPeriodStart.getDate() + 1);
  } else {
    nextPeriodStart.setMonth(nextPeriodStart.getMonth() + 1);
  }

  const creditsResetAt = profile?.creditsResetAt;
  const resetAtDate =
    creditsResetAt && typeof creditsResetAt === "object" && "seconds" in creditsResetAt
      ? new Date(creditsResetAt.seconds * 1000)
      : null;

  const countField =
    api === "bdnb"
      ? "bdnbRequestCount"
      : api === "bdnb_neon"
        ? "bdnbNeonRequestCount"
        : api === "osm"
          ? "osmRequestCount"
          : "sitadelMapRequestCount";
  const current = profile?.[countField] ?? 0;

  const needReset = !resetAtDate || toParisDate(resetAtDate) < periodStart;
  const effectiveCount = needReset ? 0 : current;

  if (effectiveCount >= config.limit) {
    return {
      allowed: false,
      resetAt: nextPeriodStart.toISOString(),
      current: effectiveCount,
      limit: config.limit,
    };
  }

  return {
    allowed: true,
    resetAt: nextPeriodStart.toISOString(),
    current: effectiveCount,
    limit: config.limit,
  };
}

/**
 * Retourne les infos d'affichage des quotas pour l'UI.
 */
export function getQuotaDisplay(profile: UserProfile | null): {
  status: ProfileStatus;
  bdnb: { current: number; limit: number | null; resetAt?: string };
  bdnbNeon: { current: number; limit: number | null; resetAt?: string };
  osm: { current: number; limit: number | null; resetAt?: string };
} {
  const status: ProfileStatus = (profile?.status as ProfileStatus) ?? "starter";
  const bdnbResult = checkQuota("bdnb", profile);
  const bdnbNeonResult = checkQuota("bdnb_neon", profile);
  const osmResult = checkQuota("osm", profile);
  return {
    status,
    bdnb: {
      current: bdnbResult.current,
      limit: bdnbResult.limit,
      resetAt: bdnbResult.resetAt,
    },
    bdnbNeon: {
      current: bdnbNeonResult.current,
      limit: bdnbNeonResult.limit,
      resetAt: bdnbNeonResult.resetAt,
    },
    osm: {
      current: osmResult.current,
      limit: osmResult.limit,
      resetAt: osmResult.resetAt,
    },
  };
}

export function getResetValuesIfNeeded(
  api: ApiType,
  profile: UserProfile | null,
  now: Date = new Date()
): Partial<UserProfile> | null {
  const status: ProfileStatus = (profile?.status as ProfileStatus) ?? "starter";
  if (status === "admin") return null;
  const config = QUOTAS[status][api];
  if (config.limit === null) return null;

  const periodStart = getPeriodStart(config.period, now);
  const creditsResetAt = profile?.creditsResetAt;
  const resetAtDate =
    creditsResetAt && typeof creditsResetAt === "object" && "seconds" in creditsResetAt
      ? new Date(creditsResetAt.seconds * 1000)
      : null;

  const needReset = !resetAtDate || toParisDate(resetAtDate) < periodStart;
  if (!needReset) return null;

  return {
    creditsResetAt: { seconds: Math.floor(periodStart.getTime() / 1000), nanoseconds: 0 },
    bdnbRequestCount: 0,
    bdnbNeonRequestCount: 0,
    osmRequestCount: 0,
    sitadelMapRequestCount: 0,
  };
}
