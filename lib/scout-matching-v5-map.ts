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
  properties: Record<string, unknown>;
};

function strProp(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
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
      properties: { ...p },
    });
  }
  if (rows.length === 0) {
    return { rows: [], error: "Aucune entité avec géométrie valide (Polygon/MultiPolygon)" };
  }
  return { rows, error: null };
}
