/** Plafond durée session (24 h) pour rejeter valeurs aberrantes côté client/serveur. */
export const SHARE_SESSION_MAX_DURATION_MS = 86_400_000;
export const SHARE_SESSION_MAX_COUNTER = 1_000_000;

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

export function clampShareSessionCounter(
  raw: unknown,
  max: number = SHARE_SESSION_MAX_COUNTER
): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), max);
}

function finiteOrZero(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Calcule la profondeur de scroll (0..1) de manière robuste
 * en combinant différentes sources navigateur (window/document/body).
 */
export function computeShareSessionScrollDepth01(input: {
  scrollY?: unknown;
  pageYOffset?: unknown;
  docScrollTop?: unknown;
  bodyScrollTop?: unknown;
  innerHeight?: unknown;
  docClientHeight?: unknown;
  docScrollHeight?: unknown;
  bodyScrollHeight?: unknown;
}): number {
  const scrollTop = Math.max(
    0,
    finiteOrZero(input.scrollY),
    finiteOrZero(input.pageYOffset),
    finiteOrZero(input.docScrollTop),
    finiteOrZero(input.bodyScrollTop)
  );
  const viewportHeight = Math.max(
    0,
    finiteOrZero(input.innerHeight),
    finiteOrZero(input.docClientHeight)
  );
  const scrollHeight = Math.max(
    0,
    finiteOrZero(input.docScrollHeight),
    finiteOrZero(input.bodyScrollHeight)
  );
  const totalScrollable = scrollHeight - viewportHeight;
  if (totalScrollable <= 0) return 0;
  return clampShareSessionMaxScrollDepth01(scrollTop / totalScrollable);
}

export function computeElementScrollDepth01(input: {
  scrollTop?: unknown;
  clientHeight?: unknown;
  scrollHeight?: unknown;
}): number {
  const scrollTop = Math.max(0, finiteOrZero(input.scrollTop));
  const clientHeight = Math.max(0, finiteOrZero(input.clientHeight));
  const scrollHeight = Math.max(0, finiteOrZero(input.scrollHeight));
  const totalScrollable = scrollHeight - clientHeight;
  if (totalScrollable <= 0) return 0;
  return clampShareSessionMaxScrollDepth01(scrollTop / totalScrollable);
}
