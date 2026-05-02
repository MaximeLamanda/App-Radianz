import type { NearbyPlaceResult } from "./types";

type NearbyJson = {
  status: string;
  error_message?: string;
  results?: unknown[];
};

function asNearbyPlace(raw: unknown): NearbyPlaceResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const place_id = typeof o.place_id === "string" ? o.place_id : "";
  const name = typeof o.name === "string" ? o.name : "";
  if (!place_id) return null;
  const vicinity = typeof o.vicinity === "string" ? o.vicinity : undefined;
  const types = Array.isArray(o.types) ? o.types.filter((t): t is string => typeof t === "string") : undefined;
  let geometry: NearbyPlaceResult["geometry"];
  const g = o.geometry;
  if (g && typeof g === "object" && "location" in g) {
    const loc = (g as { location?: unknown }).location;
    if (loc && typeof loc === "object") {
      const lat = (loc as { lat?: unknown }).lat;
      const lng = (loc as { lng?: unknown }).lng;
      const la = typeof lat === "number" ? lat : Number(lat);
      const ln = typeof lng === "number" ? lng : Number(lng);
      if (Number.isFinite(la) && Number.isFinite(ln)) {
        geometry = { location: { lat: la, lng: ln } };
      }
    }
  }
  return { place_id, name: name || "(sans nom)", vicinity, types, geometry };
}

export function parseNearbySearchJson(data: unknown): {
  status: string;
  errorMessage?: string;
  results: NearbyPlaceResult[];
} {
  const d = data as NearbyJson;
  const status = typeof d.status === "string" ? d.status : "UNKNOWN";
  const raw = Array.isArray(d.results) ? d.results : [];
  const results: NearbyPlaceResult[] = [];
  for (const item of raw) {
    const p = asNearbyPlace(item);
    if (p) results.push(p);
  }
  return {
    status,
    errorMessage: typeof d.error_message === "string" ? d.error_message : undefined,
    results: status === "OK" || status === "ZERO_RESULTS" ? results : [],
  };
}

export function buildNearbySearchUrl(params: {
  lat: number;
  lng: number;
  radiusM: number;
  apiKey: string;
}): string {
  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${params.lat},${params.lng}`);
  url.searchParams.set("radius", String(Math.round(params.radiusM)));
  url.searchParams.set("key", params.apiKey);
  return url.toString();
}
