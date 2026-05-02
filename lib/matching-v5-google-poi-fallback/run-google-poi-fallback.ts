import { buildNearbySearchUrl, parseNearbySearchJson } from "./nearby-search";
import { buildPlaceDetailsUrl, parsePlaceDetailsJson } from "./place-details";
import { rankNearbyPlaces } from "./rank-candidates";
import type {
  GooglePoiFallbackOptions,
  GooglePoiFallbackRunError,
  GooglePoiFallbackRunResult,
} from "./types";

function getFetch(opts: GooglePoiFallbackOptions): typeof fetch {
  return opts.fetchImpl ?? fetch;
}

export async function runGooglePoiFallback(
  lat: number,
  lng: number,
  opts: GooglePoiFallbackOptions
): Promise<GooglePoiFallbackRunResult | GooglePoiFallbackRunError> {
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) {
    return { ok: false, step: "config", message: "Clé API Google manquante (GOOGLE_MAPS_API_KEY)." };
  }

  const radiusM = opts.radiusM ?? 100;
  const centroid = { lat, lng };
  const fetchJson = getFetch(opts);

  const nearbyUrl = buildNearbySearchUrl({ lat, lng, radiusM, apiKey });
  let nearbyRaw: unknown;
  try {
    const res = await fetchJson(nearbyUrl, { headers: { Accept: "application/json" } });
    nearbyRaw = await res.json();
  } catch {
    return { ok: false, step: "nearby", message: "Réseau indisponible (Nearby Search)." };
  }

  const nearbyParsed = parseNearbySearchJson(nearbyRaw);
  if (nearbyParsed.status !== "OK" && nearbyParsed.status !== "ZERO_RESULTS") {
    return {
      ok: false,
      step: "nearby",
      message: nearbyParsed.errorMessage ?? `Places Nearby status: ${nearbyParsed.status}`,
      nearbyStatus: nearbyParsed.status,
    };
  }

  const { ranked, excludedOutsideParcel } = rankNearbyPlaces(centroid, nearbyParsed.results, {
    maxRanked: 20,
    parcelGeometry: opts.parcelGeometry,
  });

  if (ranked.length === 0) {
    return {
      ok: true,
      centroid,
      radiusM,
      nearbyStatus: nearbyParsed.status,
      nearbyErrorMessage: nearbyParsed.errorMessage,
      rawNearbyCount: nearbyParsed.results.length,
      excludedOutsideParcel,
      ranked: [],
      topN: 0,
    };
  }

  const winnerPlace = ranked[0];
  const detailsUrl = buildPlaceDetailsUrl({ placeId: winnerPlace.place_id, apiKey });
  let detailsRaw: unknown;
  try {
    const res = await fetchJson(detailsUrl, { headers: { Accept: "application/json" } });
    detailsRaw = await res.json();
  } catch {
    return {
      ok: false,
      step: "details",
      message: "Réseau indisponible (Place Details).",
      nearbyStatus: nearbyParsed.status,
    };
  }

  const detailsParsed = parsePlaceDetailsJson(detailsRaw);
  if (detailsParsed.status !== "OK" || !detailsParsed.result) {
    return {
      ok: false,
      step: "details",
      message: detailsParsed.errorMessage ?? `Place Details status: ${detailsParsed.status}`,
      nearbyStatus: nearbyParsed.status,
    };
  }

  return {
    ok: true,
    centroid,
    radiusM,
    nearbyStatus: nearbyParsed.status,
    nearbyErrorMessage: nearbyParsed.errorMessage,
    rawNearbyCount: nearbyParsed.results.length,
    excludedOutsideParcel,
    ranked,
    topN: Math.min(5, ranked.length),
    winner: detailsParsed.result,
    detailsStatus: detailsParsed.status,
    detailsErrorMessage: detailsParsed.errorMessage,
  };
}
