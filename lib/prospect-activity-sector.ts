import type { Prospect } from "@/types";
/** Secteur d’activité pour filtre pipeline (home). */
export type ProspectActivitySector = "industrial" | "retail" | "tertiary" | "other";

export const PROSPECT_ACTIVITY_SECTOR_LABELS: Record<ProspectActivitySector, string> = {
  industrial: "Industrie",
  retail: "Retail",
  tertiary: "Tertiaire",
  other: "Autre",
};

const DISCOVERY_ZONE_TAG_TO_SECTOR: Record<string, ProspectActivitySector> = {
  industrial: "industrial",
  retail: "retail",
  commercial: "tertiary",
  residential: "other",
};

const PLACE_TYPE_TO_SECTOR: Record<string, ProspectActivitySector> = {
  industrial: "industrial",
  factory: "industrial",
  manufacturing: "industrial",
  plant: "industrial",
  warehouse: "industrial",
  storage: "industrial",
  storage_facility: "industrial",
  retail: "retail",
  supermarket: "retail",
  office: "tertiary",
  bank: "tertiary",
  post_office: "tertiary",
  real_estate_agency: "tertiary",
  insurance_agency: "tertiary",
  accounting: "tertiary",
  lawyer: "tertiary",
  finance: "tertiary",
  courthouse: "tertiary",
  city_hall: "tertiary",
  local_government_office: "tertiary",
  residential: "other",
  sport: "other",
  other: "other",
};

export function discoveryZoneTagToActivitySector(
  zoneTag: string | null | undefined
): ProspectActivitySector | null {
  const tag = String(zoneTag ?? "").trim().toLowerCase();
  if (!tag) return null;
  return DISCOVERY_ZONE_TAG_TO_SECTOR[tag] ?? null;
}

export function placeTypeToActivitySector(placeType: string | null | undefined): ProspectActivitySector {
  const key = String(placeType ?? "other").trim().toLowerCase() || "other";
  return PLACE_TYPE_TO_SECTOR[key] ?? "other";
}

/** Secteur affiché / filtré pour un prospect pipeline. */
export function resolveProspectActivitySector(prospect: Prospect): ProspectActivitySector {
  const fromDiscoveryTag = discoveryZoneTagToActivitySector(prospect.discoveryActivityZoneTag);
  if (fromDiscoveryTag) return fromDiscoveryTag;
  return placeTypeToActivitySector(prospect.placeType);
}
