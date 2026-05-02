import Fuse from "fuse.js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import {
  mapResultatApiToEnrichment,
  getSearchableTextFromResultat,
  type ResultatApiRechercheEntreprises,
} from "@/lib/api-gouv-enrichment-map";

const API_GOUV_BASE = "https://recherche-entreprises.api.gouv.fr/search";

const DEFAULT_PER_PAGE = 20;

interface ResponseApiGouv {
  results?: ResultatApiRechercheEntreprises[];
  total_results?: number;
}

/**
 * GET /api/recherche-entreprises?q=...&name=...&per_page=...
 * Proxie vers l'API recherche-entreprises (api.gouv.fr).
 * Si name est fourni, utilise Fuse.js pour retourner le résultat qui correspond au nom du POI.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    const poiName = searchParams.get("name")?.trim() || null;
    const perPageRaw = searchParams.get("per_page");
    const perPage = perPageRaw ? Math.min(100, Math.max(1, parseInt(perPageRaw, 10) || DEFAULT_PER_PAGE)) : DEFAULT_PER_PAGE;

    if (!q || typeof q !== "string" || q.trim().length === 0) {
      return NextResponse.json(
        { error: "Le paramètre de recherche 'q' est requis" },
        { status: 400 }
      );
    }

    const url = new URL(API_GOUV_BASE);
    url.searchParams.set("q", q.trim());
    url.searchParams.set("per_page", String(perPage));

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      if (res.status === 429) {
        return NextResponse.json(
          { error: "Trop de requêtes (limite API dépassée)" },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: "Erreur lors de la recherche d'entreprise" },
        { status: res.status }
      );
    }

    const data: ResponseApiGouv = await res.json();
    const results = data.results ?? [];

    if (results.length === 0) {
      return NextResponse.json({ result: null });
    }

    let chosen: ResultatApiRechercheEntreprises;
    if (poiName) {
      const list = results.map((r) => ({ r, search: getSearchableTextFromResultat(r) }));
      const fuse = new Fuse(list, {
        keys: ["search"],
        threshold: 0.4,
        includeScore: true,
      });
      const found = fuse.search(poiName);
      chosen = found.length > 0 ? found[0].item.r : results[0];
    } else {
      chosen = results[0];
    }

    const qTrim = q.trim();
    const preferSiret = /^\d{14}$/.test(qTrim) ? qTrim : undefined;
    return NextResponse.json({
      result: mapResultatApiToEnrichment(chosen, preferSiret ? { preferSiret } : undefined),
    });
  } catch (e) {
    console.error("[recherche-entreprises]", e);
    return NextResponse.json(
      { error: "Erreur serveur lors de la recherche" },
      { status: 500 }
    );
  }
}
