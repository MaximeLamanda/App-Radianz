import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth-quota";

/** Réponse Google Solar API (sous-ensemble utile pour le test UI). */
export type GoogleSolarInsightsPayload = {
  building: {
    name?: string;
    regionCode?: string;
    postalCode?: string;
    administrativeArea?: string;
    imageryQuality?: string;
    imageryDate?: { year?: number; month?: number; day?: number };
    center?: { latitude?: number; longitude?: number };
    solarPotential?: {
      maxArrayPanelsCount?: number;
      maxArrayAreaMeters2?: number;
      maxSunshineHoursPerYear?: number;
      panelCapacityWatts?: number;
      panelHeightMeters?: number;
      panelWidthMeters?: number;
      carbonOffsetFactorKgPerMwh?: number;
      roofSegmentStatsCount?: number;
    };
  } | null;
};

function getSolarApiKey(): string | undefined {
  return (
    process.env.GOOGLE_SOLAR_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    undefined
  );
}

function mapBuildingInsights(raw: Record<string, unknown>): GoogleSolarInsightsPayload["building"] {
  const solarRaw = raw.solarPotential as Record<string, unknown> | undefined;
  const roofSegments = solarRaw?.roofSegmentStats;
  const roofSegmentStatsCount = Array.isArray(roofSegments) ? roofSegments.length : undefined;

  const imageryDate = raw.imageryDate as { year?: number; month?: number; day?: number } | undefined;
  const center = raw.center as { latitude?: number; longitude?: number } | undefined;

  const solarPotential =
    solarRaw == null
      ? undefined
      : {
          maxArrayPanelsCount:
            typeof solarRaw.maxArrayPanelsCount === "number" ? solarRaw.maxArrayPanelsCount : undefined,
          maxArrayAreaMeters2:
            typeof solarRaw.maxArrayAreaMeters2 === "number" ? solarRaw.maxArrayAreaMeters2 : undefined,
          maxSunshineHoursPerYear:
            typeof solarRaw.maxSunshineHoursPerYear === "number"
              ? solarRaw.maxSunshineHoursPerYear
              : undefined,
          panelCapacityWatts:
            typeof solarRaw.panelCapacityWatts === "number" ? solarRaw.panelCapacityWatts : undefined,
          panelHeightMeters:
            typeof solarRaw.panelHeightMeters === "number" ? solarRaw.panelHeightMeters : undefined,
          panelWidthMeters:
            typeof solarRaw.panelWidthMeters === "number" ? solarRaw.panelWidthMeters : undefined,
          carbonOffsetFactorKgPerMwh:
            typeof solarRaw.carbonOffsetFactorKgPerMwh === "number"
              ? solarRaw.carbonOffsetFactorKgPerMwh
              : undefined,
          roofSegmentStatsCount,
        };

  return {
    name: typeof raw.name === "string" ? raw.name : undefined,
    regionCode: typeof raw.regionCode === "string" ? raw.regionCode : undefined,
    postalCode: typeof raw.postalCode === "string" ? raw.postalCode : undefined,
    administrativeArea: typeof raw.administrativeArea === "string" ? raw.administrativeArea : undefined,
    imageryQuality: typeof raw.imageryQuality === "string" ? raw.imageryQuality : undefined,
    imageryDate,
    center,
    solarPotential,
  };
}

function isSolarApiPaused(): boolean {
  const v = process.env.GOOGLE_SOLAR_API_DISABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;

  if (isSolarApiPaused()) {
    return NextResponse.json({
      building: null as GoogleSolarInsightsPayload["building"],
      message:
        "Google Solar API en pause (variable GOOGLE_SOLAR_API_DISABLED). Retirez-la ou mettez-la à false pour réactiver.",
    });
  }

  const key = getSolarApiKey();
  if (!key) {
    return NextResponse.json(
      { error: "Clé API Solar / Maps manquante (GOOGLE_SOLAR_API_KEY ou NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)." },
      { status: 500 }
    );
  }

  const { searchParams } = request.nextUrl;
  const latStr = searchParams.get("lat");
  const lngStr = searchParams.get("lng");
  const qualityStr = searchParams.get("requiredQuality");

  if (!latStr || !lngStr) {
    return NextResponse.json({ error: "lat et lng requis" }, { status: 400 });
  }

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat et lng doivent être des nombres valides" }, { status: 400 });
  }

  const allowedQuality = new Set(["HIGH", "MEDIUM", "LOW", "BASE"]);
  const requiredQuality =
    qualityStr && allowedQuality.has(qualityStr.toUpperCase()) ? qualityStr.toUpperCase() : "MEDIUM";

  const url = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
  url.searchParams.set("location.latitude", String(lat));
  url.searchParams.set("location.longitude", String(lng));
  url.searchParams.set("requiredQuality", requiredQuality);
  url.searchParams.set("key", key);

  try {
    const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });

    if (res.status === 404) {
      return NextResponse.json({
        building: null as GoogleSolarInsightsPayload["building"],
        message:
          "Aucun bâtiment Solar à proximité (≈50 m) ou qualité d’imagery insuffisante. Essayez requiredQuality=MEDIUM ou HIGH.",
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[google-solar-insights] Google error:", res.status, errText.slice(0, 500));
      return NextResponse.json(
        { error: `Erreur Google Solar API (${res.status})` },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 }
      );
    }

    const raw = (await res.json()) as Record<string, unknown>;
    const building = mapBuildingInsights(raw);
    return NextResponse.json({ building } satisfies GoogleSolarInsightsPayload);
  } catch (err) {
    console.error("[google-solar-insights] Erreur:", err);
    return NextResponse.json({ error: "Erreur lors de l’appel Google Solar API" }, { status: 500 });
  }
}
