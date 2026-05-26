/**
 * Parkings OSM et bornes de recharge — export matching V5 (`parkings_json`, `parking_geometries_json`).
 */

import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";

export type V5ParkingParcelEntry = {
  codeInsee: string;
  section: string;
  numeroNorm: string;
  intersectionAreaM2?: number;
};

export type V5ParkingCommonParcelEntry = {
  codeInsee: string;
  section: string;
  numeroNorm: string;
};

export type V5ChargingStationEntry = {
  osmType: string;
  osmId: number;
  name: string;
  poiTypeLabel: string;
  capacity?: string;
  lat?: number;
  lng?: number;
  osmUrl?: string;
};

export type V5ParkingSource = "osm" | "enr";

export type V5ParkingEntry = {
  parkingSource: V5ParkingSource;
  osmParkingType: string;
  osmParkingId: number;
  parkingTag: string;
  parkingValue: string;
  parkingName: string;
  parkingAreaM2?: number;
  parkingParcels: V5ParkingParcelEntry[];
  commonParcels: V5ParkingCommonParcelEntry[];
  chargingStations: V5ChargingStationEntry[];
};

export type V5ParkingGeometryEntry = {
  osmParkingType: string;
  osmParkingId: number;
  geometry: GeoJSON.Geometry;
};

function strProp(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function numPropNullable(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Clé de dédup parking (alignée `parking_index_key` Python).
 * Area osmium issue d'une way → id négatif en `r` ; fusionner avec `w:abs(id)`.
 */
export function parkingDedupKey(type: string, id: number): string {
  const t = (type || "w").trim() || "w";
  const oid = Math.trunc(id);
  if (t === "r" && oid < 0) return `w:${Math.abs(oid)}`;
  return `${t}:${oid}`;
}

function parkingKey(type: string, id: number): string {
  return parkingDedupKey(type, id);
}

function parseParkingParcels(raw: unknown): V5ParkingParcelEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: V5ParkingParcelEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const section = strProp(o.section);
    const numeroNorm = strProp(o.numero_norm);
    if (!section || !numeroNorm) continue;
    out.push({
      codeInsee: strProp(o.code_insee),
      section,
      numeroNorm,
      intersectionAreaM2: numPropNullable(o.intersection_area_m2),
    });
  }
  return out;
}

function parseCommonParcels(raw: unknown): V5ParkingCommonParcelEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: V5ParkingCommonParcelEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const section = strProp(o.section);
    const numeroNorm = strProp(o.numero_norm);
    if (!section || !numeroNorm) continue;
    out.push({
      codeInsee: strProp(o.code_insee),
      section,
      numeroNorm,
    });
  }
  return out;
}

function parseChargingStations(raw: unknown): V5ChargingStationEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: V5ChargingStationEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const osmId = Number(o.osm_id);
    if (!Number.isFinite(osmId)) continue;
    out.push({
      osmType: strProp(o.osm_type) || "n",
      osmId: Math.trunc(osmId),
      name: strProp(o.name),
      poiTypeLabel: strProp(o.poi_type_label) || "Borne de recharge",
      capacity: strProp(o.capacity) || undefined,
      lat: numPropNullable(o.lat),
      lng: numPropNullable(o.lng),
      osmUrl: strProp(o.osm_url) || undefined,
    });
  }
  return out;
}

function parseParkingSource(o: Record<string, unknown>, osmParkingType: string): V5ParkingSource {
  const raw = strProp(o.parking_source).toLowerCase();
  if (raw === "enr" || raw === "osm") return raw;
  return osmParkingType === "e" ? "enr" : "osm";
}

export function parkingSourceLabel(source: V5ParkingSource): string {
  return source === "enr" ? "Parking ENR" : "Parking OSM";
}

/** Libellé court pour tooltip / survol carte. */
export function parkingSourceHoverText(source: V5ParkingSource): string {
  if (source === "enr") {
    return "Source : Portail ENR (Geoplateforme) — parkings > 500 m²";
  }
  return "Source : OpenStreetMap (amenity / leisure / landuse = parking)";
}

export function parkingSourceFromFeatureProps(props: Record<string, unknown> | null | undefined): V5ParkingSource {
  const raw = strProp(props?.parking_source).toLowerCase();
  if (raw === "enr" || raw === "osm") return raw;
  return strProp(props?.osm_parking_type) === "e" ? "enr" : "osm";
}

export function parseV5ParkingEntry(o: Record<string, unknown>): V5ParkingEntry | null {
  const osmParkingId = Number(o.osm_parking_id);
  if (!Number.isFinite(osmParkingId)) return null;
  const osmParkingType = strProp(o.osm_parking_type) || "w";
  return {
    parkingSource: parseParkingSource(o, osmParkingType),
    osmParkingType,
    osmParkingId: Math.trunc(osmParkingId),
    parkingTag: strProp(o.parking_tag),
    parkingValue: strProp(o.parking_value) || "parking",
    parkingName: strProp(o.parking_name),
    parkingAreaM2: numPropNullable(o.parking_area_m2),
    parkingParcels: parseParkingParcels(o.parking_parcels_json),
    commonParcels: parseCommonParcels(o.common_parcels_json),
    chargingStations: parseChargingStations(o.charging_stations_json),
  };
}

/** Parse `parkings_json` sur une entrée `buildings_json`. */
export function parseParkingsJson(raw: unknown): V5ParkingEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: V5ParkingEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = parseV5ParkingEntry(item as Record<string, unknown>);
    if (p) out.push(p);
  }
  return out;
}

export function collectParkingsFromMatchingRows(
  rows: Array<{ buildingsJson?: string }>
): V5ParkingEntry[] {
  const seen = new Set<string>();
  const out: V5ParkingEntry[] = [];
  for (const row of rows) {
    const s = String(row.buildingsJson ?? "").trim();
    if (!s) continue;
    try {
      const arr = JSON.parse(s) as unknown;
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const parkings = parseParkingsJson((item as Record<string, unknown>).parkings_json);
        for (const p of parkings) {
          const key = parkingKey(p.osmParkingType, p.osmParkingId);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(p);
        }
      }
    } catch {
      // ignore
    }
  }
  return out;
}

export function parseMatchingV5ParkingGeometriesJson(raw: string): V5ParkingGeometryEntry[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    if (!Array.isArray(v)) return [];
    const out: V5ParkingGeometryEntry[] = [];
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const osmParkingId = Number(o.osm_parking_id);
      const geom = o.geometry;
      if (!Number.isFinite(osmParkingId) || !geom || typeof geom !== "object") continue;
      out.push({
        osmParkingType: strProp(o.osm_parking_type) || "w",
        osmParkingId: Math.trunc(osmParkingId),
        geometry: geom as GeoJSON.Geometry,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function collectMatchingV5ParkingFeatures(rows: ScoutMatchingV5Row[]): GeoJSON.Feature[] {
  const seen = new Set<string>();
  const features: GeoJSON.Feature[] = [];
  for (const row of rows) {
    const raw =
      row.parkingGeometriesJson ||
      strProp(row.properties?.parking_geometries_json) ||
      "";
    for (const entry of parseMatchingV5ParkingGeometriesJson(raw)) {
      const key = parkingKey(entry.osmParkingType, entry.osmParkingId);
      if (seen.has(key)) continue;
      seen.add(key);
      const g = entry.geometry;
      if (g.type !== "Polygon" && g.type !== "MultiPolygon") continue;
      const parkingSource: V5ParkingSource = entry.osmParkingType === "e" ? "enr" : "osm";
      features.push({
        type: "Feature",
        properties: {
          osm_parking_type: entry.osmParkingType,
          osm_parking_id: entry.osmParkingId,
          parking_source: parkingSource,
        },
        geometry: g,
      });
    }
  }
  return features;
}

/** Exclut les bornes de recharge du tableau POI commerce (section dédiée Parking). */
export function isChargingStationPoi(poi: {
  poiPrimaryValue?: string;
  osmPoiPrimaryValue?: string;
  typeLabel?: string;
}): boolean {
  const v = String(poi.poiPrimaryValue ?? poi.osmPoiPrimaryValue ?? "")
    .trim()
    .toLowerCase();
  if (v === "charging_station") return true;
  const label = String(poi.typeLabel ?? "").trim().toLowerCase();
  return label.includes("borne de recharge");
}

export function formatParkingAreaM2(m2: number | undefined | null): string {
  if (m2 == null || !Number.isFinite(m2) || m2 <= 0) return "—";
  return `${Math.round(m2).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} m²`;
}
