/**
 * Couche discovery Matching V5 — export GeoJSON généré par
 * `data-pipeline/matching_v5/run_matching_v5.py` (défaut public/geo/matching-v5-33318.geojson).
 */

import { latLngFromMatchingGeometry } from "@/lib/matching-v5-google-poi-fallback/centroid-from-geojson";
import { polygonAreaM2ApproxWgs84 } from "@/lib/geojson-polygon-area-m2";
import { parseParkingsJson, type V5ParkingEntry } from "@/lib/matching-v5-parking";

export type ScoutMatchingV5Grain = "building" | "parcelle";

export type ScoutMatchingV5Row = {
  id: string;
  grain: ScoutMatchingV5Grain;
  /** Polygone complet (detail) ou `Point` (overview carte). */
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.Point;
  /** Titre court pour la liste latérale */
  label: string;
  batimentConstructionId: string | null;
  bdnbBatimentConstructionId?: string | null;
  batimentGroupeId: string | null;
  osmBuildingId?: string;
  osmMatchStatus?: string;
  osmBdnbIntersectionAreaM2?: number;
  osmAddressText?: string;
  codeInsee: string;
  section: string;
  numeroNorm: string;
  nbBatiments: number;
  footprintSumM2: number;
  sirenStatus: string;
  statusTechnique: string;
  statusMetier: "none" | "single" | "shared";
  siretCount: number;
  siretsJson: string;
  sirensJson: string;
  matchingConfidence: number;
  matchingReason: string;
  passerelleAddress: string;
  passerelleAddressesJson: string;
  /** Adresse confirmée (cascade OSM / PPM / BAN / SIRENE). */
  displayAddress?: string;
  displayAddressSource?: string;
  displayAddressConfidence?: string;
  parcellesJson: string;
  buildingsJson: string;
  buildingGeometriesJson: string;
  /** Polygones parking liés (`parking_geometries_json` / properties). */
  parkingGeometriesJson?: string;
  /** POI OSM dans la parcelle (export matching V5, `osm_pois_json`). */
  osmPoisJson?: string;
  osmPoiCount?: number;
  osmPoisStatus?: string;
  osmPoiTruncated?: number;
  osmDataAsOf?: string;
  properties: Record<string, unknown>;
};

function strProp(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function jsonStringProp(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

/** Aligné sur `data-pipeline/matching_v5/osm_poi_v5.py` — catégories pour repli client. */
const OSM_PRIMARY_KEY_LABEL_FR: Record<string, string> = {
  shop: "Commerce",
  amenity: "Équipement",
  craft: "Artisanat",
  office: "Bureaux",
  healthcare: "Santé",
  leisure: "Loisirs",
  tourism: "Tourisme",
  man_made: "Ouvrage",
};

/** Paires `clé:valeur` héritées → libellé métier (évite « Commerce — Yes » côté client). */
const LEGACY_OSMTYPE_VALUE_FR: Record<string, string> = {
  "leisure:amusement_arcade": "Salle d'arcades",
  "shop:yes": "Magasin",
};

function legacyOsmColonPairKey(raw: string): string | null {
  const m = String(raw ?? "")
    .trim()
    .match(/^([a-z][a-z0-9_]*)\s*:\s*(.+)$/);
  if (!m?.[1] || !m[2]) return null;
  const val = m[2]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return `${m[1].toLowerCase()}:${val}`;
}

/**
 * Anciens exports utilisaient la syntaxe OSM `clé: valeur` dans `poi_type_label`.
 * Harmonise l’affichage avec le pipeline (libellé lisible, sans `leisure:` brut).
 */
export function formatV5OsmPoiTypeLabelForDisplay(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return t;
  const pairKey = legacyOsmColonPairKey(t);
  if (pairKey && LEGACY_OSMTYPE_VALUE_FR[pairKey]) {
    return LEGACY_OSMTYPE_VALUE_FR[pairKey]!;
  }
  const m = t.match(/^([a-z][a-z0-9_]*)\s*:\s*(.+)$/);
  if (!m?.[1] || !m[2]) return t;
  const key = m[1].toLowerCase();
  const rest = m[2].trim();
  const keyPretty = key.replace(/_/g, " ");
  const cat =
    OSM_PRIMARY_KEY_LABEL_FR[key] ??
    keyPretty
      .split(/\s+/)
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
      .join(" ");
  const slug = rest.replace(/_/g, " ").trim();
  if (!slug) return cat;
  const pretty = slug
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ""))
    .join(" ");
  return `${cat} — ${pretty}`;
}

function parseGeometry(g: unknown): GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.Point | null {
  if (!g || typeof g !== "object") return null;
  const t = (g as { type?: string }).type;
  if (t === "Polygon" || t === "MultiPolygon" || t === "Point") {
    return g as GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.Point;
  }
  return null;
}

function normalizeStatusMetier(v: string): "none" | "single" | "shared" {
  const s = String(v || "").trim().toLowerCase();
  if (s === "single") return "single";
  if (s === "shared" || s === "multiple") return "shared";
  return "none";
}

/** Entrées PPM par SIREN (passerelle_addresses_json). */
export type V5PasserellePpmEntry = {
  siren?: string;
  denomination?: string | null;
  address?: string | null;
  rows?: number;
};

/** Établissement retenu par le matching adresse (sirets_json). */
export type V5MatchedSiret = {
  siret: string;
  siren?: string;
  denomination?: string | null;
  adresse_etablissement?: string | null;
  tranche_effectifs?: string | null;
  annee_effectifs?: string | null;
  activite_principale?: string | null;
  score?: number;
  reason?: string;
};

export function parsePasserelleAddressesJson(raw: string): V5PasserellePpmEntry[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x) => x && typeof x === "object") as V5PasserellePpmEntry[];
  } catch {
    return [];
  }
}

/** Une entrée de `buildings_json` (export matching V5, jointure BDNB + parcelle). */
export type V5BuildingsJsonEntry = {
  batimentConstructionId: string;
  bdnbBatimentConstructionId?: string | null;
  batimentGroupeId: string | null;
  osmBuildingId?: string;
  osmMatchStatus?: string;
  osmBdnbIntersectionAreaM2?: number | null;
  osmAddressText?: string;
  osmName?: string;
  osmWebsite?: string;
  osmPhone?: string;
  osmPoiPrimaryKey?: string;
  osmPoiPrimaryValue?: string;
  osmPoiTypeLabel?: string;
  osmRawTags?: Record<string, string>;
  /** Valeur OSM brute (landuse spatial, building:use ou building). */
  zoneTag?: string;
  zoneSource?: string;
  landuseIntersectionAreaM2?: number | null;
  anneeConstruction: number | null;
  footprintM2: number | null;
  intersectionAreaM2: number | null;
  matchingStatus: string;
  matchingDecision: string;
  matchingSirenSelected: string;
  parkings?: V5ParkingEntry[];
};

export type V5BuildingGeometryEntry = {
  batimentConstructionId: string;
  bdnbBatimentConstructionId?: string | null;
  batimentGroupeId: string | null;
  osmBuildingId?: string;
  osmMatchStatus?: string;
  osmBdnbIntersectionAreaM2?: number | null;
  osmAddressText?: string;
  osmName?: string;
  osmWebsite?: string;
  osmPhone?: string;
  osmPoiPrimaryKey?: string;
  osmPoiPrimaryValue?: string;
  osmPoiTypeLabel?: string;
  osmRawTags?: Record<string, string>;
  zoneTag?: string;
  zoneSource?: string;
  landuseIntersectionAreaM2?: number | null;
  anneeConstruction: number | null;
  footprintM2: number | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};

/** Zone OSM considérée comme activité économique (filtre UI). */
export const V5_OSM_ACTIVITY_ZONE_TAGS = ["industrial", "commercial", "retail"] as const;

/** True si `zone_tag` appartient au scope activité OSM (industrial/commercial/retail). */
export function isV5OsmActivityZoneTag(zoneTag: string | null | undefined): boolean {
  const t = String(zoneTag ?? "").trim().toLowerCase();
  return t !== "" && (V5_OSM_ACTIVITY_ZONE_TAGS as readonly string[]).includes(t);
}

function numPropNullable(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function stringRecordProp(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const key = String(k || "").trim();
    const value = strProp(raw);
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Libellés FR pour les valeurs OSM `landuse=*` / `building:use=*` / `building=*`
 * remontées dans `zone_tag`. Les clés sont en minuscules ; toute valeur non
 * répertoriée retombe sur la valeur brute capitalisée.
 */
const V5_ZONE_TAG_FR_LABELS: Record<string, string> = {
  industrial: "Industriel",
  commercial: "Commercial",
  retail: "Commerce",
  residential: "Zone résidentielle",
  education: "École · université · campus",
  religious: "Religieux",
  military: "Militaire",
  port: "Port",
  depot: "Dépôt",
  cemetery: "Cimetière",
  farmyard: "Cour d'exploitation agricole",
  farmland: "Zone agricole",
  meadow: "Prairie / zone ouverte",
  orchard: "Verger",
  vineyard: "Vignoble",
  recreation_ground: "Terrain de loisirs / sport (landuse)",
  allotments: "Jardins familiaux",
  brownfield: "Friche",
  construction: "Chantier",
  office: "Bureaux",
  warehouse: "Entrepôt",
  garage: "Garage",
  garages: "Garages",
  hospital: "Hôpital",
  school: "École",
  university: "Université",
  kindergarten: "Crèche",
  church: "Église",
  chapel: "Chapelle",
  mosque: "Mosquée",
  synagogue: "Synagogue",
  hotel: "Hôtel",
  supermarket: "Supermarché",
  service: "Service",
  civic: "Bâtiment civique",
  public: "Public",
  government: "Administration",
  sports_centre: "Centre sportif",
  stadium: "Stade",
  pitch: "Terrain de sport",
  track: "Piste (athlétisme / course)",
  golf_course: "Golf",
  swimming_pool: "Piscine (complexe)",
  marina: "Port de plaisance",
  greenhouse: "Serre",
  farm: "Ferme",
};

/** Libellé court FR pour la source d'un `zone_tag` (debug / tooltip). */
const V5_ZONE_SOURCE_FR_LABELS: Record<string, string> = {
  landuse: "OSM landuse",
  building_use: "OSM building:use",
  building: "OSM building",
  none: "Inconnu",
};

/**
 * Convertit `zone_tag` (valeur OSM brute) en libellé FR lisible.
 * Retourne une chaîne vide si le tag est vide.
 */
export function formatV5ZoneTagLabel(zoneTag: string | null | undefined): string {
  const t = String(zoneTag ?? "").trim();
  if (!t) return "";
  const mapped = V5_ZONE_TAG_FR_LABELS[t.toLowerCase()];
  if (mapped) return mapped;
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, " ");
}

/** Libellé court FR pour `zone_source` (`landuse | building_use | building | none`). */
export function formatV5ZoneSourceLabel(zoneSource: string | null | undefined): string {
  const s = String(zoneSource ?? "").trim().toLowerCase();
  if (!s) return "";
  return V5_ZONE_SOURCE_FR_LABELS[s] ?? s;
}

/** Parse `buildings_json` (tableau JSON) pour affichage fiche découverte. */
export function parseMatchingV5BuildingsJson(raw: string): V5BuildingsJsonEntry[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    if (!Array.isArray(v)) return [];
    const out: V5BuildingsJsonEntry[] = [];
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const bc = strProp(o.batiment_construction_id);
      if (!bc) continue;
      const bg = strProp(o.batiment_groupe_id);
      out.push({
        batimentConstructionId: bc,
        bdnbBatimentConstructionId: strProp(o.bdnb_batiment_construction_id) || null,
        batimentGroupeId: bg || null,
        osmBuildingId: strProp(o.osm_building_id) || undefined,
        osmMatchStatus: strProp(o.osm_match_status) || undefined,
        osmBdnbIntersectionAreaM2: numPropNullable(o.osm_bdnb_intersection_area_m2),
        osmAddressText: strProp(o.osm_address_text) || undefined,
        osmName: strProp(o.osm_name) || undefined,
        osmWebsite: strProp(o.osm_website) || undefined,
        osmPhone: strProp(o.osm_phone) || undefined,
        osmPoiPrimaryKey: strProp(o.osm_poi_primary_key) || undefined,
        osmPoiPrimaryValue: strProp(o.osm_poi_primary_value) || undefined,
        osmPoiTypeLabel: strProp(o.osm_poi_type_label) || undefined,
        osmRawTags: stringRecordProp(o.osm_raw_tags),
        zoneTag: strProp(o.zone_tag) || undefined,
        zoneSource: strProp(o.zone_source) || undefined,
        landuseIntersectionAreaM2: numPropNullable(o.landuse_intersection_area_m2),
        anneeConstruction: numPropNullable(o.annee_construction),
        footprintM2: numPropNullable(o.footprint_m2),
        intersectionAreaM2: numPropNullable(o.intersection_area_m2),
        matchingStatus: strProp(o.matching_status),
        matchingDecision: strProp(o.matching_decision),
        matchingSirenSelected: strProp(o.matching_siren_selected),
        parkings: parseParkingsJson(o.parkings_json),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Somme des empreintes (m²) sur un cluster parcelle sans double-compter un même
 * `batiment_construction_id` listé dans plusieurs `buildings_json`.
 * Retourne `null` si aucun bâtiment parseable (repli sur `footprintSumM2` par parcelle).
 */
export function footprintSumM2DedupedFromParcelleCluster(
  parcels: ScoutMatchingV5Row[]
): number | null {
  const byBc = new Map<string, number>();
  for (const pr of parcels) {
    for (const b of parseMatchingV5BuildingsJson(pr.buildingsJson)) {
      const bc = b.batimentConstructionId.trim();
      if (!bc || byBc.has(bc)) continue;
      const fp = b.footprintM2;
      byBc.set(
        bc,
        fp != null && Number.isFinite(fp) && fp > 0 ? fp : 0
      );
    }
  }
  if (byBc.size === 0) return null;
  let sum = 0;
  for (const fp of byBc.values()) {
    if (fp > 0) sum += fp;
  }
  return sum;
}

/** Même format que `isValidOsmBuildingId` côté Discovery (`w:123`, etc.). */
const PIPELINE_OSM_BUILDING_ID_RE = /^[wnr]:\d{1,20}$/;

/**
 * Liste les `osm_building_id` valides dans `buildings_json` sans exiger `batiment_construction_id`.
 * Utile pour la whitelist carte (MVT / clusters) : `parseMatchingV5BuildingsJson` ignore les entrées sans BC.
 */
export function listValidOsmBuildingIdsInBuildingsJson(raw: string): string[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const id = strProp((item as Record<string, unknown>).osm_building_id);
      if (id && PIPELINE_OSM_BUILDING_ID_RE.test(id)) out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Liste les `osm_building_id` dans `building_geometries_json` sans exiger `batiment_construction_id`
 * ni géométrie parsable (aligné tuiles MVT / `scout_matching_v5_buildings_mv`).
 */
export function listValidOsmBuildingIdsInBuildingGeometriesJson(raw: string): string[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const id = strProp((item as Record<string, unknown>).osm_building_id);
      if (id && PIPELINE_OSM_BUILDING_ID_RE.test(id)) out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

export function parseMatchingV5BuildingGeometriesJson(raw: string): V5BuildingGeometryEntry[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    if (!Array.isArray(v)) return [];
    const out: V5BuildingGeometryEntry[] = [];
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const bc = strProp(o.batiment_construction_id);
      const geometry = parseGeometry(o.geometry);
      if (!bc || !geometry) continue;
      if (geometry.type === "Point") continue;
      out.push({
        batimentConstructionId: bc,
        bdnbBatimentConstructionId: strProp(o.bdnb_batiment_construction_id) || null,
        batimentGroupeId: strProp(o.batiment_groupe_id) || null,
        osmBuildingId: strProp(o.osm_building_id) || undefined,
        osmMatchStatus: strProp(o.osm_match_status) || undefined,
        osmBdnbIntersectionAreaM2: numPropNullable(o.osm_bdnb_intersection_area_m2),
        osmAddressText: strProp(o.osm_address_text) || undefined,
        osmName: strProp(o.osm_name) || undefined,
        osmWebsite: strProp(o.osm_website) || undefined,
        osmPhone: strProp(o.osm_phone) || undefined,
        osmPoiPrimaryKey: strProp(o.osm_poi_primary_key) || undefined,
        osmPoiPrimaryValue: strProp(o.osm_poi_primary_value) || undefined,
        osmPoiTypeLabel: strProp(o.osm_poi_type_label) || undefined,
        osmRawTags: stringRecordProp(o.osm_raw_tags),
        zoneTag: strProp(o.zone_tag) || undefined,
        zoneSource: strProp(o.zone_source) || undefined,
        landuseIntersectionAreaM2: numPropNullable(o.landuse_intersection_area_m2),
        anneeConstruction: numPropNullable(o.annee_construction),
        footprintM2: numPropNullable(o.footprint_m2),
        geometry,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function collectMatchingV5BuildingFeatures(rows: ScoutMatchingV5Row[]): GeoJSON.Feature[] {
  const byId = new Map<string, GeoJSON.Feature>();
  for (const row of rows) {
    if (row.grain === "building") {
      if (row.geometry.type === "Polygon" || row.geometry.type === "MultiPolygon") {
        const id = String(row.batimentConstructionId || row.batimentGroupeId || "").trim();
        if (!id || byId.has(id)) continue;
        byId.set(id, {
          type: "Feature",
          id: `bdnbcstr:${id}`,
          geometry: row.geometry,
          properties: {
            batiment_construction_id: row.batimentConstructionId,
            bdnb_batiment_construction_id: row.bdnbBatimentConstructionId,
            osm_building_id: row.osmBuildingId,
            batiment_groupe_id: row.batimentGroupeId,
            footprint_m2: row.footprintSumM2,
          },
        });
      }
      continue;
    }
    for (const entry of parseMatchingV5BuildingGeometriesJson(row.buildingGeometriesJson)) {
      if (byId.has(entry.batimentConstructionId)) continue;
      byId.set(entry.batimentConstructionId, {
        type: "Feature",
        id: `bdnbcstr:${entry.batimentConstructionId}`,
        geometry: entry.geometry,
        properties: {
          batiment_construction_id: entry.batimentConstructionId,
          bdnb_batiment_construction_id: entry.bdnbBatimentConstructionId,
          osm_building_id: entry.osmBuildingId,
          batiment_groupe_id: entry.batimentGroupeId,
          annee_construction: entry.anneeConstruction,
          footprint_m2: entry.footprintM2,
        },
      });
    }
  }
  return Array.from(byId.values());
}

/** POI Google Nearby classés (dans la parcelle), export pipeline V5 (`google_nearby_ranked_json`). */
export type V5GoogleNearbyRankedEntry = {
  rank: number;
  place_id: string;
  name: string;
  vicinity?: string | null;
  types?: string[] | null;
  lat?: number | null;
  lng?: number | null;
};

/**
 * Lit `google_nearby_ranked_json` depuis Postgres / pipeline : souvent une chaîne JSON,
 * parfois un tableau JSONB natif après mise à jour client (`jsonb_set`).
 */
export function parseGoogleNearbyRankedJson(raw: unknown): V5GoogleNearbyRankedEntry[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((x) => x && typeof x === "object") as V5GoogleNearbyRankedEntry[];
  }
  if (typeof raw === "object") {
    return [raw as V5GoogleNearbyRankedEntry];
  }
  if (typeof raw !== "string") return [];
  const s = raw.trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    if (Array.isArray(v)) {
      return v.filter((x) => x && typeof x === "object") as V5GoogleNearbyRankedEntry[];
    }
    if (v && typeof v === "object") {
      return [v as V5GoogleNearbyRankedEntry];
    }
    return [];
  } catch {
    return [];
  }
}

/** POI OSM normalisés (export pipeline V5, champ `osm_pois_json`). */
export type V5OsmPoiEntry = {
  osm_type: string;
  osm_id: number;
  name: string;
  /** Adresse formatée depuis les tags OSM `addr:*` / `contact:address` (vide si absent). */
  address: string;
  website: string;
  phone: string;
  poi_primary_key?: string | null;
  poi_primary_value?: string | null;
  poi_type_label: string;
  osm_url: string;
  lat: number;
  lng: number;
};

export function parseOsmPoisJson(raw: string): V5OsmPoiEntry[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    if (!Array.isArray(v)) return [];
    const out: V5OsmPoiEntry[] = [];
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const osmType = strProp(o.osm_type) || "n";
      const idRaw = o.osm_id;
      const osmId = typeof idRaw === "number" && Number.isFinite(idRaw) ? Math.trunc(idRaw) : Number(strProp(idRaw));
      if (!Number.isFinite(osmId)) continue;
      const lat = typeof o.lat === "number" && Number.isFinite(o.lat) ? o.lat : Number(strProp(o.lat));
      const lng = typeof o.lng === "number" && Number.isFinite(o.lng) ? o.lng : Number(strProp(o.lng));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.push({
        osm_type: osmType.slice(0, 1),
        osm_id: osmId,
        name: strProp(o.name),
        address: strProp(o.address),
        website: strProp(o.website),
        phone: strProp(o.phone),
        poi_primary_key: o.poi_primary_key != null ? strProp(o.poi_primary_key) || null : null,
        poi_primary_value: o.poi_primary_value != null ? strProp(o.poi_primary_value) || null : null,
        poi_type_label: formatV5OsmPoiTypeLabelForDisplay(strProp(o.poi_type_label)),
        osm_url: strProp(o.osm_url),
        lat,
        lng,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Union des POI OSM sur plusieurs lignes parcelle (dédoublonnage par type+id). */
export function mergeOsmPoisFromParcelleRows(rows: ScoutMatchingV5Row[]): V5OsmPoiEntry[] {
  const seen = new Set<string>();
  const out: V5OsmPoiEntry[] = [];
  for (const r of rows) {
    if (r.grain !== "parcelle") continue;
    for (const poi of parseOsmPoisJson(r.osmPoisJson ?? "")) {
      const k = `${poi.osm_type}:${poi.osm_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(poi);
    }
  }
  out.sort((a, b) => {
    const an = (a.name || a.poi_type_label || "").toLowerCase();
    const bn = (b.name || b.poi_type_label || "").toLowerCase();
    return an.localeCompare(bn, "fr");
  });
  return out;
}

export type V5OsmBuildingContactEntry = {
  osm_building_id: string;
  name: string;
  typeLabel: string;
  phone: string;
  website: string;
  externalUrl: string;
};

/** Fusionne les contacts des bâtiments OSM depuis `building_geometries_json` (dédoublonnage par osm_building_id). */
export function mergeOsmBuildingContactsFromRows(rows: ScoutMatchingV5Row[]): V5OsmBuildingContactEntry[] {
  const seen = new Set<string>();
  const out: V5OsmBuildingContactEntry[] = [];
  for (const row of rows) {
    for (const item of parseMatchingV5BuildingGeometriesJson(row.buildingGeometriesJson ?? "")) {
      const osmBuildingId = strProp(item.osmBuildingId);
      if (!osmBuildingId || seen.has(osmBuildingId)) continue;
      const name = strProp(item.osmName) || strProp(item.osmRawTags?.name);
      if (!name) continue;
      seen.add(osmBuildingId);
      const typeLabel =
        strProp(item.osmPoiTypeLabel) ||
        formatV5ZoneTagLabel(strProp(item.zoneTag)) ||
        strProp(item.osmRawTags?.["building:use"]) ||
        strProp(item.osmRawTags?.building) ||
        "—";
      const website = strProp(item.osmWebsite);
      const externalUrl = website
        ? websiteHrefFromRaw(website)
        : osmBrowseUrlFromBuildingId(osmBuildingId);
      out.push({
        osm_building_id: osmBuildingId,
        name,
        typeLabel,
        phone: strProp(item.osmPhone),
        website,
        externalUrl,
      });
    }
  }
  out.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    if (byName !== 0) return byName;
    return a.osm_building_id.localeCompare(b.osm_building_id, "fr");
  });
  return out;
}

function websiteHrefFromRaw(raw: string): string {
  const t = strProp(raw);
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

/**
 * URL de la fiche OpenStreetMap depuis `osm_building_id` au format pipeline (`w:123`, `n:1`, `r:9`).
 */
export function osmBrowseUrlFromBuildingId(osmBuildingId: string): string {
  const raw = strProp(osmBuildingId);
  if (!raw) return "";
  const idx = raw.indexOf(":");
  if (idx <= 0) return "";
  const typeKey = raw.slice(0, idx).trim().toLowerCase();
  const idPart = raw.slice(idx + 1).trim();
  if (!idPart || !/^\d+$/.test(idPart)) return "";
  let slug: string;
  if (typeKey === "n" || typeKey === "node") slug = "node";
  else if (typeKey === "w" || typeKey === "way") slug = "way";
  else if (typeKey === "r" || typeKey === "relation") slug = "relation";
  else return "";
  return `https://www.openstreetmap.org/${slug}/${idPart}`;
}

function uniqueTrimmedPropStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const t = strProp(raw);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function matchingV5SourceRowsForPoiDiscovery(
  row: ScoutMatchingV5Row,
  parcelleCluster: ScoutMatchingV5Row[]
): ScoutMatchingV5Row[] {
  const out: ScoutMatchingV5Row[] = [];
  if (parcelleCluster.length > 0) {
    out.push(...parcelleCluster);
  }
  if (row.grain === "building") {
    out.push(row);
  }
  if (parcelleCluster.length === 0 && row.grain === "parcelle") {
    out.push(row);
  }
  return out;
}

function cadastreParcelHeroLabels(rows: ScoutMatchingV5Row[]): string {
  const parts = uniqueTrimmedPropStrings(
    rows
      .filter((r) => r.grain === "parcelle")
      .map((r) =>
        r.section && r.numeroNorm
          ? `Parcelle ${r.section} ${r.numeroNorm} · ${r.codeInsee || "—"}`
          : r.codeInsee
            ? `Parcelle ${r.codeInsee}`
            : ""
      )
  );
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return parts.join(" · ");
}

/** Adresse d'affichage confirmée (pipeline `display_address`). */
export function confirmedDisplayAddressFromRow(row: ScoutMatchingV5Row): string {
  const confidence =
    strProp(row.displayAddressConfidence) || strProp(row.properties?.display_address_confidence);
  if (confidence !== "confirmed") return "";
  return strProp(row.displayAddress) || strProp(row.properties?.display_address);
}

/**
 * Ligne d’adresse sous le titre Découverte : `display_address` confirmée, puis POI Google,
 * OSM POI, passerelle PPM, libellé cadastral.
 */
export function formatDiscoveryDrawerHeroAddress(
  row: ScoutMatchingV5Row,
  parcelleCluster: ScoutMatchingV5Row[]
): string {
  const poiSources = matchingV5SourceRowsForPoiDiscovery(row, parcelleCluster);
  const displayParts = uniqueTrimmedPropStrings(
    poiSources.map((r) => confirmedDisplayAddressFromRow(r))
  );
  if (displayParts.length === 1) return displayParts[0]!;
  if (displayParts.length > 1) return displayParts.join(" · ");

  const googleAnchors = uniqueTrimmedPropStrings(
    poiSources.map((r) => strProp(r.properties?.google_anchor_address))
  );
  if (googleAnchors.length === 1) return googleAnchors[0]!;
  if (googleAnchors.length > 1) return googleAnchors.join(" · ");

  const winnerIds = new Set(
    poiSources.map((r) => strProp(r.properties?.google_winner_place_id)).filter(Boolean)
  );
  const ranked: V5GoogleNearbyRankedEntry[] = [];
  for (const r of poiSources) {
    ranked.push(...parseGoogleNearbyRankedJson(r.properties?.google_nearby_ranked_json));
  }
  ranked.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  if (winnerIds.size > 0) {
    for (const e of ranked) {
      const pid = strProp(e.place_id);
      if (!pid || !winnerIds.has(pid)) continue;
      const vic = strProp(e.vicinity);
      if (vic) return vic;
    }
  }
  for (const e of ranked) {
    const vic = strProp(e.vicinity);
    if (vic) return vic;
  }

  const parcellesForOsm =
    parcelleCluster.length > 0 ? parcelleCluster : row.grain === "parcelle" ? [row] : [];
  for (const poi of mergeOsmPoisFromParcelleRows(parcellesForOsm)) {
    const a = strProp(poi.address);
    if (a) return a;
  }

  const passerelleRows =
    parcelleCluster.length > 0 ? parcelleCluster : row.grain === "parcelle" ? [row] : [];
  const passerelleParts: string[] = [];
  const pushPasserelle = (s: string) => {
    const t = strProp(s);
    if (!t || passerelleParts.includes(t)) return;
    passerelleParts.push(t);
  };
  for (const pr of passerelleRows) {
    pushPasserelle(pr.passerelleAddress);
    for (const p of parsePasserelleAddressesJson(pr.passerelleAddressesJson)) {
      pushPasserelle(strProp(p.address));
    }
  }
  if (row.grain === "building") {
    pushPasserelle(row.passerelleAddress);
    for (const p of parsePasserelleAddressesJson(row.passerelleAddressesJson)) {
      pushPasserelle(strProp(p.address));
    }
  }
  if (passerelleParts.length === 1) return passerelleParts[0]!;
  if (passerelleParts.length > 1) return passerelleParts.join(" · ");

  const cadastreRows =
    passerelleRows.length > 0 ? passerelleRows : row.grain === "parcelle" ? [row] : [];
  const cad = cadastreParcelHeroLabels(cadastreRows);
  if (cad) return cad;

  return "Adresse non renseignée";
}

/** Source de l’adresse affichée sous le titre Discovery (alignée sur `formatDiscoveryDrawerHeroAddress`). */
export type DiscoveryDrawerHeroAddressSource =
  | "osm"
  | "ppm"
  | "ban_reverse"
  | "sirene"
  | "google"
  | "osm_poi"
  | "cadastre"
  | "mixed";

function displayAddressSourceFromRow(row: ScoutMatchingV5Row): DiscoveryDrawerHeroAddressSource | null {
  if (!confirmedDisplayAddressFromRow(row)) return null;
  const raw =
    strProp(row.displayAddressSource) || strProp(row.properties?.display_address_source);
  if (raw === "osm" || raw === "ppm" || raw === "ban_reverse" || raw === "sirene") {
    return raw;
  }
  return null;
}

/**
 * Source de la ligne d’adresse hero Discovery (même priorité que `formatDiscoveryDrawerHeroAddress`).
 * `null` si adresse absente ou libellé cadastral seul sans source explicite.
 */
export function resolveDiscoveryDrawerHeroAddressSource(
  row: ScoutMatchingV5Row,
  parcelleCluster: ScoutMatchingV5Row[]
): DiscoveryDrawerHeroAddressSource | null {
  const poiSources = matchingV5SourceRowsForPoiDiscovery(row, parcelleCluster);
  const displaySourceSet = new Set<DiscoveryDrawerHeroAddressSource>();
  for (const r of poiSources) {
    const s = displayAddressSourceFromRow(r);
    if (s) displaySourceSet.add(s);
  }
  const hasDisplay = poiSources.some((r) => Boolean(confirmedDisplayAddressFromRow(r)));
  if (hasDisplay) {
    if (displaySourceSet.size === 0) return null;
    if (displaySourceSet.size === 1) return [...displaySourceSet][0]!;
    return "mixed";
  }

  const googleAnchors = uniqueTrimmedPropStrings(
    poiSources.map((r) => strProp(r.properties?.google_anchor_address))
  );
  if (googleAnchors.length > 0) return "google";

  const winnerIds = new Set(
    poiSources.map((r) => strProp(r.properties?.google_winner_place_id)).filter(Boolean)
  );
  const ranked: V5GoogleNearbyRankedEntry[] = [];
  for (const r of poiSources) {
    ranked.push(...parseGoogleNearbyRankedJson(r.properties?.google_nearby_ranked_json));
  }
  ranked.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  if (winnerIds.size > 0) {
    for (const e of ranked) {
      const pid = strProp(e.place_id);
      if (!pid || !winnerIds.has(pid)) continue;
      if (strProp(e.vicinity)) return "google";
    }
  }
  for (const e of ranked) {
    if (strProp(e.vicinity)) return "google";
  }

  const parcellesForOsm =
    parcelleCluster.length > 0 ? parcelleCluster : row.grain === "parcelle" ? [row] : [];
  for (const poi of mergeOsmPoisFromParcelleRows(parcellesForOsm)) {
    if (strProp(poi.address)) return "osm_poi";
  }

  const passerelleRows =
    parcelleCluster.length > 0 ? parcelleCluster : row.grain === "parcelle" ? [row] : [];
  const pushPasserelle = (s: string) => Boolean(strProp(s));
  for (const pr of passerelleRows) {
    if (pushPasserelle(pr.passerelleAddress)) return "ppm";
    for (const p of parsePasserelleAddressesJson(pr.passerelleAddressesJson)) {
      if (pushPasserelle(strProp(p.address))) return "ppm";
    }
  }
  if (row.grain === "building") {
    if (pushPasserelle(row.passerelleAddress)) return "ppm";
    for (const p of parsePasserelleAddressesJson(row.passerelleAddressesJson)) {
      if (pushPasserelle(strProp(p.address))) return "ppm";
    }
  }

  const cadastreRows =
    passerelleRows.length > 0 ? passerelleRows : row.grain === "parcelle" ? [row] : [];
  if (cadastreParcelHeroLabels(cadastreRows)) return "cadastre";

  return null;
}

const DISCOVERY_HERO_ADDRESS_SOURCE_LABEL_FR: Record<DiscoveryDrawerHeroAddressSource, string> =
  {
    osm: "OSM",
    ppm: "PPM",
    ban_reverse: "BAN",
    sirene: "SIRENE",
    google: "Google",
    osm_poi: "OSM",
    cadastre: "Cadastre",
    mixed: "Mixte",
  };

/** Libellé court pour badge discret à côté de l’adresse Discovery. */
export function formatDiscoveryDrawerHeroAddressSourceLabel(
  source: DiscoveryDrawerHeroAddressSource | null | undefined
): string {
  if (!source) return "";
  return DISCOVERY_HERO_ADDRESS_SOURCE_LABEL_FR[source] ?? "";
}

/** Identifiants `batiment_construction_id` avec `matching_status === "partage"` dans buildings_json. */
export function collectPartageBatimentConstructionIds(row: ScoutMatchingV5Row): Set<string> {
  const sharedIds = new Set<string>();
  const raw = row.buildingsJson?.trim() || "";
  if (!raw) return sharedIds;
  try {
    const parsed = JSON.parse(raw) as Array<{
      batiment_construction_id?: string;
      matching_status?: string;
    }>;
    for (const it of parsed) {
      if (
        (it?.matching_status || "").trim().toLowerCase() === "partage" &&
        it?.batiment_construction_id
      ) {
        sharedIds.add(String(it.batiment_construction_id).trim());
      }
    }
  } catch {
    // ignore
  }
  return sharedIds;
}

/**
 * Identifiants pour `/api/matching-v5/buildings` (empreintes BDNB), dérivés de `buildings_json`
 * sur les lignes `grain === "parcelle"`. Aligné sur Solar Scout (chargement des polygones bâtiment).
 */
export function collectBatimentIdsForMatchingV5BuildingsApi(rows: ScoutMatchingV5Row[]): string[] {
  const idSeen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    if (row.grain === "building") {
      const bc = String(row.bdnbBatimentConstructionId || row.batimentConstructionId || "").trim();
      const bg = String(row.batimentGroupeId || "").trim();
      const id = bc || bg;
      if (id && !idSeen.has(id)) {
        idSeen.add(id);
        ids.push(id);
      }
      continue;
    }
    if (row.grain !== "parcelle") continue;
    const raw = row.buildingsJson?.trim() || "";
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Array<{
        batiment_construction_id?: string;
        bdnb_batiment_construction_id?: string;
        batiment_groupe_id?: string;
      }>;
      for (const it of parsed) {
        const id = String(
          it?.bdnb_batiment_construction_id || it?.batiment_construction_id || it?.batiment_groupe_id || ""
        ).trim();
        if (id && !idSeen.has(id)) {
          idSeen.add(id);
          ids.push(id);
        }
      }
    } catch {
      // ignore
    }
  }
  return ids;
}

/**
 * Ligne matching à sélectionner après clic sur l’empreinte BDNB (`batiment_construction_id` ou `batiment_groupe_id`).
 * Priorité : `grain === "building"` dont les ids BDNB correspondent ; sinon parcelle dont `buildings_json` contient ce bâtiment.
 */
export function findMatchingV5RowIdForBatimentFootprint(
  rows: ScoutMatchingV5Row[],
  batimentId: string
): string | null {
  const bc = String(batimentId || "").trim();
  if (!bc) return null;

  const buildingMatches: ScoutMatchingV5Row[] = [];
  for (const r of rows) {
    if (r.grain !== "building") continue;
    if (r.batimentConstructionId === bc || r.batimentGroupeId === bc) {
      buildingMatches.push(r);
    }
  }
  if (buildingMatches.length > 0) {
    buildingMatches.sort((a, b) => a.id.localeCompare(b.id));
    return buildingMatches[0]!.id;
  }

  const parcelleMatches: ScoutMatchingV5Row[] = [];
  for (const r of rows) {
    if (r.grain !== "parcelle") continue;
    const raw = r.buildingsJson?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Array<{
        batiment_construction_id?: string;
        batiment_groupe_id?: string;
      }>;
      const hit = parsed.some((it) => {
        const c = String(it?.batiment_construction_id || "").trim();
        const g = String(it?.batiment_groupe_id || "").trim();
        return c === bc || g === bc;
      });
      if (hit) parcelleMatches.push(r);
    } catch {
      // ignore
    }
  }
  if (parcelleMatches.length === 0) return null;
  return sortMatchingV5ParcelleRowsByCadastre(parcelleMatches)[0]!.id;
}

/**
 * Parcelles V5 partageant au moins un bâtiment en `partage` avec l’ancre (cross-cadastre).
 * Sinon `[anchor]`. Les entrées `grain !== "parcelle"` retournent `[anchor]`.
 */
export function findMatchingV5LinkedParcelleRows(
  anchor: ScoutMatchingV5Row,
  allRows: ScoutMatchingV5Row[]
): ScoutMatchingV5Row[] {
  if (anchor.grain !== "parcelle") return [anchor];
  const sharedIds = collectPartageBatimentConstructionIds(anchor);
  if (sharedIds.size === 0) return [anchor];
  const linked: ScoutMatchingV5Row[] = [];
  const seen = new Set<string>();
  for (const row of allRows) {
    if (row.grain !== "parcelle") continue;
    if (seen.has(row.id)) continue;
    const raw = row.buildingsJson?.trim() || "";
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Array<{ batiment_construction_id?: string }>;
      const hasShared = parsed.some((it) =>
        sharedIds.has(String(it?.batiment_construction_id || "").trim())
      );
      if (hasShared) {
        seen.add(row.id);
        linked.push(row);
      }
    } catch {
      // ignore
    }
  }
  return sortMatchingV5ParcelleRowsByCadastre(linked.length > 0 ? linked : [anchor]);
}

/** Tri stable cadastre (comme l’export liste / surbrillance carte). */
export function sortMatchingV5ParcelleRowsByCadastre(rows: ScoutMatchingV5Row[]): ScoutMatchingV5Row[] {
  return [...rows].sort((a, b) => {
    const ci = a.codeInsee.localeCompare(b.codeInsee);
    if (ci !== 0) return ci;
    const s = a.section.localeCompare(b.section);
    if (s !== 0) return s;
    const n = a.numeroNorm.localeCompare(b.numeroNorm);
    if (n !== 0) return n;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Composante connexe des parcelles reliées par au moins un `batiment_construction_id` en
 * `matching_status === "partage"` (chaîne 1–2–3 si 1↔2 et 2↔3 via bâtiments distincts).
 * Sans arête « partage » sur l’ancre : `[anchor]`. Grain non-parcelle : `[anchor]`.
 */
export function findMatchingV5LinkedParcelleRowsTransitive(
  anchor: ScoutMatchingV5Row,
  allRows: ScoutMatchingV5Row[]
): ScoutMatchingV5Row[] {
  if (anchor.grain !== "parcelle") return [anchor];

  const parcelleRows = allRows.filter((r) => r.grain === "parcelle");
  const idToRow = new Map(parcelleRows.map((r) => [r.id, r]));

  const partageByParcelId = new Map<string, Set<string>>();
  for (const r of parcelleRows) {
    partageByParcelId.set(r.id, collectPartageBatimentConstructionIds(r));
  }

  const anchorPartage = partageByParcelId.get(anchor.id);
  if (!anchorPartage || anchorPartage.size === 0) return [anchor];

  const bidToParcelIds = new Map<string, Set<string>>();
  for (const r of parcelleRows) {
    const bids = partageByParcelId.get(r.id);
    if (!bids) continue;
    for (const bid of Array.from(bids)) {
      if (!bidToParcelIds.has(bid)) bidToParcelIds.set(bid, new Set());
      bidToParcelIds.get(bid)!.add(r.id);
    }
  }

  const visited = new Set<string>();
  const stack: string[] = [anchor.id];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (visited.has(pid)) continue;
    visited.add(pid);
    const bids = partageByParcelId.get(pid);
    if (!bids) continue;
    for (const bid of Array.from(bids)) {
      const neigh = bidToParcelIds.get(bid);
      if (!neigh) continue;
      for (const nid of Array.from(neigh)) {
        if (!visited.has(nid)) stack.push(nid);
      }
    }
  }

  const result: ScoutMatchingV5Row[] = [];
  for (const id of Array.from(visited)) {
    const r = idToRow.get(id);
    if (r) result.push(r);
  }
  return sortMatchingV5ParcelleRowsByCadastre(result.length > 0 ? result : [anchor]);
}

/**
 * Parcelles dont la clé cadastrale figure dans `parcelles_json` d’une ligne **building** (multi-parcelles).
 */
export function findMatchingV5ParcelleRowsForBuilding(
  building: ScoutMatchingV5Row,
  allRows: ScoutMatchingV5Row[]
): ScoutMatchingV5Row[] {
  if (building.grain !== "building") return [];
  const raw = building.parcellesJson?.trim();
  if (!raw) return [];
  let items: unknown;
  try {
    items = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];
  const keys = new Set<string>();
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const ci = String(o.code_insee ?? "").trim();
    const sec = String(o.section ?? "").trim();
    const num = String(o.numero_norm ?? "").trim();
    if (ci && sec && num) keys.add(`${ci}|${sec}|${num}`);
  }
  if (keys.size === 0) return [];
  return allRows.filter(
    (r) => r.grain === "parcelle" && keys.has(`${r.codeInsee}|${r.section}|${r.numeroNorm}`)
  );
}

export function parseSiretsMatchJson(raw: string): V5MatchedSiret[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    if (!Array.isArray(v)) return [];
    const out: V5MatchedSiret[] = [];
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const siret = strProp(o.siret);
      if (!siret) continue;
      const scoreRaw = o.score;
      const score =
        typeof scoreRaw === "number" && Number.isFinite(scoreRaw)
          ? scoreRaw
          : Number(strProp(scoreRaw));
      const trancheRaw =
        o.tranche_effectifs ?? o.tranche_effectif_salarie ?? (o as { tranche_effectif?: unknown }).tranche_effectif;
      const anneeRaw =
        o.annee_effectifs ??
        o.annee_tranche_effectif_salarie ??
        (o as { annee_tranche_effectif?: unknown }).annee_tranche_effectif;
      const apeRaw =
        o.activite_principale ??
        (o as { naf?: unknown }).naf ??
        (o as { code_naf?: unknown }).code_naf ??
        (o as { ape?: unknown }).ape;
      out.push({
        siret,
        siren: strProp(o.siren) || undefined,
        denomination: o.denomination != null ? String(o.denomination) : null,
        adresse_etablissement: o.adresse_etablissement != null ? String(o.adresse_etablissement) : null,
        tranche_effectifs: trancheRaw != null ? String(trancheRaw) : null,
        annee_effectifs: anneeRaw != null ? String(anneeRaw) : null,
        activite_principale: apeRaw != null ? String(apeRaw) : null,
        score: Number.isFinite(score) ? score : undefined,
        reason: strProp(o.reason) || undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Adresses textuelles utiles pour un rapprochement Enedis (passerelle, PPM, SIRENE).
 * Ordre : adresse agrégée parcelle, puis PPM, puis établissements matchés (dédoublonné).
 */
export function collectV5AddressHintsForEnedis(row: ScoutMatchingV5Row): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string | null | undefined) => {
    const t = String(s ?? "").trim();
    if (t.length < 3) return;
    const k = t.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  push(row.passerelleAddress);
  for (const p of parsePasserelleAddressesJson(row.passerelleAddressesJson)) {
    push(p.address);
  }
  for (const e of parseSiretsMatchJson(row.siretsJson)) {
    push(e.adresse_etablissement);
  }
  return out;
}

function tryParseSirensJsonArray(raw: string): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const x of v) {
      const t = String(x).trim();
      if (/^\d{9}$/.test(t)) out.push(t);
    }
    return out;
  } catch {
    return [];
  }
}

/** SIREN uniques issus du matching adresse, de la passerelle PPM et de `sirens_json`. */
export function collectSirensFromMatchingV5Row(row: ScoutMatchingV5Row): string[] {
  const out = new Set<string>();
  for (const e of parseSiretsMatchJson(row.siretsJson)) {
    const x = e.siren?.trim();
    if (x && /^\d{9}$/.test(x)) out.add(x);
  }
  for (const p of parsePasserelleAddressesJson(row.passerelleAddressesJson)) {
    const x = p.siren?.trim();
    if (x && /^\d{9}$/.test(x)) out.add(x);
  }
  for (const x of tryParseSirensJsonArray(row.sirensJson)) {
    out.add(x);
  }
  return Array.from(out);
}

/** Union des SIREN (matching + PPM + sirens_json) sur plusieurs lignes parcelle. */
export function collectSirensFromMatchingV5Rows(rows: ScoutMatchingV5Row[]): string[] {
  const out = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    for (const s of collectSirensFromMatchingV5Row(row)) {
      out.add(s);
    }
  }
  return Array.from(out);
}

/**
 * Centroïde pour un groupe de parcelles : moyenne des centroïdes pondérée par l’aire cadastrale (m²)
 * approximée sur chaque polygone (pas d’union géométrique exacte).
 */
function geometryWeightM2ForCentroid(row: ScoutMatchingV5Row): number {
  const g = row.geometry;
  if (g.type === "Point") return Math.max(1, row.footprintSumM2);
  return Math.max(1, polygonAreaM2ApproxWgs84(g));
}

export function centroidWeightedFromParcelleRowGeometries(
  rows: ScoutMatchingV5Row[]
): { lat: number; lng: number } | null {
  let sumLat = 0;
  let sumLng = 0;
  let sumW = 0;
  for (const r of rows) {
    if (r.grain !== "parcelle") continue;
    const c = latLngFromMatchingGeometry(r.geometry);
    if (!c) continue;
    const w = geometryWeightM2ForCentroid(r);
    sumLat += c.lat * w;
    sumLng += c.lng * w;
    sumW += w;
  }
  if (sumW <= 0) return null;
  return { lat: sumLat / sumW, lng: sumLng / sumW };
}

export function parseMatchingV5GeoJsonFeatureCollection(raw: unknown): {
  rows: ScoutMatchingV5Row[];
  error: string | null;
} {
  if (!raw || typeof raw !== "object") return { rows: [], error: "GeoJSON invalide" };
  const fc = raw as { type?: string; features?: unknown[] };
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    return { rows: [], error: "Attendu un FeatureCollection" };
  }
  if (fc.features.length === 0) {
    return { rows: [], error: null };
  }
  const rows: ScoutMatchingV5Row[] = [];
  for (const feat of fc.features) {
    if (!feat || typeof feat !== "object") continue;
    const f = feat as {
      id?: unknown;
      geometry?: unknown;
      properties?: Record<string, unknown>;
    };
    const geom = parseGeometry(f.geometry);
    if (!geom) continue;
    const p = f.properties ?? {};
    const id = strProp(f.id) || strProp(p.scout_v5_id);
    if (!id) continue;
    const grainRaw = strProp(p.grain).toLowerCase();
    const grain: ScoutMatchingV5Grain = grainRaw === "building" ? "building" : "parcelle";
    const batimentConstructionId = strProp(p.batiment_construction_id) || null;
    const bdnbBatimentConstructionId = strProp(p.bdnb_batiment_construction_id) || null;
    const batimentGroupeId = strProp(p.batiment_groupe_id) || null;
    const osmBuildingId = strProp(p.osm_building_id);
    const osmMatchStatus = strProp(p.osm_match_status);
    const osmBdnbIntersectionAreaM2Raw = Number(strProp(p.osm_bdnb_intersection_area_m2));
    const osmBdnbIntersectionAreaM2 = Number.isFinite(osmBdnbIntersectionAreaM2Raw)
      ? Math.max(0, osmBdnbIntersectionAreaM2Raw)
      : 0;
    const osmAddressText = strProp(p.osm_address_text);
    const section = strProp(p.section);
    const numeroNorm = strProp(p.numero_norm);
    const codeInsee = strProp(p.code_insee);
    const nb = Number(strProp(p.nb_batiments));
    const nbBatiments = Number.isFinite(nb) ? Math.max(0, Math.trunc(nb)) : 0;
    const fs = Number(strProp(p.footprint_sum_m2));
    const footprintSumM2 = Number.isFinite(fs) ? Math.max(0, fs) : 0;
    const sirenStatus = strProp(p.siren_status);
    const statusTechnique = strProp(p.status_technique);
    const statusMetier = normalizeStatusMetier(strProp(p.status_metier));
    const siretCountRaw = Number(strProp(p.siret_count));
    const siretCount = Number.isFinite(siretCountRaw) ? Math.max(0, Math.trunc(siretCountRaw)) : 0;
    const matchingConfidenceRaw = Number(strProp(p.matching_confidence));
    const matchingConfidence = Number.isFinite(matchingConfidenceRaw) ? Math.max(0, matchingConfidenceRaw) : 0;
    const passerelleAddress = strProp(p.passerelle_address);
    const passerelleAddressesJson = strProp(p.passerelle_addresses_json);
    const displayAddress = strProp(p.display_address);
    const displayAddressSource = strProp(p.display_address_source);
    const displayAddressConfidence = strProp(p.display_address_confidence);
    const osmPoisJson = strProp(p.osm_pois_json);
    const osmPoiCountRaw = Number(strProp(p.osm_poi_count));
    const osmPoiCount = Number.isFinite(osmPoiCountRaw) ? Math.max(0, Math.trunc(osmPoiCountRaw)) : 0;
    const osmPoisStatus = strProp(p.osm_pois_status);
    const osmPoiTruncatedRaw = Number(strProp(p.osm_poi_truncated));
    const osmPoiTruncated = Number.isFinite(osmPoiTruncatedRaw) ? Math.max(0, Math.trunc(osmPoiTruncatedRaw)) : 0;
    const osmDataAsOf = strProp(p.osm_data_as_of);
    let label: string;
    if (grain === "building") {
      if (batimentConstructionId) {
        label = `Bât. multi-parcelles · ${batimentConstructionId}${batimentGroupeId ? ` (groupe ${batimentGroupeId})` : ""}`;
      } else {
        label = batimentGroupeId ? `Bât. multi-parcelles · ${batimentGroupeId}` : "Bât. multi-parcelles";
      }
    } else {
      label =
        section && numeroNorm
          ? `Parcelle ${section} ${numeroNorm}`
          : `Parcelle ${codeInsee || "—"}`;
    }
    rows.push({
      id,
      grain,
      geometry: geom,
      label,
      batimentConstructionId,
      bdnbBatimentConstructionId,
      batimentGroupeId,
      osmBuildingId: osmBuildingId || undefined,
      osmMatchStatus: osmMatchStatus || undefined,
      osmBdnbIntersectionAreaM2,
      osmAddressText: osmAddressText || undefined,
      codeInsee,
      section,
      numeroNorm,
      nbBatiments,
      footprintSumM2,
      sirenStatus,
      statusTechnique,
      statusMetier,
      siretCount,
      siretsJson: strProp(p.sirets_json),
      sirensJson: strProp(p.sirens_json),
      matchingConfidence,
      matchingReason: strProp(p.matching_reason),
      passerelleAddress,
      passerelleAddressesJson,
      displayAddress: displayAddress || undefined,
      displayAddressSource: displayAddressSource || undefined,
      displayAddressConfidence: displayAddressConfidence || undefined,
      parcellesJson: strProp(p.parcelles_json),
      /** JSONB / tableau natif côté API : `strProp` produirait `[object Object]` et casserait le parsing. */
      buildingsJson: jsonStringProp(p.buildings_json),
      buildingGeometriesJson: jsonStringProp(p.building_geometries_json),
      parkingGeometriesJson: jsonStringProp(p.parking_geometries_json),
      osmPoisJson,
      osmPoiCount,
      osmPoisStatus,
      osmPoiTruncated,
      osmDataAsOf,
      properties: { ...p },
    });
  }
  if (rows.length === 0) {
    return {
      rows: [],
      error:
        "Aucune ligne reconnue : id/scout_v5_id manquant ou géométrie non prise en charge (Point en mode aperçu, polygone en détail).",
    };
  }
  return { rows, error: null };
}
