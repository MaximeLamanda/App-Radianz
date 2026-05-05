import type { ReactNode } from "react";

/** Carte / Leaflet : pas de prérendu statique (évite `window` au build). */
export const dynamic = "force-dynamic";

export default function DiscoveryLayout({ children }: { children: ReactNode }) {
  return children;
}
