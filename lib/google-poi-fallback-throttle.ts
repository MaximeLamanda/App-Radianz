/**
 * Intervalle minimum entre deux POST fallback Google+api.gouv par utilisateur (anti rafale).
 * Un POST peut enchaîner jusqu’à 5 appels api.gouv — intervalle un peu plus large.
 */
/** findLocalSiren peut enchaîner plusieurs requêtes par POI (jusqu’à 5 POI). */
const MIN_INTERVAL_MS = 12000;

const lastCallByUid = new Map<string, number>();

export type GooglePoiFallbackThrottleResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/**
 * Garde-fou par instance (Map mémoire). Retourne retryAfterSeconds si trop tôt.
 */
export function checkGooglePoiFallbackThrottle(uid: string): GooglePoiFallbackThrottleResult {
  const now = Date.now();
  const last = lastCallByUid.get(uid) ?? 0;
  const elapsed = now - last;
  if (elapsed < MIN_INTERVAL_MS) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((MIN_INTERVAL_MS - elapsed) / 1000)),
    };
  }
  lastCallByUid.set(uid, now);
  return { ok: true };
}
