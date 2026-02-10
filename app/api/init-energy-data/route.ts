import { NextResponse } from "next/server";
import { initializeEnergyConsumptionData } from "@/lib/firestore-energy-data";

/**
 * API Route pour initialiser les données de consommation énergétique dans Firebase
 * 
 * GET /api/init-energy-data
 * 
 * Cette route doit être appelée une seule fois pour peupler la base de données Firebase
 * avec les données de consommation énergétique par type de bâtiment.
 */
export async function GET() {
  try {
    console.log("🚀 Démarrage de l'initialisation des données de consommation énergétique...");
    
    await initializeEnergyConsumptionData();
    
    return NextResponse.json({
      success: true,
      message: "Données de consommation énergétique initialisées avec succès dans Firebase",
    });
  } catch (error) {
    console.error("❌ Erreur lors de l'initialisation:", error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erreur inconnue",
      },
      { status: 500 }
    );
  }
}
