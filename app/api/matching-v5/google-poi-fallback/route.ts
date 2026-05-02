import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth-quota";
import { checkGooglePoiFallbackThrottle } from "@/lib/google-poi-fallback-throttle";
import {
  flattenApiResultsToCandidates,
  type ApiResultCompany,
} from "@/lib/find-local-siren";
import { mapResultatApiToEnrichment } from "@/lib/api-gouv-enrichment-map";
import { runGooglePoiFallback } from "@/lib/matching-v5-google-poi-fallback/run-google-poi-fallback";
import {
  buildPrioritizedSearchQueries,
  parseAddressSearchContext,
} from "@/lib/recherche-entreprises";
import type { RankedNearbyPlace } from "@/lib/matching-v5-google-poi-fallback/types";

export const dynamic = "force-dynamic";

const API_GOUV_BASE = "https://recherche-entreprises.api.gouv.fr/search";
const API_GOUV_PER_PAGE = 20;
const API_GOUV_RATE_LIMIT = "api_gouv_rate_limit";

/** Établissement (siège ou secondaire) actif au CP ciblé, sans scoring. */
export type EtablissementAtAddress = {
  siren: string;
  siret: string;
  nom_complet: string;
  adresse: string;
  code_postal: string;
  activite_principale?: string;
  tranche_effectif_salarie?: string;
  company_manager_name?: string;
};

function getGoogleMapsServerKey(): string | undefined {
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    undefined
  );
}

function serializeRanked(r: RankedNearbyPlace[]) {
  return r.map((x) => ({
    place_id: x.place_id,
    name: x.name,
    vicinity: x.vicinity,
    types: x.types,
    distanceM: Math.round(x.distanceM * 10) / 10,
    typeScore: Math.round(x.typeScore * 1000) / 1000,
    relevanceScore: Math.round(x.relevanceScore * 1000) / 1000,
    insideParcel: x.insideParcel,
  }));
}

function parseParcelGeometry(raw: unknown):
  | { ok: true; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }
  | { ok: false; error: string } {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, error: "parcelGeometry requis (Polygon ou MultiPolygon GeoJSON)." };
  }
  const o = raw as { type?: unknown; coordinates?: unknown };
  if (o.type === "Polygon" && Array.isArray(o.coordinates)) {
    return { ok: true, geometry: o as GeoJSON.Polygon };
  }
  if (o.type === "MultiPolygon" && Array.isArray(o.coordinates)) {
    return { ok: true, geometry: o as GeoJSON.MultiPolygon };
  }
  return { ok: false, error: "parcelGeometry invalide : attendu type Polygon ou MultiPolygon." };
}

async function fetchApiGouvByQuery(
  q: string
): Promise<{ ok: true; results: ApiResultCompany[] } | { ok: false; status: number; error: string }> {
  const url = new URL(API_GOUV_BASE);
  url.searchParams.set("q", q);
  url.searchParams.set("per_page", String(API_GOUV_PER_PAGE));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
  } catch {
    return { ok: false, status: 502, error: "Réseau indisponible (api.gouv)." };
  }

  if (!res.ok) {
    if (res.status === 429) {
      return { ok: false, status: 429, error: API_GOUV_RATE_LIMIT };
    }
    return { ok: false, status: res.status, error: `api.gouv HTTP ${res.status}` };
  }

  const data = (await res.json()) as { results?: ApiResultCompany[] };
  return { ok: true, results: data.results ?? [] };
}

function buildEtablissementsAtCp(
  apiResults: ApiResultCompany[],
  codePostal: string
): EtablissementAtAddress[] {
  const flat = flattenApiResultsToCandidates(apiResults);
  const cpTrim = codePostal.trim();
  return flat
    .filter((c) => (c.code_postal ?? "").trim() === cpTrim)
    .map((c) => {
      const st = (c.siret || "").trim();
      const mapped = mapResultatApiToEnrichment(
        c.sourceCompany,
        /^\d{14}$/.test(st) ? { preferSiret: st } : undefined
      );
      return {
        siren: c.siren,
        siret: c.siret,
        nom_complet: c.nom_complet,
        adresse: c.adresse,
        code_postal: c.code_postal,
        activite_principale: mapped.companyNaf ?? c.sourceCompany.activite_principale ?? undefined,
        tranche_effectif_salarie:
          mapped.companyTrancheEffectif ?? c.sourceCompany.tranche_effectif_salarie ?? undefined,
        company_manager_name: mapped.companyManagerName,
      };
    });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const apiKey = getGoogleMapsServerKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Clé Google manquante (GOOGLE_MAPS_API_KEY ou NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)." },
      { status: 500 }
    );
  }

  let body: { lat?: unknown; lng?: unknown; radiusM?: unknown; parcelGeometry?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const lat = typeof body.lat === "number" ? body.lat : Number(body.lat);
  const lng = typeof body.lng === "number" ? body.lng : Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat et lng numériques requis." }, { status: 400 });
  }

  const parcelParsed = parseParcelGeometry(body.parcelGeometry);
  if (!parcelParsed.ok) {
    return NextResponse.json({ error: parcelParsed.error }, { status: 400 });
  }

  const throttle = checkGooglePoiFallbackThrottle(auth.context.uid);
  if (!throttle.ok) {
    return NextResponse.json(
      {
        error: "Trop de requêtes. Attendez quelques secondes entre deux tests.",
        retryAfterSeconds: throttle.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(throttle.retryAfterSeconds) },
      }
    );
  }

  const radiusM =
    typeof body.radiusM === "number" && body.radiusM > 0 && body.radiusM <= 500
      ? body.radiusM
      : typeof body.radiusM === "number"
        ? Math.min(500, Math.max(20, body.radiusM))
        : undefined;

  const googleResult = await runGooglePoiFallback(lat, lng, {
    apiKey,
    radiusM,
    parcelGeometry: parcelParsed.geometry,
  });

  if (!googleResult.ok) {
    return NextResponse.json(
      {
        error: googleResult.message,
        step: googleResult.step,
        nearbyStatus: googleResult.nearbyStatus,
      },
      { status: googleResult.step === "config" ? 500 : 502 }
    );
  }

  const payload: Record<string, unknown> = {
    google: {
      centroid: googleResult.centroid,
      radiusM: googleResult.radiusM,
      nearbyStatus: googleResult.nearbyStatus,
      nearbyErrorMessage: googleResult.nearbyErrorMessage ?? null,
      rawNearbyCount: googleResult.rawNearbyCount,
      excludedOutsideParcel: googleResult.excludedOutsideParcel,
      ranked: serializeRanked(googleResult.ranked),
      winner: googleResult.winner ?? null,
      detailsStatus: googleResult.detailsStatus ?? null,
    },
  };

  const winner = googleResult.winner;
  const ranked = googleResult.ranked;

  if (ranked.length === 0) {
    payload.etablissementsAtAddress = {
      skipped: true,
      reason:
        googleResult.excludedOutsideParcel > 0
          ? `Aucun POI dans l’emprise parcelle (${googleResult.excludedOutsideParcel} hors polygone exclus).`
          : "Aucun POI dans le rayon après classement.",
    };
    return NextResponse.json(payload);
  }

  if (!winner) {
    payload.etablissementsAtAddress = {
      skipped: true,
      reason: "Place Details indisponible pour le POI retenu.",
    };
    return NextResponse.json(payload);
  }

  const anchorAddress =
    winner.formatted_address?.trim() || ranked[0]?.vicinity?.trim() || "";
  if (!anchorAddress) {
    payload.etablissementsAtAddress = {
      skipped: true,
      reason: "Aucune adresse d’ancrage (Place Details ni vicinity du 1er POI).",
    };
    return NextResponse.json(payload);
  }

  const ctx = parseAddressSearchContext(null, anchorAddress);
  if (!ctx.codePostal) {
    payload.etablissementsAtAddress = {
      skipped: true,
      anchorAddress,
      reason: "Aucun code postal extractible de l'adresse Place Details.",
    };
    return NextResponse.json(payload);
  }

  const queries = buildPrioritizedSearchQueries(ctx);
  const query =
    queries[0] ??
    [ctx.streetSegment, ctx.commune, ctx.codePostal].filter(Boolean).join(" ");

  if (!query) {
    payload.etablissementsAtAddress = {
      skipped: true,
      anchorAddress,
      codePostal: ctx.codePostal,
      reason: "Impossible de construire une requête api.gouv (rue/commune absentes).",
    };
    return NextResponse.json(payload);
  }

  const apiGouvRes = await fetchApiGouvByQuery(query);

  if (!apiGouvRes.ok) {
    payload.etablissementsAtAddress = {
      skipped: true,
      anchorAddress,
      codePostal: ctx.codePostal,
      query,
      reason:
        apiGouvRes.error === API_GOUV_RATE_LIMIT
          ? "Trop de requêtes (api.gouv)."
          : apiGouvRes.error,
      status: apiGouvRes.status,
    };
    return NextResponse.json(payload);
  }

  const etablissements = buildEtablissementsAtCp(apiGouvRes.results, ctx.codePostal);

  payload.etablissementsAtAddress = {
    anchorAddress,
    codePostal: ctx.codePostal,
    query,
    totalApiResults: apiGouvRes.results.length,
    etablissements,
  };

  return NextResponse.json(payload);
}
