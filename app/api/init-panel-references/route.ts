import { NextRequest, NextResponse } from "next/server";
import {
  initializePanelReferencesInFirebase,
  getPanelReferencesFromFirebase,
  savePanelReferenceToFirebase,
} from "@/lib/firestore-panel-references";

/** Dimensions cible du panneau en mm, converties en m pour Firestore */
const PANEL_WIDTH_MM = 1762;
const PANEL_LENGTH_MM = 1134;
const PANEL_WIDTH_M = PANEL_WIDTH_MM / 1000;
const PANEL_LENGTH_M = PANEL_LENGTH_MM / 1000;

/**
 * API Route pour initialiser ou mettre à jour les références de panneaux dans Firebase
 *
 * GET /api/init-panel-references
 *   Peupler la collection panel_references si vide.
 *
 * GET /api/init-panel-references?updateDimensions=1
 *   Met à jour les dimensions (1762×1134 mm) du panneau recommandé dans Firebase.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const updateDimensions = searchParams.get("updateDimensions") === "1";

    if (updateDimensions) {
      const refs = await getPanelReferencesFromFirebase();
      const recommended = refs.find((r) => r.recommended === true) ?? refs.find((r) => r.id === "default-1") ?? refs[0];
      if (!recommended) {
        return NextResponse.json(
          { success: false, error: "Aucune référence panneau dans Firebase" },
          { status: 404 }
        );
      }
      const updated = {
        ...recommended,
        widthM: PANEL_WIDTH_M,
        lengthM: PANEL_LENGTH_M,
      };
      await savePanelReferenceToFirebase(updated);
      return NextResponse.json({
        success: true,
        message: `Dimensions du panneau mises à jour (${PANEL_WIDTH_MM}×${PANEL_LENGTH_MM} mm)`,
        panelId: updated.id,
      });
    }

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
