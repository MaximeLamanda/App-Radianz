import type { MapBounds } from "@/lib/swr-hooks";

/**
 * Logs diagnostic carte / API Découverte.
 * Filtre console : `[Discovery]`
 *
 * Désactiver en prod : noop si `NODE_ENV === "production"`.
 * Forcer même en prod : `NEXT_PUBLIC_DISCOVERY_DEBUG=1` dans `.env.local`.
 *
 * En dev, React 18 Strict Mode peut doubler mount/unmount des effets : ne pas confondre avec
 * un vrai double rechargement réseau.
 */
const enabled =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DISCOVERY_DEBUG === "1") ||
  (typeof process !== "undefined" && process.env.NODE_ENV !== "production");

export function discoveryDebug(area: "page" | "map", message: string, detail?: unknown): void {
  if (!enabled) return;
  const t = new Date().toISOString().slice(11, 23);
  if (detail !== undefined) {
    console.log(`${t} [Discovery:${area}] ${message}`, detail);
  } else {
    console.log(`${t} [Discovery:${area}] ${message}`);
  }
}

/** Clé stable pour comparer deux emprises carte (évite setState + refetch si rien n’a bougé). */
export function discoveryBoundsKey(b: MapBounds | null): string {
  if (!b) return "null";
  const q = (n: number) => n.toFixed(4);
  return `${q(b.sw.lat)},${q(b.sw.lng)}|${q(b.ne.lat)},${q(b.ne.lng)}`;
}
