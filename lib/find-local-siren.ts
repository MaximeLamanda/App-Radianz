/**
 * findLocalSiren – matching établissement LOCAL vs sièges nationaux (API recherche-entreprises).
 * Stratégie : 1–2 requêtes séquentielles (priorité rue+CP) → scoring composite (adresse d'abord).
 */

import Fuse from "fuse.js";
import {
  mapResultatApiToEnrichment,
  type ResultatApiRechercheEntreprises,
} from "@/lib/api-gouv-enrichment-map";
import type { EnrichmentResult } from "./recherche-entreprises";
import { buildPrioritizedSearchQueries, parseAddressSearchContext } from "./recherche-entreprises";

/** Contexte parsé depuis l'adresse */
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
  /** Entrée API source (pour enrichissement prospect). */
  sourceCompany: ResultatApiRechercheEntreprises;
}

/** Résultat retourné par findLocalSiren */
export interface FindLocalSirenResult {
  siren: string;
  siret: string;
  nom_complet: string;
  adresse: string;
  code_postal: string;
  score: number; // 0-1000
  /** Requête q api.gouv qui a fourni les résultats retenus. */
  winningQuery: string | null;
}

/** Un candidat scoré (pour debug / logs) */
export interface ScoredCandidate {
  rank: number;
  score: number;
  siren: string;
  siret: string;
  nom_complet: string;
  company_manager_name?: string;
  code_postal: string;
  adresse: string;
  /** Code NAF (ex. 20.14Z) */
  activite_principale?: string;
  /** Tranche d'effectif (code INSEE, ex. 03) */
  tranche_effectif_salarie?: string;
  /** true si le SIREN est présent dans parcelles_personnes_morales pour cette commune */
  cadastre_match?: boolean;
}

const PER_PAGE = 20;
const DISTANCE_KM_THRESHOLD = 1;
const EARTH_RADIUS_KM = 6371;

/** Pondérations sur 1000 : priorité adresse déclarée vs fuzzy nom. */
const WEIGHT_NOM = 250;
const WEIGHT_RUE = 380;
const WEIGHT_CP = 270;
const WEIGHT_DIST = 100;

/** Partie nom minimale si un token POI discriminant matche la raison sociale + ancrage adresse. */
const TOKEN_MATCH_NOM_FLOOR = 0.92;

/**
 * Mots retirés du nom POI avant bonus token — réduit les faux positifs (ex. « service » → tout « … SERVICES »).
 */
const POI_TOKEN_STOPWORDS = new Set([
  "le",
  "la",
  "les",
  "de",
  "du",
  "des",
  "et",
  "au",
  "aux",
  "the",
  "and",
  "chez",
  "societe",
  "service",
  "services",
  "business",
  "solutions",
  "consulting",
  "ingenierie",
  "technologies",
  "technology",
  "international",
  "france",
  "europe",
  "groupe",
  "holding",
  "global",
  "digital",
]);

/** Tokens encore trop génériques si présents après filtre (sécurité). */
const TOKEN_BLACKLIST = new Set([
  "service",
  "services",
  "international",
  "france",
  "europe",
  "holding",
  "groupe",
  "business",
  "solutions",
  "consulting",
  "technologies",
  "technology",
  "global",
  "digital",
]);

/** Suffixes de forme juridique FR en fin de libellé POI (ordre : plus long d’abord). */
const FRENCH_LEGAL_FORM_SUFFIXES = [
  "selarl",
  "selas",
  "sasu",
  "sarl",
  "sas",
  "eurl",
  "scop",
  "snc",
  "sci",
  "gie",
  "sa",
] as const;

/**
 * Parse l'adresse pour extraire ville, CP et rue (segment avant "ville CP").
 */
export function parseAddressForLocalSiren(address: string): ParsedAddress {
  const ctx = parseAddressSearchContext(null, address);
  return { ville: ctx.commune, codePostal: ctx.codePostal, rue: ctx.streetSegment };
}

/**
 * Liste des requêtes prioritaires (alignée sur buildPrioritizedSearchQueries).
 */
export function buildLocalSirenQueries(poiName: string, address: string): string[] {
  return buildPrioritizedSearchQueries(parseAddressSearchContext(poiName, address));
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

export function normalizeForMatch(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Unifie les abréviations de voie FR courantes (chaîne déjà accent-insensible).
 */
export function expandStreetAbbreviations(normalizedLower: string): string {
  let s = normalizedLower;
  const rules: [RegExp, string][] = [
    [/\bimp\.\s*/g, "impasse "],
    [/\bpl\.\s*/g, "place "],
    [/\bch\.\s*/g, "chemin "],
    [/\bav\.\s*/g, "avenue "],
    [/\bave\b/g, "avenue"],
    [/\bbd\b/g, "boulevard"],
    [/\bboul\b/g, "boulevard"],
    [/\brte\b/g, "route"],
  ];
  for (const [re, rep] of rules) {
    s = s.replace(re, rep);
  }
  return s.replace(/\s+/g, " ").trim();
}

function normalizeStreetLineForMatch(line: string): string {
  return expandStreetAbbreviations(normalizeForMatch(line));
}

function escapeRegexToken(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Retire les formes juridiques courantes en fin de chaîne (entrée déjà normalisée, sans accents).
 */
export function stripFrenchLegalFormsForPoi(normalizedLower: string): string {
  let s = normalizedLower.trim();
  let prev = "";
  while (s !== prev) {
    prev = s;
    for (const suf of FRENCH_LEGAL_FORM_SUFFIXES) {
      const re = new RegExp(`(?:\\s*[-–,]\\s*|\\s+)${suf}\\.?\\s*$`, "i");
      s = s.replace(re, "").trim();
    }
    s = s.replace(/\s+s\.?\s*a\.?\s*$/i, "").trim();
  }
  return s.replace(/\s+/g, " ").trim();
}

/** Vrai si `token` apparaît comme mot entier dans `nomNormalized` (déjà lower + sans accents). */
export function nomContainsTokenAsWholeWord(
  nomNormalized: string,
  token: string
): boolean {
  if (!token || !/^[a-z0-9]+$/.test(token)) return false;
  const re = new RegExp(`\\b${escapeRegexToken(token)}\\b`, "i");
  return re.test(nomNormalized);
}

export function extractPoiTokensForMatch(
  poiName: string,
  communeNormalized: string | null
): string[] {
  const n = stripFrenchLegalFormsForPoi(normalizeForMatch(poiName));
  const commune = communeNormalized ? normalizeForMatch(communeNormalized) : "";
  const raw = n.split(/[^a-z0-9]+/).filter(Boolean);
  return raw.filter(
    (t) =>
      t.length >= 4 &&
      !POI_TOKEN_STOPWORDS.has(t) &&
      (!commune || t !== commune)
  );
}

export function hasDiscriminatingTokenInNom(
  poiName: string,
  nomComplet: string,
  communeNormalized: string | null
): boolean {
  const nomNorm = normalizeForMatch(nomComplet);
  const tokens = extractPoiTokensForMatch(poiName, communeNormalized);
  const matching = tokens.filter((t) => nomContainsTokenAsWholeWord(nomNorm, t));
  const nonBlacklisted = matching.filter((t) => !TOKEN_BLACKLIST.has(t));
  return nonBlacklisted.length > 0;
}

export interface ScoreCandidateOptions {
  /** Commune (segment adresse) : exclue des tokens POI pour éviter « Pessac » comme signal. */
  commune?: string | null;
}

/**
 * Score composite 0–1000 :
 * ~25% fuzzy_nom (Fuse, chaînes normalisées) + bonus token sous ancrage adresse,
 * ~38% rue (abréviations voie), ~27% CP, ~10% distance &lt; 1 km.
 */
export function scoreCandidate(
  poiName: string,
  poiRue: string | null,
  poiCP: string | null,
  poiLat: number,
  poiLon: number,
  candidate: LocalSirenCandidate,
  options?: ScoreCandidateOptions
): number {
  const communeNorm = options?.commune ?? null;

  let partRue = 0;
  if (poiRue && candidate.adresse) {
    const a = normalizeStreetLineForMatch(poiRue);
    const b = normalizeStreetLineForMatch(candidate.adresse);
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

  const addressAnchored = partRue === 1 || (partCP === 1 && partDist === 1);

  const nomNorm = normalizeForMatch(candidate.nom_complet);
  const poiNorm = normalizeForMatch(poiName.trim());
  let partFuse = 0;
  const fuseOne = new Fuse([{ nom: nomNorm }], {
    keys: ["nom"],
    threshold: 0.6,
    includeScore: true,
  });
  const nomSearch = fuseOne.search(poiNorm);
  if (nomSearch.length > 0 && nomSearch[0].score != null) {
    partFuse = Math.max(0, 1 - nomSearch[0].score);
  }

  const tokenBoost =
    addressAnchored &&
    hasDiscriminatingTokenInNom(poiName, candidate.nom_complet, communeNorm);
  const partNom = tokenBoost ? Math.max(partFuse, TOKEN_MATCH_NOM_FLOOR) : partFuse;

  return (
    Math.round(WEIGHT_NOM * partNom) +
    Math.round(WEIGHT_RUE * partRue) +
    Math.round(WEIGHT_CP * partCP) +
    Math.round(WEIGHT_DIST * partDist)
  );
}

/** Structure minimale d'un établissement pour aplatissement */
export interface ApiEtablissement {
  adresse?: string;
  geo_adresse?: string;
  code_postal?: string;
  latitude?: string;
  longitude?: string;
  siret?: string;
}

export type ApiResultCompany = ResultatApiRechercheEntreprises;

/**
 * Aplatit les résultats API (entreprises) en liste de candidats (un par siège + un par établissement).
 */
export function flattenApiResultsToCandidates(
  results: ApiResultCompany[]
): LocalSirenCandidate[] {
  const candidates: LocalSirenCandidate[] = [];
  const seen = new Set<string>();

  for (const company of results) {
    // Exclure les sociétés inactives (etat_administratif = "C" = Cessé, ou autre valeur non-"A")
    if (company.etat_administratif && company.etat_administratif !== "A") continue;

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
          sourceCompany: company,
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
          sourceCompany: company,
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

/** Raison sociale / dirigeants depuis l’entrée API, SIRET et adresse depuis l’établissement local retenu. */
export function buildEnrichmentFromLocalMatch(
  company: ResultatApiRechercheEntreprises,
  local: LocalSirenCandidate
): EnrichmentResult {
  const st = (local.siret || "").trim();
  const base = mapResultatApiToEnrichment(company, /^\d{14}$/.test(st) ? { preferSiret: st } : undefined);
  return {
    ...base,
    siret: local.siret || base.siret,
    companyAddress: local.adresse || base.companyAddress,
  };
}

/**
 * Trouve l'établissement LOCAL le plus pertinent (score 0–1000).
 * Phase données : 1–2 requêtes séquentielles (per_page=20), arrêt dès qu’il existe des candidats.
 * Phase scoring : fuzzy nom, rue, CP, distance (pondération orientée adresse).
 */
export async function findLocalSiren(
  poiName: string,
  address: string,
  lat: number,
  lon: number,
  fetcher: (q: string, perPage: number) => Promise<{ results?: ApiResultCompany[] }>
): Promise<
  | (FindLocalSirenResult & {
      phase2Scoring: ScoredCandidate[];
      enrichment: EnrichmentResult;
    })
  | null
> {
  const parsed = parseAddressForLocalSiren(address);
  const queries = buildLocalSirenQueries(poiName, address);
  if (queries.length === 0) return null;

  const allResults: ApiResultCompany[] = [];
  let winningQuery: string | null = null;
  let lastQueryWithApiHits: string | null = null;

  for (const q of queries) {
    if (!q) continue;
    const data = await fetcher(q, PER_PAGE);
    const list = data.results ?? [];
    if (list.length > 0) lastQueryWithApiHits = q;
    allResults.push(...list);

    const candidatesSoFar = flattenApiResultsToCandidates(allResults);
    if (candidatesSoFar.length > 0) {
      winningQuery = q;
      break;
    }
  }

  const candidates = flattenApiResultsToCandidates(allResults);
  if (candidates.length === 0) return null;

  const effectiveWinningQuery = winningQuery ?? lastQueryWithApiHits;

  const scored = candidates.map((c) => {
    const s = scoreCandidate(
      poiName,
      parsed.rue,
      parsed.codePostal,
      lat,
      lon,
      c,
      { commune: parsed.ville }
    );
    return { candidate: c, score: s };
  });

  scored.sort((a, b) => b.score - a.score);

  const phase2Scoring: ScoredCandidate[] = scored.map(({ candidate, score }, i) => {
    const st = (candidate.siret || "").trim();
    const mapped = mapResultatApiToEnrichment(
      candidate.sourceCompany,
      /^\d{14}$/.test(st) ? { preferSiret: st } : undefined
    );
    return {
      rank: i + 1,
      score,
      siren: candidate.siren,
      siret: candidate.siret,
      nom_complet: candidate.nom_complet,
      company_manager_name: mapped.companyManagerName,
      code_postal: candidate.code_postal,
      adresse: candidate.adresse,
      activite_principale: candidate.sourceCompany.activite_principale ?? undefined,
      tranche_effectif_salarie: candidate.sourceCompany.tranche_effectif_salarie ?? undefined,
    };
  });

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

  const enrichment = buildEnrichmentFromLocalMatch(best.sourceCompany, best);

  const result: FindLocalSirenResult = {
    siren: best.siren,
    siret: best.siret,
    nom_complet: best.nom_complet,
    adresse: best.adresse,
    code_postal: best.code_postal,
    score: bestScore,
    winningQuery: effectiveWinningQuery,
  };

  return { ...result, phase2Scoring, enrichment };
}
