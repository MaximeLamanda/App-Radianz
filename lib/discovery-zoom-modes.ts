/**
 * Seuil unique carte Discovery : cluster / points jusqu’à ce zoom inclus ;
 * polygones détaillés + tuiles MVT au-delà.
 */
/** Au-delà de ce zoom : polygones MVT ; jusqu’à ce zoom inclus : clusters (overview). 15 → zoom par défaut 14 reste en clusters. */
export const DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM = 15;

/**
 * Plafond client pour `/api/matching-v5/buildings-overview` (points cluster, legacy).
 * Réduit le nombre de `<MapMarker>` / travail Leaflet.markercluster ; le serveur borne aussi (`MAX_LIMIT`).
 */
export const DISCOVERY_BUILDINGS_OVERVIEW_CLIENT_LIMIT = 16_000;

/** Plafond client pour `/api/matching-v5/combos-overview` (1 point par combo). */
export const DISCOVERY_COMBOS_OVERVIEW_CLIENT_LIMIT = 20_000;

/** Attente après pan/zoom avant fetch overview bâtiments (legacy). */
export const DISCOVERY_BUILDINGS_OVERVIEW_FETCH_DEBOUNCE_MS = 240;

/** Attente avant fetch combos-overview (pan/zoom + slider surface). */
export const DISCOVERY_COMBOS_OVERVIEW_FETCH_DEBOUNCE_MS = 150;

/**
 * Attente après pan/zoom avant fetch features + émission bbox carte.
 * Aligné sur MapBoundsEmitter pour coalescer zoomend + moveend en un seul fetch.
 */
export const DISCOVERY_VIEWPORT_FETCH_DEBOUNCE_MS = 500;

/** Vue « globale » (clusters, chargement overview allégé). */
export function isMatchingOverviewZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom <= DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM;
}

export type DiscoveryMatchingDataMode = "overview" | "detail";

export function matchingDataModeFromZoom(zoom: number): DiscoveryMatchingDataMode {
  return isMatchingOverviewZoom(zoom) ? "overview" : "detail";
}
