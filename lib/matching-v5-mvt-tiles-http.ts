import { createHash } from "node:crypto";

/** Cache navigateur uniquement (`requireAuth` sur la route). */
export const SCOUT_BUILDINGS_MVT_CACHE_CONTROL = "private, max-age=600";

/**
 * ETag faible stable pour une tuile : révision données + coordonnées + empreinte du corps binaire.
 */
export function buildMvtWeakEtag(
  revision: string,
  z: number,
  x: number,
  y: number,
  body: Uint8Array
): string {
  const h = createHash("sha256");
  h.update(revision);
  h.update("\0");
  h.update(String(z));
  h.update("\0");
  h.update(String(x));
  h.update("\0");
  h.update(String(y));
  h.update("\0");
  h.update(body);
  const digest = h.digest("base64url");
  return `W/"${digest}"`;
}

/**
 * Extrait la valeur normalisée d'un ETag (sans préfixe W/, guillemets).
 */
export function normalizeEtagValue(raw: string): string {
  let s = raw.trim();
  if (s.toLowerCase().startsWith("w/")) {
    s = s.slice(2).trim();
  }
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    s = s.slice(1, -1);
  }
  return s;
}

/**
 * `If-None-Match` peut contenir plusieurs ETags séparés par des virgules.
 */
export function ifNoneMatchSatisfied(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch?.trim()) return false;
  const target = normalizeEtagValue(etag);
  for (const part of ifNoneMatch.split(",")) {
    const p = normalizeEtagValue(part);
    if (p === "*" || p === target) return true;
  }
  return false;
}
