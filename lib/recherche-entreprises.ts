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

/** Contexte parsé depuis l'adresse pour les requêtes api.gouv */
export interface AddressSearchContext {
  name: string | null;
  commune: string | null;
  codePostal: string | null;
  streetSegment: string | null;
  zacSegment: string | null;
}

/**
 * Parse nom + adresse pour construire les requêtes (partagé avec find-local-siren).
 */
export function parseAddressSearchContext(
  name: string | null | undefined,
  address: string | null | undefined
): AddressSearchContext {
  const n = name?.trim() || null;
  const addressStr = address?.trim() || "";
  const codePostal = addressStr ? extractCodePostal(addressStr) : null;
  const segments = addressStr ? addressStr.split(",").map((s) => s.trim()).filter(Boolean) : [];

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

  return { name: n, commune, codePostal, streetSegment, zacSegment };
}

/**
 * Liste courte priorisée (adresse d'abord, puis nom) — au plus quelques entrées.
 * Ordre : RUE+commune+CP → NOM+commune+CP → NOM+commune → ZAC+commune.
 */
export function buildPrioritizedSearchQueries(ctx: AddressSearchContext): string[] {
  const { name, commune, codePostal, streetSegment, zacSegment } = ctx;
  const steps: string[] = [];

  if (streetSegment && commune && codePostal) {
    steps.push(`"${streetSegment}" ${commune} ${codePostal}`);
  }
  if (name && commune && codePostal) {
    steps.push(`"${name}" ${commune} ${codePostal}`);
  }
  if (name && commune) {
    steps.push(`"${name}" ${commune}`);
  }
  if (zacSegment && commune) {
    steps.push(`"${zacSegment}" ${commune}`);
  }

  return steps;
}

/**
 * @deprecated Utiliser buildPrioritizedSearchQueries(parseAddressSearchContext(...))
 */
export function buildSearchQuerySteps(prospect: Prospect): string[] {
  return buildPrioritizedSearchQueries(
    parseAddressSearchContext(prospect.name, prospect.address)
  );
}

/**
 * Une requête simple (compatibilité affichage "pour test") : premier step non vide.
 */
export function buildSearchQuery(prospect: Prospect): string {
  const steps = buildPrioritizedSearchQueries(
    parseAddressSearchContext(prospect.name, prospect.address)
  );
  return steps[0] ?? prospect.name?.trim() ?? prospect.address?.trim() ?? "";
}

const API_GOUV_SEARCH_BASE = "https://recherche-entreprises.api.gouv.fr/search";

/** URL api.gouv directe pour une requête q (pour affichage "qui a trouvé le résultat"). */
export function buildApiGouvSearchUrl(q: string): string {
  return `${API_GOUV_SEARCH_BASE}?q=${encodeURIComponent(q)}`;
}

const DEFAULT_PER_PAGE = "20";

/** Appel interne : un seul GET avec q (et optionnellement name pour Fuse côté route). */
async function fetchStep(
  q: string,
  poiName: string | null
): Promise<EnrichmentResult | null> {
  const params = new URLSearchParams({ q });
  if (poiName) params.set("name", poiName);
  params.set("per_page", DEFAULT_PER_PAGE);
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
 * Appelle la route API en suivant la liste prioritaire (au plus 2–4 tentatives,
 * s’arrête au premier résultat).
 */
export async function fetchCompanyEnrichment(
  prospect: Prospect
): Promise<FetchCompanyEnrichmentResult> {
  const steps = buildPrioritizedSearchQueries(
    parseAddressSearchContext(prospect.name, prospect.address)
  );
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
