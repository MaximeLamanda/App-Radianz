import type { MapBounds } from "@/lib/swr-hooks";
import { viewportContainedInQueryBounds } from "@/lib/discovery-viewport-bounds";
import type { DiscoveryMatchingDataMode } from "@/lib/discovery-zoom-modes";

export type DiscoveryFetchSkipInput = {
  forceRefetch: boolean;
  viewportBounds: MapBounds;
  lastQueryBounds: MapBounds | null;
  /** `null` autorisé lorsque l'endpoint ne dépend pas du mode (ex. buildings-overview). */
  lastMode: DiscoveryMatchingDataMode | null;
  nextMode: DiscoveryMatchingDataMode;
};

/** Conservé pour compat (alias historique). */
export type MatchingFeaturesFetchSkipInput = DiscoveryFetchSkipInput;

/**
 * Indique si l'on peut éviter un nouveau fetch côté Discovery
 * (utilisé pour `/api/matching-v5/features` ET `/api/matching-v5/buildings-overview`).
 * Un changement de mode (overview ↔ detail) impose toujours un refetch.
 */
export function shouldSkipDiscoveryFetch(input: DiscoveryFetchSkipInput): boolean {
  if (input.forceRefetch) return false;
  if (input.lastMode !== input.nextMode) return false;
  const covered = input.lastQueryBounds;
  if (covered == null) return false;
  return viewportContainedInQueryBounds(input.viewportBounds, covered);
}

/** Conservé pour compat (alias historique). */
export const shouldSkipMatchingFeaturesFetch = shouldSkipDiscoveryFetch;
