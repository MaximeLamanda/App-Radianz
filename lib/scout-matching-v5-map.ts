/**
 * Couche discovery Matching V5 — export GeoJSON généré par
 * `data-pipeline/matching_v5/run_matching_v5.py` (défaut public/geo/matching-v5-33318.geojson).
 */

import { centroidFromGeoJsonPolygonLike } from "@/lib/matching-v5-google-poi-fallback/centroid-from-geojson";
import { polygonAreaM2ApproxWgs84 } from "@/lib/geojson-polygon-area-m2";

export type ScoutMatchingV5Grain = "building" | "parcelle";

export type ScoutMatchingV5Row = {
  id: string;
  grain: ScoutMatchingV5Grain;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  /** Titre court pour la liste latérale */
  label: string;
  batimentConstructionId: string | null;
  batimentGroupeId: string | null;
  codeInsee: string;
  section: string;
  numeroNorm: string;
  codeIris: string;
  nomIris: string;
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
  parcellesJson: string;
  buildingsJson: string;
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

function parseGeometry(g: unknown): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!g || typeof g !== "object") return null;
  const t = (g as { type?: string }).type;
  if (t === "Polygon" || t === "MultiPolygon") {
    return g as GeoJSON.Polygon | GeoJSON.MultiPolygon;
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
  batimentGroupeId: string | null;
  anneeConstruction: number | null;
  footprintM2: number | null;
  intersectionAreaM2: number | null;
  matchingStatus: string;
  matchingDecision: string;
  matchingSirenSelected: string;
};

function numPropNullable(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
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
        batimentGroupeId: bg || null,
        anneeConstruction: numPropNullable(o.annee_construction),
        footprintM2: numPropNullable(o.footprint_m2),
        intersectionAreaM2: numPropNullable(o.intersection_area_m2),
        matchingStatus: strProp(o.matching_status),
        matchingDecision: strProp(o.matching_decision),
        matchingSirenSelected: strProp(o.matching_siren_selected),
      });
    }
    return out;
  } catch {
    return [];
  }
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

export function parseGoogleNearbyRankedJson(raw: string): V5GoogleNearbyRankedEntry[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x) => x && typeof x === "object") as V5GoogleNearbyRankedEntry[];
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
      const bc = String(row.batimentConstructionId || "").trim();
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
        batiment_groupe_id?: string;
      }>;
      for (const it of parsed) {
        const id = String(it?.batiment_construction_id || it?.batiment_groupe_id || "").trim();
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
export function centroidWeightedFromParcelleRowGeometries(
  rows: ScoutMatchingV5Row[]
): { lat: number; lng: number } | null {
  let sumLat = 0;
  let sumLng = 0;
  let sumW = 0;
  for (const r of rows) {
    if (r.grain !== "parcelle") continue;
    const c = centroidFromGeoJsonPolygonLike(r.geometry);
    if (!c) continue;
    const w = Math.max(1, polygonAreaM2ApproxWgs84(r.geometry));
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
    const batimentGroupeId = strProp(p.batiment_groupe_id) || null;
    const section = strProp(p.section);
    const numeroNorm = strProp(p.numero_norm);
    const codeInsee = strProp(p.code_insee);
    const codeIris = strProp(p.code_iris);
    const nomIris = strProp(p.nom_iris);
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
          ? `Parcelle ${section} ${numeroNorm}${codeIris ? ` · ${codeIris}` : ""}`
          : `Parcelle ${codeInsee || "—"}`;
    }
    rows.push({
      id,
      grain,
      geometry: geom,
      label,
      batimentConstructionId,
      batimentGroupeId,
      codeInsee,
      section,
      numeroNorm,
      codeIris,
      nomIris,
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
      parcellesJson: strProp(p.parcelles_json),
      buildingsJson: strProp(p.buildings_json),
      osmPoisJson,
      osmPoiCount,
      osmPoisStatus,
      osmPoiTruncated,
      osmDataAsOf,
      properties: { ...p },
    });
  }
  if (rows.length === 0) {
    return { rows: [], error: "Aucune entité avec géométrie valide (Polygon/MultiPolygon)" };
  }
  return { rows, error: null };
}
