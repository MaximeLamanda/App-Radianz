/**
 * Helpers pour Apollo people search par domaine.
 *
 * Endpoint cible : POST https://api.apollo.io/v1/mixed_people/search
 * Auth : header `X-Api-Key: <APOLLO_API_KEY>`.
 *
 * Cibles métier (prospection solaire B2B) : décisionnaires C-level
 * + responsables techniques/bâtiment (facility, énergie, maintenance).
 */

import type { ProspectContact } from "@/types";

/** Nombre maximum de contacts retournés par appel (limite Apollo). */
export const APOLLO_PEOPLE_PER_PAGE = 10;

/**
 * Niveaux de séniorité Apollo ciblés.
 *
 * Liste exacte issue du champ `person_seniorities` accepté par Apollo
 * (https://docs.apollo.io/reference/people-search).
 */
export const APOLLO_TARGET_SENIORITIES = [
  "owner",
  "founder",
  "c_suite",
  "partner",
  "vp",
  "head",
  "director",
  "manager",
] as const;

/**
 * Intitulés ciblés (FR + EN) pour cibler décisionnaires bâtiment / énergie / direction.
 *
 * Utilisé via `person_titles` (match libre côté Apollo, OR logique).
 */
export const APOLLO_TARGET_TITLES = [
  "CEO",
  "Chief Executive Officer",
  "President",
  "Président",
  "Directeur Général",
  "DG",
  "Founder",
  "Fondateur",
  "Owner",
  "Propriétaire",
  "COO",
  "Chief Operating Officer",
  "Directeur Technique",
  "CTO",
  "Facility Manager",
  "Responsable Maintenance",
  "Responsable Bâtiment",
  "Responsable Technique",
  "Energy Manager",
  "Responsable Énergie",
  "Property Manager",
  "Real Estate Manager",
  "Asset Manager",
] as const;

/**
 * Extrait un domaine canonique depuis une URL ou un domaine brut.
 *
 * - Strip protocole, "www.", path, query, port.
 * - Lowercase.
 * - Retourne `null` pour les URLs invalides ou TLD absent.
 */
export function extractDomainFromWebsite(input: string | undefined | null): string | null {
  if (input == null) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;

  // Cas 1 : URL valide (avec ou sans protocole) → on tente URL.
  let host: string | null = null;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(candidate);
    host = u.hostname;
  } catch {
    host = null;
  }

  if (!host) {
    // Cas 2 : tentative manuelle si URL a échoué (ex. "ACME.fr/contact" sans schéma).
    const manual = trimmed
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .split(/[/?#]/)[0]
      ?.split(":")[0];
    if (!manual) return null;
    host = manual;
  }

  host = host.toLowerCase().trim();
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host) return null;
  // Doit contenir au moins un point pour être un domaine valide.
  if (!host.includes(".")) return null;
  // Sanity : pas d'espaces, longueur raisonnable, caractères ASCII (IDN tolérés via xn--).
  if (/\s/.test(host)) return null;
  if (host.length > 253) return null;
  return host;
}

/**
 * Construit le body POST pour `/v1/mixed_people/search` ciblé sur un domaine.
 *
 * On passe à la fois `q_organization_domains` (string séparé par retours ligne selon Apollo)
 * et les filtres séniorités/titles pour resserrer sur les décisionnaires.
 */
export function buildApolloSearchBody(params: {
  domain: string;
  perPage?: number;
}): Record<string, unknown> {
  const perPage = Math.max(1, Math.min(APOLLO_PEOPLE_PER_PAGE, params.perPage ?? APOLLO_PEOPLE_PER_PAGE));
  return {
    q_organization_domains: params.domain,
    person_seniorities: [...APOLLO_TARGET_SENIORITIES],
    person_titles: [...APOLLO_TARGET_TITLES],
    page: 1,
    per_page: perPage,
  };
}

/** Champ utile (non strictement typé) renvoyé par Apollo dans `data.people[]`. */
type ApolloPersonRaw = {
  id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  name?: unknown;
  title?: unknown;
  email?: unknown;
  email_status?: unknown;
  linkedin_url?: unknown;
  phone_numbers?: unknown;
  organization?: { name?: unknown; primary_domain?: unknown; website_url?: unknown } | null | undefined;
  organization_name?: unknown;
};

function toStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function pickPhone(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return undefined;
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const o = entry as { sanitized_number?: unknown; raw_number?: unknown };
      const phone = toStr(o.sanitized_number) ?? toStr(o.raw_number);
      if (phone) return phone;
    } else if (typeof entry === "string") {
      const phone = toStr(entry);
      if (phone) return phone;
    }
  }
  return undefined;
}

function normalizeEmailStatus(raw: unknown): ProspectContact["emailStatus"] {
  const s = toStr(raw)?.toLowerCase();
  if (!s) return undefined;
  if (s === "verified" || s === "valid") return "verified";
  if (s === "guessed" || s === "likely") return "guessed";
  if (s === "unverified" || s === "unavailable" || s === "extrapolated") return "unverified";
  return undefined;
}

/**
 * Parse une personne Apollo en `ProspectContact` normalisé.
 *
 * Retourne `null` si pas de nom exploitable.
 */
export function parseApolloPerson(raw: unknown): ProspectContact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as ApolloPersonRaw;
  const firstName = toStr(r.first_name);
  const lastName = toStr(r.last_name);
  const composed = [firstName, lastName].filter(Boolean).join(" ").trim();
  const fullName = composed || toStr(r.name);
  if (!fullName) return null;

  const orgName = toStr(r.organization?.name) ?? toStr(r.organization_name);
  const orgDomain =
    toStr(r.organization?.primary_domain) ??
    extractDomainFromWebsite(toStr(r.organization?.website_url) ?? undefined) ??
    undefined;

  return {
    id: toStr(r.id),
    firstName,
    lastName,
    fullName,
    title: toStr(r.title),
    email: toStr(r.email),
    emailStatus: normalizeEmailStatus(r.email_status),
    linkedinUrl: toStr(r.linkedin_url),
    phone: pickPhone(r.phone_numbers),
    source: "apollo",
    fetchedAt: new Date(),
    organizationName: orgName,
    organizationDomain: orgDomain,
  };
}

/**
 * Clé de déduplication pour fusionner contacts d'appels successifs.
 *
 * Ordre de priorité : `id` Apollo → `email` lowercase → `linkedinUrl` → `fullName + title`.
 */
export function prospectContactDedupeKey(c: ProspectContact): string {
  if (c.id) return `id:${c.id}`;
  if (c.email) return `email:${c.email.toLowerCase()}`;
  if (c.linkedinUrl) return `li:${c.linkedinUrl.toLowerCase()}`;
  return `name:${c.fullName.toLowerCase()}|${(c.title ?? "").toLowerCase()}`;
}

/**
 * Fusionne deux listes de contacts en gardant l'ordre des nouveaux d'abord.
 *
 * Les nouveaux remplacent les anciens à clé de déduplication identique.
 */
export function mergeProspectContacts(
  existing: ProspectContact[] | undefined,
  incoming: ProspectContact[]
): ProspectContact[] {
  const out: ProspectContact[] = [];
  const seen = new Set<string>();
  for (const c of [...incoming, ...(existing ?? [])]) {
    const key = prospectContactDedupeKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
