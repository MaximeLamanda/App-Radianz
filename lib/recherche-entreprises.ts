import Fuse from "fuse.js";
import type { Prospect } from "@/types";

/** Résultat d'enrichissement entreprise (api.gouv) pour un prospect */
export interface EnrichmentResult {
  siren?: string;
  siret?: string;
  companyLegalName?: string;
  companyManagerName?: string;
  companyAddress?: string;
  companyNaf?: string;
  companyPhone?: string;
}

/**
 * Extrait le code postal (5 chiffres) d'une adresse française.
 */
export function extractCodePostal(address: string): string | null {
  const match = address.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

/** Contexte parsé depuis l'adresse du prospect pour construire les requêtes */
function parseAddressContext(prospect: Prospect): {
  name: string | null;
  commune: string | null;
  codePostal: string | null;
  streetSegment: string | null;
  zacSegment: string | null;
} {
  const name = prospect.name?.trim() || null;
  const address = prospect.address?.trim() || "";
  const codePostal = address ? extractCodePostal(address) : null;
  const segments = address ? address.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const segmentWithCp = codePostal ? segments.find((s) => s.includes(codePostal)) : null;
  const commune = segmentWithCp
    ? segmentWithCp.replace(/\d{5}\s*/, "").trim() || null
    : null;

  const cpIndex = segmentWithCp ? segments.findIndex((s) => s.includes(codePostal!)) : -1;
  const streetSegment = cpIndex > 0 ? segments[cpIndex - 1] : null;

  const segmentWithZac = segments.find((s) => /zac\s/i.test(s));
  const zacSegment = segmentWithZac
    ? segmentWithZac.replace(/\bde\s+/i, " ").trim()
    : null;

  return { name, commune, codePostal, streetSegment, zacSegment };
}

/**
 * Stratégie en 4 étapes (ordre de fallback) :
 * 1. NOM + VILLE/CP     "La Halle" Langueux 22360
 * 2. NOM + VILLE        "La Halle" Langueux
 * 3. RUE + VILLE/CP     "6 Rue Freyssinet" Langueux 22360
 * 4. ZAC + VILLE        "Zac Douvenant" Langueux
 */
export function buildSearchQuerySteps(prospect: Prospect): string[] {
  const { name, commune, codePostal, streetSegment, zacSegment } = parseAddressContext(prospect);
  const steps: string[] = [];

  if (name && commune && codePostal) {
    steps.push(`"${name}" ${commune} ${codePostal}`);
  }
  if (name && commune) {
    steps.push(`"${name}" ${commune}`);
  }
  if (streetSegment && commune && codePostal) {
    steps.push(`"${streetSegment}" ${commune} ${codePostal}`);
  }
  if (zacSegment && commune) {
    steps.push(`"${zacSegment}" ${commune}`);
  }

  return steps;
}

/**
 * Une requête simple (compatibilité affichage "pour test") : premier step non vide.
 */
export function buildSearchQuery(prospect: Prospect): string {
  const steps = buildSearchQuerySteps(prospect);
  return steps[0] ?? prospect.name?.trim() ?? prospect.address?.trim() ?? "";
}

const API_GOUV_SEARCH_BASE = "https://recherche-entreprises.api.gouv.fr/search";

/** URL api.gouv directe pour une requête q (pour affichage "qui a trouvé le résultat"). */
export function buildApiGouvSearchUrl(q: string): string {
  return `${API_GOUV_SEARCH_BASE}?q=${encodeURIComponent(q)}`;
}

/** Appel interne : un seul GET avec q (et optionnellement name pour Fuse côté route). */
async function fetchStep(
  q: string,
  poiName: string | null
): Promise<EnrichmentResult | null> {
  const params = new URLSearchParams({ q });
  if (poiName) params.set("name", poiName);
  const res = await fetch(`/api/recherche-entreprises?${params.toString()}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.result ?? null;
}

export interface FetchCompanyEnrichmentResult {
  enrichment: EnrichmentResult | null;
  /** Requête q qui a trouvé le résultat (pour construire l’URL api.gouv directe). */
  winningQuery: string | null;
}

/**
 * Appelle la route API en 4 étapes (NOM+CP, NOM, RUE+CP, ZAC+ville).
 * À chaque étape, la route utilise Fuse.js pour choisir le résultat qui correspond au nom du POI.
 * Retourne l’enrichissement et la requête gagnante (pour afficher l’URL api.gouv directe).
 */
export async function fetchCompanyEnrichment(
  prospect: Prospect
): Promise<FetchCompanyEnrichmentResult> {
  const steps = buildSearchQuerySteps(prospect);
  const poiName = prospect.name?.trim() || null;

  for (const q of steps) {
    if (!q) continue;
    const result = await fetchStep(q, poiName);
    if (result) {
      return { enrichment: result, winningQuery: q };
    }
  }

  return { enrichment: null, winningQuery: null };
}
