import { NextResponse } from "next/server";
import {
  initializePanelReferencesInFirebase,
  getPanelReferencesFromFirebase,
} from "@/lib/firestore-panel-references";

/**
 * API Route pour initialiser les références de panneaux dans Firebase
 *
 * GET /api/init-panel-references
 *
 * À appeler une fois pour peupler la collection panel_references
 * (ou si vous ne voyez pas les données dans la console Firebase).
 */
export async function GET() {
  try {
    const existing = await getPanelReferencesFromFirebase();
    if (existing.length > 0) {
      return NextResponse.json({
        success: true,
        message: "Références déjà présentes, aucune action.",
        count: existing.length,
      });
    }
    await initializePanelReferencesInFirebase();
    const after = await getPanelReferencesFromFirebase();
    return NextResponse.json({
      success: true,
      message: "Références de panneaux initialisées dans Firebase",
      count: after.length,
    });
  } catch (error) {
    console.error("Erreur init panel references:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
