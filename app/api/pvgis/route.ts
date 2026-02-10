import { NextRequest, NextResponse } from "next/server";
import { getPVGISData, validateCoordinates, type PVGISOptions } from "@/lib/pvgis";
import type { AddressCoordinates } from "@/types";

/**
 * Route API pour récupérer les données PVGIS
 * POST /api/pvgis
 * 
 * Body: {
 *   lat: number;
 *   lon: number;
 *   peakpower?: number;
 *   loss?: number;
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lat, lon, peakpower, loss } = body;

    // Valider les paramètres
    if (typeof lat !== "number" || typeof lon !== "number") {
      return NextResponse.json(
        { error: "Les coordonnées lat et lon sont requises et doivent être des nombres" },
        { status: 400 }
      );
    }

    const coordinates: AddressCoordinates = { lat, lng: lon };

    if (!validateCoordinates(coordinates)) {
      return NextResponse.json(
        { error: "Coordonnées invalides. Lat doit être entre -90 et 90, lon entre -180 et 180" },
        { status: 400 }
      );
    }

    // Options pour PVGIS
    const options: Partial<PVGISOptions> = {};
    if (typeof peakpower === "number" && peakpower > 0) {
      options.peakpower = peakpower;
    }
    if (typeof loss === "number" && loss >= 0 && loss <= 100) {
      options.loss = loss;
    }

    // Appeler PVGIS
    const pvgisData = await getPVGISData(coordinates, options);

    return NextResponse.json(pvgisData);
  } catch (error) {
    console.error("Erreur lors de l'appel PVGIS:", error);
    
    if (error instanceof Error) {
      // Gérer les erreurs spécifiques
      if (error.message.includes("429")) {
        return NextResponse.json(
          { error: "Trop de requêtes. Veuillez réessayer dans quelques instants." },
          { status: 429 }
        );
      }
      if (error.message.includes("529")) {
        return NextResponse.json(
          { error: "Service PVGIS surchargé. Veuillez réessayer plus tard." },
          { status: 503 }
        );
      }
      
      return NextResponse.json(
        { error: error.message || "Erreur lors de la récupération des données PVGIS" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Erreur inconnue lors de la récupération des données PVGIS" },
      { status: 500 }
    );
  }
}

// Méthode GET pour tester (optionnel)
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const peakpower = searchParams.get("peakpower");
  const loss = searchParams.get("loss");

  if (!lat || !lon) {
    return NextResponse.json(
      { error: "Les paramètres lat et lon sont requis" },
      { status: 400 }
    );
  }

  try {
    const coordinates: AddressCoordinates = {
      lat: parseFloat(lat),
      lng: parseFloat(lon),
    };

    if (!validateCoordinates(coordinates)) {
      return NextResponse.json(
        { error: "Coordonnées invalides" },
        { status: 400 }
      );
    }

    const options: Partial<PVGISOptions> = {};
    if (peakpower) {
      const peakpowerNum = parseFloat(peakpower);
      if (!isNaN(peakpowerNum) && peakpowerNum > 0) {
        options.peakpower = peakpowerNum;
      }
    }
    if (loss) {
      const lossNum = parseFloat(loss);
      if (!isNaN(lossNum) && lossNum >= 0 && lossNum <= 100) {
        options.loss = lossNum;
      }
    }

    const pvgisData = await getPVGISData(coordinates, options);
    return NextResponse.json(pvgisData);
  } catch (error) {
    console.error("Erreur lors de l'appel PVGIS:", error);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message || "Erreur lors de la récupération des données PVGIS" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: "Erreur inconnue lors de la récupération des données PVGIS" },
      { status: 500 }
    );
  }
}
