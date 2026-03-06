import { NextRequest, NextResponse } from "next/server";
import {
  findLocalSiren,
  buildLocalSirenQueries,
  type ApiResultCompany,
  type ScoredCandidate,
} from "@/lib/find-local-siren";

const API_GOUV_BASE = "https://recherche-entreprises.api.gouv.fr/search";

/**
 * GET /api/find-local-siren?poiName=...&address=...&lat=...&lon=...
 * Ou POST avec body { poiName, address, lat, lon }.
 *
 * PHASE 1 : 4 requêtes parallèles vers api.gouv (per_page=20).
 * PHASE 2 : scoring composite (fuzzy nom 40%, rue 30%, CP 20%, distance 10%).
 * Retourne l'établissement LOCAL le plus pertinent (score 0–1000) ou null.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const poiName = searchParams.get("poiName")?.trim() ?? "";
  const address = searchParams.get("address")?.trim() ?? "";
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lon = parseFloat(searchParams.get("lon") ?? "");
  const debug = searchParams.get("debug") === "1" || searchParams.get("debug") === "true";

  if (!poiName || !address || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      {
        error:
          "Paramètres requis : poiName, address, lat, lon (nombres valides)",
      },
      { status: 400 }
    );
  }

  return runFindLocalSiren(poiName, address, lat, lon, debug);
}

export async function POST(request: NextRequest) {
  let body: { poiName?: string; address?: string; lat?: number; lon?: number; debug?: boolean | string };
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
  const debug = body.debug === true || body.debug === "1";

  if (!poiName || !address || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      {
        error:
          "Body requis : poiName, address, lat, lon (nombres valides)",
      },
      { status: 400 }
    );
  }

  return runFindLocalSiren(poiName, address, lat, lon, debug);
}

async function runFindLocalSiren(
  poiName: string,
  address: string,
  lat: number,
  lon: number,
  debug = false
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

    const result = await findLocalSiren(poiName, address, lat, lon, fetcher, { debug });

    if (!result) {
      return NextResponse.json({ result: null });
    }

    const response: {
      result: {
        siren: string;
        siret: string;
        nom_complet: string;
        adresse: string;
        code_postal: string;
        score: number;
      };
      winningQueries: string[];
      phase2Scoring?: ScoredCandidate[];
    } = {
      result: {
        siren: result.siren,
        siret: result.siret,
        nom_complet: result.nom_complet,
        adresse: result.adresse,
        code_postal: result.code_postal,
        score: result.score,
      },
      winningQueries: buildLocalSirenQueries(poiName, address),
    };
    if ("phase2Scoring" in result && result.phase2Scoring) {
      response.phase2Scoring = result.phase2Scoring;
    }
    return NextResponse.json(response);
  } catch (e) {
    console.error("[find-local-siren]", e);
    return NextResponse.json(
      { error: "Erreur serveur find-local-siren" },
      { status: 500 }
    );
  }
}
