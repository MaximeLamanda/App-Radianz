/**
 * Anti-rafale par utilisateur pour `POST /api/apollo/people-search`.
 *
 * Apollo est facturé au crédit : on impose 5 secondes minimum entre deux appels
 * sur la même session/instance. Map mémoire (par instance, pas distribué).
 */

const MIN_INTERVAL_MS = 5000;

const lastCallByUid = new Map<string, number>();

export type ApolloThrottleResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

export function checkApolloThrottle(uid: string): ApolloThrottleResult {
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
