import { NextRequest, NextResponse } from "next/server";
import {
  findLocalSiren,
  buildLocalSirenQueries,
  type ApiResultCompany,
} from "@/lib/find-local-siren";

const API_GOUV_BASE = "https://recherche-entreprises.api.gouv.fr/search";

/**
 * GET /api/find-local-siren?poiName=...&address=...&lat=...&lon=...
 * Ou POST avec body { poiName, address, lat, lon }.
 *
 * 1–2 requêtes séquentielles vers api.gouv (per_page=20), arrêt dès résultats exploitables.
 * Scoring composite orienté adresse ; retour enrichissement + phase2Scoring.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const poiName = searchParams.get("poiName")?.trim() ?? "";
  const address = searchParams.get("address")?.trim() ?? "";
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lon = parseFloat(searchParams.get("lon") ?? "");
  if (!poiName || !address || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      {
        error:
          "Paramètres requis : poiName, address, lat, lon (nombres valides)",
      },
      { status: 400 }
    );
  }

  return runFindLocalSiren(poiName, address, lat, lon);
}

export async function POST(request: NextRequest) {
  let body: { poiName?: string; address?: string; lat?: number; lon?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body JSON invalide" },
      { status: 400 }
    );
  }

  const poiName = (body.poiName ?? "").toString().trim();
  const address = (body.address ?? "").toString().trim();
  const lat = typeof body.lat === "number" ? body.lat : parseFloat(String(body.lat));
  const lon = typeof body.lon === "number" ? body.lon : parseFloat(String(body.lon));
  if (!poiName || !address || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      {
        error:
          "Body requis : poiName, address, lat, lon (nombres valides)",
      },
      { status: 400 }
    );
  }

  return runFindLocalSiren(poiName, address, lat, lon);
}

async function runFindLocalSiren(
  poiName: string,
  address: string,
  lat: number,
  lon: number
) {
  try {
    const fetcher = async (
      q: string,
      perPage: number
    ): Promise<{ results?: ApiResultCompany[] }> => {
      const url = new URL(API_GOUV_BASE);
      url.searchParams.set("q", q);
      url.searchParams.set("per_page", String(perPage));

      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        next: { revalidate: 0 },
      });

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error("Limite API dépassée (429)");
        }
        return { results: [] };
      }

      const data = await res.json();
      return { results: data.results ?? [] };
    };

    const result = await findLocalSiren(poiName, address, lat, lon, fetcher);

    if (!result) {
      return NextResponse.json({
        result: null,
        enrichment: null,
        winningQuery: null,
        attemptedQueries: buildLocalSirenQueries(poiName, address),
        phase2Scoring: null,
      });
    }

    return NextResponse.json({
      result: {
        siren: result.siren,
        siret: result.siret,
        nom_complet: result.nom_complet,
        adresse: result.adresse,
        code_postal: result.code_postal,
        score: result.score,
        winningQuery: result.winningQuery,
      },
      enrichment: result.enrichment,
      winningQuery: result.winningQuery,
      attemptedQueries: buildLocalSirenQueries(poiName, address),
      phase2Scoring: result.phase2Scoring,
    });
  } catch (e) {
    console.error("[find-local-siren]", e);
    return NextResponse.json(
      { error: "Erreur serveur find-local-siren" },
      { status: 500 }
    );
  }
}
