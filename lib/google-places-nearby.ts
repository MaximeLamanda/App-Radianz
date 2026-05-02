import type { NearbyPlaceLite } from "./bdnb-poi-nearby-logic";

export type PlacesNearbyApiPayload = {
  status?: string;
  error_message?: string;
  results?: NearbyPlaceLite[];
};

/**
 * Interprète la réponse JSON de Places API Nearby Search (legacy).
 * Ne fait aucun appel réseau — testable sans clé.
 */
export function parsePlacesNearbyJson(data: unknown): {
  status: string;
  results: NearbyPlaceLite[];
  errorMessage?: string;
} {
  const d = data as PlacesNearbyApiPayload;
  const status = d.status ?? "UNKNOWN";
  const results = Array.isArray(d.results) ? d.results : [];
  if (status === "OK" && results.length > 0) {
    return { status, results };
  }
  return {
    status,
    results: [],
    errorMessage: d.error_message,
  };
}

/**
 * Détail pour logs / debug : nombre brut dans le JSON vs liste utilisée après règle status OK.
 */
export function summarizePlacesNearbyResponse(data: unknown): {
  status: string;
  rawResultCount: number;
  /** Identique à `parsePlacesNearbyJson(data).results` */
  resultsIfOk: NearbyPlaceLite[];
  errorMessage?: string;
} {
  const d = data as PlacesNearbyApiPayload;
  const status = d.status ?? "UNKNOWN";
  const rawResultCount = Array.isArray(d.results) ? d.results.length : 0;
  const parsed = parsePlacesNearbyJson(data);
  return {
    status,
    rawResultCount,
    resultsIfOk: parsed.results,
    errorMessage: parsed.errorMessage,
  };
}

export function buildNearbySearchUrl(params: {
  lat: number;
  lng: number;
  radiusM: number;
  apiKey: string;
  type?: string;
}): string {
  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${params.lat},${params.lng}`);
  url.searchParams.set("radius", String(Math.round(params.radiusM)));
  url.searchParams.set("type", params.type ?? "establishment");
  url.searchParams.set("key", params.apiKey);
  return url.toString();
}
