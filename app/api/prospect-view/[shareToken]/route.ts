import { NextRequest, NextResponse } from "next/server";
import { updateProspectOverrides } from "@/lib/firestore";

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ shareToken: string }> }
) {
  try {
    const { shareToken } = await params;
    if (!shareToken || typeof shareToken !== "string") {
      return NextResponse.json({ error: "shareToken requis" }, { status: 400 });
    }

    const body = await _request.json().catch(() => ({}));
    const configurationMode = body.configurationMode as "perfect_fit" | "highest_production" | undefined;
    const annualConsumptionKwhOverride =
      body.annualConsumptionKwhOverride != null
        ? typeof body.annualConsumptionKwhOverride === "number"
          ? body.annualConsumptionKwhOverride
          : null
        : undefined;

    const updates: { configurationMode?: "perfect_fit" | "highest_production"; annualConsumptionKwhOverride?: number | null } = {};
    if (configurationMode === "perfect_fit" || configurationMode === "highest_production") {
      updates.configurationMode = configurationMode;
    }
    if (annualConsumptionKwhOverride !== undefined) {
      updates.annualConsumptionKwhOverride =
        annualConsumptionKwhOverride === null ? null : Math.max(0, annualConsumptionKwhOverride);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true });
    }

    const ok = await updateProspectOverrides(shareToken, updates);
    if (!ok) {
      return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("prospect-view PATCH:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
