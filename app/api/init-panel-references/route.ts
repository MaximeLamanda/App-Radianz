import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * @deprecated Les références de panneaux sont désormais propres à chaque utilisateur.
 * L'initialisation se fait automatiquement au premier accès (users/{userId}/panel_references).
 * Cette route ne fait plus rien.
 */
export async function GET() {
  return NextResponse.json(
    {
      deprecated: true,
      message:
        "Cette API est dépréciée. Les références de panneaux sont maintenant par utilisateur (users/{userId}/panel_references). L'initialisation se fait automatiquement au premier accès.",
    },
    { status: 410 }
  );
}
