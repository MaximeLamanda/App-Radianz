import { NextRequest, NextResponse } from "next/server";
import { getPVGISHourlyTypicalDay } from "@/lib/pvgis";
import { validateCoordinates } from "@/lib/pvgis";
import type { AddressCoordinates } from "@/types";

/**
 * POST /api/pvgis-hourly
 * Body: { lat, lon, peakpower?, loss?, monthlyProduction? }
 * Retourne { hourlyProduction: number[] } (24h, kWh).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lat, lon, peakpower, loss, monthlyProduction } = body;
    if (typeof lat !== "number" || typeof lon !== "number") {
      return NextResponse.json(
        { error: "lat et lon requis (nombres)" },
        { status: 400 }
      );
    }
    const coordinates: AddressCoordinates = { lat, lng: lon };
    if (!validateCoordinates(coordinates)) {
      return NextResponse.json({ error: "Coordonnées invalides" }, { status: 400 });
    }
    const result = await getPVGISHourlyTypicalDay(coordinates, {
      peakpower: typeof peakpower === "number" && peakpower > 0 ? peakpower : 1,
      loss: typeof loss === "number" && loss >= 0 && loss <= 100 ? loss : 14,
      monthlyProduction: Array.isArray(monthlyProduction) ? monthlyProduction : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur" },
      { status: 500 }
    );
  }
}
