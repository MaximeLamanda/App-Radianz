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
const API_GOUV_MIN_INTERVAL_MS = 220;
const API_GOUV_MAX_RETRIES = 3;
const API_GOUV_RETRY_BASE_MS = 450;
const API_GOUV_REQUEST_TIMEOUT_MS = 10_000;
let lastApiGouvCallAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader) return null;
  const trimmed = retryAfterHeader.trim();
  const secs = Number(trimmed);
  if (Number.isFinite(secs) && secs > 0) return Math.ceil(secs * 1000);
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : null;
  }
  return null;
}

function getFetchErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === "string" && maybeCode.length > 0) {
    return maybeCode;
  }
  const maybeCauseCode = (error as { cause?: { code?: unknown } }).cause?.code;
  return typeof maybeCauseCode === "string" && maybeCauseCode.length > 0
    ? maybeCauseCode
    : null;
}

function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  const retryableCodes = new Set([
    "ECONNREFUSED",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "ECONNRESET",
    "EAI_AGAIN",
    "ENOTFOUND",
  ]);
  const code = getFetchErrorCode(error);
  return code ? retryableCodes.has(code) : false;
}

async function fetchApiGouvWithRetry(url: string): Promise<Response> {
  let attempt = 0;
  while (true) {
    const now = Date.now();
    const sinceLast = now - lastApiGouvCallAt;
    if (sinceLast < API_GOUV_MIN_INTERVAL_MS) {
      await sleep(API_GOUV_MIN_INTERVAL_MS - sinceLast);
    }

    lastApiGouvCallAt = Date.now();
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, API_GOUV_REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        next: { revalidate: 0 },
        signal: abortController.signal,
      });

      if (
        (res.status === 429 || res.status >= 500) &&
        attempt < API_GOUV_MAX_RETRIES
      ) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
        const jitterMs = Math.floor(Math.random() * 200);
        const backoffMs = API_GOUV_RETRY_BASE_MS * 2 ** attempt + jitterMs;
        await sleep(retryAfterMs ?? backoffMs);
        attempt += 1;
        continue;
      }

      return res;
    } catch (error) {
      const canRetry = isRetryableNetworkError(error);
      if (!canRetry || attempt >= API_GOUV_MAX_RETRIES) {
        throw error;
      }
      const jitterMs = Math.floor(Math.random() * 200);
      const backoffMs = API_GOUV_RETRY_BASE_MS * 2 ** attempt + jitterMs;
      await sleep(backoffMs);
      attempt += 1;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

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

    const res = await fetchApiGouvWithRetry(url.toString());

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
    if (isRetryableNetworkError(e)) {
      return NextResponse.json(
        { error: "Service externe temporairement indisponible" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Erreur serveur lors de la recherche" },
      { status: 500 }
    );
  }
}
