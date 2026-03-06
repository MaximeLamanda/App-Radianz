/**
 * findLocalSiren – matching établissement LOCAL vs sièges nationaux (API Sirene).
 * Stratégie : 4 requêtes parallèles → scoring composite (fuzzy nom, rue, CP, distance GPS).
 */

import Fuse from "fuse.js";
import { extractCodePostal } from "./recherche-entreprises";

/** Contexte parsé depuis l'adresse pour les 4 requêtes */
export interface ParsedAddress {
  ville: string | null;
  codePostal: string | null;
  rue: string | null;
}

/** Un candidat établissement (siège ou établissement secondaire) pour le scoring */
export interface LocalSirenCandidate {
  siren: string;
  siret: string;
  nom_complet: string;
  adresse: string;
  code_postal: string;
  latitude: number | null;
  longitude: number | null;
}

/** Résultat retourné par findLocalSiren */
export interface FindLocalSirenResult {
  siren: string;
  siret: string;
  nom_complet: string;
  adresse: string;
  code_postal: string;
  score: number; // 0-1000
}

/** Un candidat scoré (pour debug / logs) */
export interface ScoredCandidate {
  rank: number;
  score: number;
  siren: string;
  siret: string;
  nom_complet: string;
  code_postal: string;
  adresse: string;
}

const PER_PAGE = 20;
const DISTANCE_KM_THRESHOLD = 1;
const EARTH_RADIUS_KM = 6371;

/**
 * Parse l'adresse pour extraire ville, CP et rue (segment avant "ville CP").
 */
export function parseAddressForLocalSiren(address: string): ParsedAddress {
  const raw = (address ?? "").trim();
  const codePostal = raw ? extractCodePostal(raw) : null;
  const segments = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const segmentWithCp = codePostal ? segments.find((s) => s.includes(codePostal)) : null;
  const ville = segmentWithCp
    ? segmentWithCp.replace(/\d{5}\s*/, "").trim() || null
    : null;

  const cpIndex = segmentWithCp ? segments.findIndex((s) => s.includes(codePostal!)) : -1;
  const rue = cpIndex > 0 ? segments[cpIndex - 1] : null;

  return { ville, codePostal, rue };
}

/**
 * Construit les 4 requêtes pour PHASE 1 (parallèles) :
 * q1: "${poiName}" + ville + CP
 * q2: "${poiName}" + ville
 * q3: rue + ville + CP
 * q4: ville + CP + rue
 */
export function buildLocalSirenQueries(
  poiName: string,
  address: string
): string[] {
  const { ville, codePostal, rue } = parseAddressForLocalSiren(address);
  const queries: string[] = [];

  if (poiName && ville && codePostal) {
    queries.push(`"${poiName.trim()}" ${ville} ${codePostal}`);
  }
  if (poiName && ville) {
    queries.push(`"${poiName.trim()}" ${ville}`);
  }
  if (rue && ville && codePostal) {
    queries.push(`"${rue}" ${ville} ${codePostal}`);
  }
  if (ville && codePostal && rue) {
    queries.push(`${ville} ${codePostal} ${rue}`);
  }

  return queries;
}

/**
 * Distance Haversine en km entre deux points (lat/lon en degrés).
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function normalizeForMatch(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Score composite 0–1000 :
 * 40% fuzzy_nom (Fuse), 30% exact_rue, 20% exact_CP, 10% distance < 1 km.
 */
export function scoreCandidate(
  poiName: string,
  poiRue: string | null,
  poiCP: string | null,
  poiLat: number,
  poiLon: number,
  candidate: LocalSirenCandidate
): number {
  let partNom = 0;
  const fuseOne = new Fuse([{ nom: candidate.nom_complet }], {
    keys: ["nom"],
    threshold: 0.6,
    includeScore: true,
  });
  const nomSearch = fuseOne.search(poiName.trim());
  if (nomSearch.length > 0 && nomSearch[0].score != null) {
    partNom = Math.max(0, 1 - nomSearch[0].score);
  }

  let partRue = 0;
  if (poiRue && candidate.adresse) {
    const a = normalizeForMatch(poiRue);
    const b = normalizeForMatch(candidate.adresse);
    partRue = b.includes(a) || a.includes(b) ? 1 : 0;
  }

  let partCP = 0;
  if (poiCP && candidate.code_postal) {
    partCP = candidate.code_postal.trim() === poiCP.trim() ? 1 : 0;
  }

  let partDist = 0;
  if (
    candidate.latitude != null &&
    candidate.longitude != null &&
    Number.isFinite(poiLat) &&
    Number.isFinite(poiLon)
  ) {
    const km = haversineKm(
      poiLat,
      poiLon,
      candidate.latitude,
      candidate.longitude
    );
    partDist = km <= DISTANCE_KM_THRESHOLD ? 1 : 0;
  }

  return (
    Math.round(400 * partNom) +
    Math.round(300 * partRue) +
    Math.round(200 * partCP) +
    Math.round(100 * partDist)
  );
}

/** Structure minimale d'un résultat API (siège ou établissement) pour aplatissement */
export interface ApiEtablissement {
  adresse?: string;
  geo_adresse?: string;
  code_postal?: string;
  latitude?: string;
  longitude?: string;
  siret?: string;
}

export interface ApiResultCompany {
  siren?: string;
  nom_complet?: string;
  siege?: ApiEtablissement;
  matching_etablissements?: ApiEtablissement[];
}

/**
 * Aplatit les résultats API (entreprises) en liste de candidats (un par siège + un par établissement).
 */
export function flattenApiResultsToCandidates(
  results: ApiResultCompany[]
): LocalSirenCandidate[] {
  const candidates: LocalSirenCandidate[] = [];
  const seen = new Set<string>();

  for (const company of results) {
    const nom = company.nom_complet ?? "";
    const siren = company.siren ?? "";

    if (company.siege) {
      const siret = company.siege.siret ?? "";
      if (siret && !seen.has(siret)) {
        seen.add(siret);
        candidates.push({
          siren,
          siret,
          nom_complet: nom,
          adresse: company.siege.geo_adresse ?? company.siege.adresse ?? "",
          code_postal: company.siege.code_postal ?? "",
          latitude: parseCoord(company.siege.latitude),
          longitude: parseCoord(company.siege.longitude),
        });
      }
    }

    for (const etab of company.matching_etablissements ?? []) {
      const siret = etab.siret ?? "";
      if (siret && !seen.has(siret)) {
        seen.add(siret);
        candidates.push({
          siren,
          siret,
          nom_complet: nom,
          adresse: etab.geo_adresse ?? etab.adresse ?? "",
          code_postal: etab.code_postal ?? "",
          latitude: parseCoord(etab.latitude),
          longitude: parseCoord(etab.longitude),
        });
      }
    }
  }

  return candidates;
}

function parseCoord(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export interface FindLocalSirenOptions {
  /** Si true, la réponse inclut phase2Scoring pour debug. */
  debug?: boolean;
}

/**
 * Trouve l'établissement LOCAL le plus pertinent (score 0–1000).
 * PHASE 1 : 4 requêtes parallèles (per_page=20).
 * PHASE 2 : scoring composite (fuzzy nom 40%, rue 30%, CP 20%, distance 10%).
 *
 * @param poiName – nom du POI (ex. "Decathlon Dreux")
 * @param address – adresse complète
 * @param lat – latitude du POI
 * @param lon – longitude du POI
 * @param fetcher – (q) => Promise<{ results: ApiResultCompany[] }> (ex. appel API gouv)
 * @param options – debug: true pour retourner phase2Scoring dans le résultat
 */
export async function findLocalSiren(
  poiName: string,
  address: string,
  lat: number,
  lon: number,
  fetcher: (q: string, perPage: number) => Promise<{ results?: ApiResultCompany[] }>,
  options?: FindLocalSirenOptions
): Promise<FindLocalSirenResult | (FindLocalSirenResult & { phase2Scoring: ScoredCandidate[] }) | null> {
  const parsed = parseAddressForLocalSiren(address);
  const queries = buildLocalSirenQueries(poiName, address);
  if (queries.length === 0) return null;

  const allResults: ApiResultCompany[] = [];
  await Promise.all(
    queries.map(async (q) => {
      const data = await fetcher(q, PER_PAGE);
      const list = data.results ?? [];
      allResults.push(...list);
    })
  );

  const candidates = flattenApiResultsToCandidates(allResults);
  if (candidates.length === 0) return null;

  const scored = candidates.map((c) => {
    const s = scoreCandidate(
      poiName,
      parsed.rue,
      parsed.codePostal,
      lat,
      lon,
      c
    );
    return { candidate: c, score: s };
  });

  scored.sort((a, b) => b.score - a.score);

  const phase2Scoring: ScoredCandidate[] = scored.map(({ candidate, score }, i) => ({
    rank: i + 1,
    score,
    siren: candidate.siren,
    siret: candidate.siret,
    nom_complet: candidate.nom_complet,
    code_postal: candidate.code_postal,
    adresse: candidate.adresse,
  }));

  if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test") {
    console.log("[find-local-siren] Phase 2 – nombre de candidats:", scored.length);
    phase2Scoring.forEach((p) => {
      console.log(
        `[find-local-siren] Phase 2 – #${p.rank} score=${p.score} SIRET=${p.siret} | ${p.nom_complet} | ${p.code_postal} ${p.adresse?.slice(0, 50) ?? ""}`
      );
    });
    const best = scored[0];
    if (best) {
      console.log(
        `[find-local-siren] Phase 2 – gagnant: score=${best.score} SIRET=${best.candidate.siret} ${best.candidate.nom_complet}`
      );
    }
  }

  const bestEntry = scored[0];
  if (!bestEntry) return null;
  const { candidate: best, score: bestScore } = bestEntry;

  const result: FindLocalSirenResult = {
    siren: best.siren,
    siret: best.siret,
    nom_complet: best.nom_complet,
    adresse: best.adresse,
    code_postal: best.code_postal,
    score: bestScore,
  };

  if (options?.debug) {
    return { ...result, phase2Scoring };
  }
  return result;
}
