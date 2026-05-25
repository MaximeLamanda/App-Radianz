import type { MapBounds } from "@/lib/swr-hooks";
import { DISCOVERY_ENEDIS_MAX_COMMUNES } from "@/lib/discovery-enedis-layer";

export type GeoApiCommune = {
  code: string;
  nom: string;
  centre?: { coordinates?: [number, number] };
};

export function samplePointsForViewportBounds(bounds: MapBounds): { lat: number; lng: number }[] {
  const midLat = (bounds.sw.lat + bounds.ne.lat) / 2;
  const midLng = (bounds.sw.lng + bounds.ne.lng) / 2;
  return [
    { lat: midLat, lng: midLng },
    { lat: bounds.sw.lat, lng: bounds.sw.lng },
    { lat: bounds.sw.lat, lng: bounds.ne.lng },
    { lat: bounds.ne.lat, lng: bounds.sw.lng },
    { lat: bounds.ne.lat, lng: bounds.ne.lng },
  ];
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlmb = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function fetchCommuneAtPoint(
  lat: number,
  lng: number,
  fetchFn?: typeof fetch
): Promise<GeoApiCommune | null> {
  const fetchImpl = fetchFn ?? fetch;
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    fields: "code,nom,centre",
  });
  const url = `https://geo.api.gouv.fr/communes?${params.toString()}`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json = (await res.json()) as GeoApiCommune[];
  if (!Array.isArray(json) || json.length === 0) return null;
  return json[0] ?? null;
}

export async function resolveCommunesForViewport(
  bounds: MapBounds,
  options?: {
    maxCommunes?: number;
    fetchFn?: typeof fetch;
  }
): Promise<{ communes: GeoApiCommune[]; truncated: boolean }> {
  const max = options?.maxCommunes ?? DISCOVERY_ENEDIS_MAX_COMMUNES;
  const fetchImpl = options?.fetchFn ?? fetch;
  const center = samplePointsForViewportBounds(bounds)[0]!;
  const seen = new Map<string, GeoApiCommune>();

  const points = samplePointsForViewportBounds(bounds);
  await Promise.all(
    points.map(async (pt) => {
      const c = await fetchCommuneAtPoint(pt.lat, pt.lng, fetchImpl);
      if (!c?.code) return;
      const code = String(c.code).trim();
      if (!/^\d{5}$/.test(code)) return;
      if (!seen.has(code)) seen.set(code, { code, nom: c.nom ?? code, centre: c.centre });
    })
  );

  let communes = [...seen.values()];
  if (communes.length > max) {
    communes = communes
      .map((c) => {
        const coords = c.centre?.coordinates;
        const dist =
          coords && coords.length >= 2
            ? haversineMeters(center.lat, center.lng, coords[1], coords[0])
            : Number.POSITIVE_INFINITY;
        return { c, dist };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, max)
      .map((x) => x.c);
    return { communes, truncated: true };
  }
  return { communes, truncated: false };
}
