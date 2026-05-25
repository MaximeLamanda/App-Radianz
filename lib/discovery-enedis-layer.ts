import type { MapBounds } from "@/lib/swr-hooks";

/** Zoom minimum pour fetch / affichage de la couche Enedis. */
export const DISCOVERY_ENEDIS_MIN_ZOOM = 12;

export const DISCOVERY_ENEDIS_MWH_SLIDER_MIN = 0;
export const DISCOVERY_ENEDIS_MWH_SLIDER_MAX = 10_000;
export const DISCOVERY_ENEDIS_MWH_SLIDER_STEP = 10;

export const DISCOVERY_ENEDIS_DEFAULT_MWH_MIN = 0;
export const DISCOVERY_ENEDIS_DEFAULT_MWH_MAX = DISCOVERY_ENEDIS_MWH_SLIDER_MAX;

export const DISCOVERY_ENEDIS_YEARS = [
  "2018",
  "2019",
  "2020",
  "2021",
  "2022",
  "2023",
  "2024",
] as const;

export type DiscoveryEnedisYear = (typeof DISCOVERY_ENEDIS_YEARS)[number];

export const DISCOVERY_ENEDIS_DEFAULT_YEAR: DiscoveryEnedisYear = "2024";

/** Plafond par requête bbox (tri MWh desc). */
export const DISCOVERY_ENEDIS_API_MAX_LIMIT = 2000;

/** Au-delà de ce zoom, les marqueurs Enedis ne sont plus regroupés (lisibilité). */
export const DISCOVERY_ENEDIS_CLUSTER_MAX_ZOOM = 15;
export const DISCOVERY_ENEDIS_MAX_COMMUNES = 25;
export const DISCOVERY_ENEDIS_MAX_NEW_GEOCODES_PER_REQUEST = 40;
export const DISCOVERY_ENEDIS_GEOCODE_MIN_SCORE = 0.75;
export const DISCOVERY_ENEDIS_BOUNDS_PADDING = 0.05;

export type DiscoveryEnedisPoint = {
  id: string;
  lat: number;
  lng: number;
  mwh: number;
  annee: string;
  adresse: string;
  code_commune: string;
  code_secteur_naf2: string | null;
  nombre_de_sites: number;
};

export type DiscoveryEnedisPointsResponse = {
  points: DiscoveryEnedisPoint[];
  truncated: boolean;
  skippedNoAddress: number;
  skippedGeocode: number;
  communeCount: number;
};

export function isDiscoveryEnedisMwhFilterDisabled(minMwh: number, maxMwh: number): boolean {
  return (
    minMwh <= DISCOVERY_ENEDIS_MWH_SLIDER_MIN &&
    maxMwh >= DISCOVERY_ENEDIS_MWH_SLIDER_MAX
  );
}

export function discoveryEnedisHiEffective(maxMwh: number): number {
  return maxMwh >= DISCOVERY_ENEDIS_MWH_SLIDER_MAX ? Number.POSITIVE_INFINITY : maxMwh;
}

export function isDiscoveryEnedisYear(value: string): value is DiscoveryEnedisYear {
  return (DISCOVERY_ENEDIS_YEARS as readonly string[]).includes(value);
}

export function pointInMapBounds(
  lat: number,
  lng: number,
  bounds: MapBounds
): boolean {
  return (
    lat >= bounds.sw.lat &&
    lat <= bounds.ne.lat &&
    lng >= bounds.sw.lng &&
    lng <= bounds.ne.lng
  );
}

/** Parse `limit` query — absent ou vide → plafond API (évite `Number(null) === 0`). */
export function parseDiscoveryEnedisApiLimit(limitParam: string | null): number {
  if (limitParam == null || limitParam.trim() === "") {
    return DISCOVERY_ENEDIS_API_MAX_LIMIT;
  }
  const n = Number(limitParam);
  if (!Number.isFinite(n)) {
    return DISCOVERY_ENEDIS_API_MAX_LIMIT;
  }
  return Math.min(Math.max(1, Math.trunc(n)), DISCOVERY_ENEDIS_API_MAX_LIMIT);
}

export function discoveryEnedisFilterSignature(input: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  mwhMin: number;
  mwhMax: number;
  annee: string;
}): string {
  return [
    input.minLat.toFixed(5),
    input.maxLat.toFixed(5),
    input.minLng.toFixed(5),
    input.maxLng.toFixed(5),
    input.mwhMin,
    input.mwhMax,
    input.annee,
  ].join(":");
}
