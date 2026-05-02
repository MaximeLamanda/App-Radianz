import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth-quota";

const IGN_PARCELLE = "https://apicarto.ign.fr/api/cadastre/parcelle";
const PAGE_SIZE = 1000;
const FETCH_TIMEOUT_MS = 12000;

type CadastreFc = {
  type?: string;
  features?: GeoJSON.Feature[];
  numberReturned?: number;
};

function toNum(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchCadastrePage(params: URLSearchParams): Promise<CadastreFc | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${IGN_PARCELLE}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as CadastreFc;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;

  const swLat = toNum(request.nextUrl.searchParams.get("swLat"));
  const swLng = toNum(request.nextUrl.searchParams.get("swLng"));
  const neLat = toNum(request.nextUrl.searchParams.get("neLat"));
  const neLng = toNum(request.nextUrl.searchParams.get("neLng"));
  const codeInsee = request.nextUrl.searchParams.get("codeInsee")?.trim() || "33318";
  if (
    swLat == null ||
    swLng == null ||
    neLat == null ||
    neLng == null ||
    !Number.isFinite(swLat) ||
    !Number.isFinite(swLng) ||
    !Number.isFinite(neLat) ||
    !Number.isFinite(neLng)
  ) {
    return NextResponse.json({ error: "Paramètres bbox invalides." }, { status: 400 });
  }

  const minLat = Math.min(swLat, neLat);
  const maxLat = Math.max(swLat, neLat);
  const minLng = Math.min(swLng, neLng);
  const maxLng = Math.max(swLng, neLng);
  const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;

  const out: GeoJSON.Feature[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const q = new URLSearchParams({
      code_insee: codeInsee,
      bbox,
      _start: String(start),
    });
    const page = await fetchCadastrePage(q);
    if (!page?.features?.length) break;
    const feats = page.features.filter(
      (f): f is GeoJSON.Feature =>
        f.type === "Feature" &&
        !!f.geometry &&
        (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
    );
    out.push(...feats);
    if ((page.numberReturned ?? feats.length) < PAGE_SIZE) break;
  }

  return NextResponse.json({
    type: "FeatureCollection" as const,
    features: out,
    meta: {
      codeInsee,
      bbox,
      returned: out.length,
      truncated: false,
    },
  });
}
