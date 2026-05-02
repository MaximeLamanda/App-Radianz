import type { PlaceDetailsFields } from "./types";

type DetailsJson = {
  status: string;
  error_message?: string;
  result?: unknown;
};

function readResult(raw: unknown): PlaceDetailsFields | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const place_id = typeof o.place_id === "string" ? o.place_id : "";
  if (!place_id) return null;
  const formatted_address =
    typeof o.formatted_address === "string" ? o.formatted_address : undefined;
  const name = typeof o.name === "string" ? o.name : undefined;
  const types = Array.isArray(o.types)
    ? o.types.filter((t): t is string => typeof t === "string")
    : undefined;
  return { place_id, formatted_address, name, types };
}

export function parsePlaceDetailsJson(data: unknown): {
  status: string;
  errorMessage?: string;
  result: PlaceDetailsFields | null;
} {
  const d = data as DetailsJson;
  const status = typeof d.status === "string" ? d.status : "UNKNOWN";
  const result = status === "OK" ? readResult(d.result) : null;
  return {
    status,
    errorMessage: typeof d.error_message === "string" ? d.error_message : undefined,
    result,
  };
}

export function buildPlaceDetailsUrl(params: { placeId: string; apiKey: string }): string {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", params.placeId);
  url.searchParams.set("fields", "place_id,name,formatted_address,types");
  url.searchParams.set("key", params.apiKey);
  return url.toString();
}
