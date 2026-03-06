import Fuse from "fuse.js";
import { NextRequest, NextResponse } from "next/server";
import type { EnrichmentResult } from "@/lib/recherche-entreprises";

const API_GOUV_BASE = "https://recherche-entreprises.api.gouv.fr/search";

/** Un établissement dans matching_etablissements */
interface EtablissementMatch {
  liste_enseignes?: string[] | null;
}

/** Un établissement siège dans la réponse API */
interface SiegeApi {
  siret?: string;
  adresse?: string;
  geo_adresse?: string;
  code_postal?: string;
  latitude?: string;
  longitude?: string;
}

/** Un dirigeant personne physique */
interface DirigeantPersonnePhysique {
  nom?: string;
  prenoms?: string;
  qualite?: string;
  type_dirigeant?: string;
}

/** Un résultat entreprise dans la réponse API */
interface ResultatApi {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  siege?: SiegeApi;
  activite_principale?: string;
  dirigeants?: Array<DirigeantPersonnePhysique | { type_dirigeant?: string; denomination?: string }>;
  matching_etablissements?: EtablissementMatch[];
}

interface ResponseApiGouv {
  results?: ResultatApi[];
  total_results?: number;
}

function mapResultToEnrichment(result: ResultatApi): EnrichmentResult {
  const siege = result.siege;
  const firstDirigeantPhysique = result.dirigeants?.find(
    (d): d is DirigeantPersonnePhysique =>
      (d as { type_dirigeant?: string }).type_dirigeant === "personne physique" &&
      "nom" in d &&
      "prenoms" in d
  );
  const managerName = firstDirigeantPhysique
    ? [firstDirigeantPhysique.prenoms, firstDirigeantPhysique.nom].filter(Boolean).join(" ") +
      (firstDirigeantPhysique.qualite ? ` (${firstDirigeantPhysique.qualite})` : "")
    : undefined;

  return {
    siren: result.siren ?? undefined,
    siret: siege?.siret ?? undefined,
    companyLegalName: result.nom_complet ?? result.nom_raison_sociale ?? undefined,
    companyManagerName: managerName,
    companyAddress: siege?.geo_adresse ?? siege?.adresse ?? undefined,
    companyNaf: result.activite_principale ?? undefined,
  };
}

/** Construit un texte searchable pour Fuse : dénomination + enseignes */
function getSearchableText(r: ResultatApi): string {
  const parts = [r.nom_complet ?? "", r.nom_raison_sociale ?? ""];
  const enseignes =
    r.matching_etablissements?.flatMap((e) => e.liste_enseignes ?? []) ?? [];
  return [...parts, ...enseignes].filter(Boolean).join(" ");
}

/**
 * GET /api/recherche-entreprises?q=...&name=...
 * Proxie vers l'API recherche-entreprises (api.gouv.fr).
 * Si name est fourni, utilise Fuse.js pour retourner le résultat qui correspond au nom du POI.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    const poiName = searchParams.get("name")?.trim() || null;

    if (!q || typeof q !== "string" || q.trim().length === 0) {
      return NextResponse.json(
        { error: "Le paramètre de recherche 'q' est requis" },
        { status: 400 }
      );
    }

    const url = new URL(API_GOUV_BASE);
    url.searchParams.set("q", q.trim());

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

    let chosen: ResultatApi;
    if (poiName) {
      const list = results.map((r) => ({ r, search: getSearchableText(r) }));
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

    return NextResponse.json({ result: mapResultToEnrichment(chosen) });
  } catch (e) {
    console.error("[recherche-entreprises]", e);
    return NextResponse.json(
      { error: "Erreur serveur lors de la recherche" },
      { status: 500 }
    );
  }
}
