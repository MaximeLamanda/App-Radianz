import { NextRequest, NextResponse } from "next/server";
import { requireAuthAndQuota, incrementQuotaAfterSuccess } from "@/lib/api-auth-quota";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/** Calcule l'aire d'un polygone en m² (formule Shoelace sur projection locale) */
function polygonAreaM2(coords: Array<{ lat: number; lng: number }>): number {
  if (coords.length < 3) return 0;
  const R = 6371000;
  const centerLat = coords[0].lat;
  const centerLng = coords[0].lng;
  const projected = coords.map((c) => {
    const dLat = ((c.lat - centerLat) * Math.PI) / 180;
    const dLng = ((c.lng - centerLng) * Math.PI) / 180;
    const latRad = (centerLat * Math.PI) / 180;
    return {
      x: dLng * R * Math.cos(latRad),
      y: dLat * R,
    };
  });
  let area = 0;
  for (let i = 0; i < projected.length; i++) {
    const j = (i + 1) % projected.length;
    area += projected[i].x * projected[j].y - projected[j].x * projected[i].y;
  }
  return Math.abs(area) / 2;
}

interface OsmWayElement {
  type: string;
  id: number;
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OsmResponse {
  elements?: OsmWayElement[];
}

export interface OsmBuildingDisplay {
  id: string;
  polygonSurfaces: Array<{
    polygon: Array<{ lat: number; lng: number }>;
    areaM2: number;
    orientation: number | null;
  }>;
}

/**
 * GET /api/osm-buildings?swLat=&swLng=&neLat=&neLng=
 * Récupère les bâtiments OSM dans la bbox via Overpass API (source unique).
 *
 * Authentification requise (Authorization: Bearer <idToken>).
 * Quotas appliqués selon le statut du profil (admin, premium, starter, demo).
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthAndQuota(request, "osm");
  if (!authResult.ok) return authResult.response;
  const { uid } = authResult.context;

  const { searchParams } = request.nextUrl;
  const swLatStr = searchParams.get("swLat");
  const swLngStr = searchParams.get("swLng");
  const neLatStr = searchParams.get("neLat");
  const neLngStr = searchParams.get("neLng");

  if (!swLatStr || !swLngStr || !neLatStr || !neLngStr) {
    return NextResponse.json(
      { error: "swLat, swLng, neLat, neLng requis" },
      { status: 400 }
    );
  }

  const swLat = parseFloat(swLatStr);
  const swLng = parseFloat(swLngStr);
  const neLat = parseFloat(neLatStr);
  const neLng = parseFloat(neLngStr);

  if ([swLat, swLng, neLat, neLng].some(isNaN)) {
    return NextResponse.json(
      { error: "Paramètres bbox invalides" },
      { status: 400 }
    );
  }

  const s = Math.min(swLat, neLat);
  const n = Math.max(swLat, neLat);
  const w = Math.min(swLng, neLng);
  const e = Math.max(swLng, neLng);

  const query = `[out:json][timeout:25];
(
  way["building"](${s},${w},${n},${e});
);
out geom;`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 26000);

    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
      next: { revalidate: 0 },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Overpass API ${res.status}` },
        { status: 502 }
      );
    }

    const data = (await res.json()) as OsmResponse;
    const elements = data.elements ?? [];
    const buildings: OsmBuildingDisplay[] = [];

    for (const way of elements) {
      if (way.type !== "way" || !way.geometry || way.geometry.length < 3) {
        continue;
      }

      const polygon = way.geometry.map((g) => ({
        lat: g.lat,
        lng: g.lon,
      }));

      const areaM2 = Math.round(polygonAreaM2(polygon));

      buildings.push({
        id: `osm-${way.id}`,
        polygonSurfaces: [
          {
            polygon,
            areaM2,
            orientation: null,
          },
        ],
      });
    }

    incrementQuotaAfterSuccess(uid, "osm");
    return NextResponse.json({ buildings });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        { error: "Timeout Overpass" },
        { status: 504 }
      );
    }
    console.error("[OSM] Overpass error:", err);
    return NextResponse.json(
      { error: "Erreur lors de l'appel Overpass" },
      { status: 500 }
    );
  }
}
