const INSEE_RE = /^\d{5}$/;

/**
 * Interprète `codeInsee` dans l’URL (virgules et/ou paramètres répétés).
 * - `null` : aucun filtre INSEE → toutes les lignes de `scout_leads_enriched` (déjà limitées aux communes présentes dans `scout_leads_communes`).
 * - `string[]` : sous-ensemble demandé (dédoublonné, ordre conservé).
 */
export function parseOptionalCodeInseeListFromSearchParams(
  searchParams: URLSearchParams
): string[] | null {
  const repeated = searchParams.getAll("codeInsee").flatMap((raw) => raw.split(","));
  const single = searchParams.get("codeInsee");
  const tokens = repeated.length > 0 ? repeated : single ? single.split(",") : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const s = t.trim();
    if (!INSEE_RE.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length > 0 ? out : null;
}
