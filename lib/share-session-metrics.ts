/** Plafond durée session (24 h) pour rejeter valeurs aberrantes côté client/serveur. */
export const SHARE_SESSION_MAX_DURATION_MS = 86_400_000;

export function clampShareSessionMaxScrollDepth01(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function clampShareSessionDurationMs(
  raw: unknown,
  maxMs: number = SHARE_SESSION_MAX_DURATION_MS
): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), maxMs);
}
