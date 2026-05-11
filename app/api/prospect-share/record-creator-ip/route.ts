import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyIdToken, getAdminDb } from "@/lib/firebase-admin";
import { getClientIpFromRequest } from "@/lib/client-ip";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const idToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!idToken) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    const uid = await verifyIdToken(idToken);
    if (!uid) {
      return NextResponse.json({ error: "Token invalide" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const prospectId = typeof body.prospectId === "string" ? body.prospectId : "";
    if (!prospectId) {
      return NextResponse.json({ error: "prospectId requis" }, { status: 400 });
    }

    const ip = getClientIpFromRequest(request);
    if (!ip) {
      return NextResponse.json({ ok: true, skipped: "no_ip" });
    }

    const db = getAdminDb();
    const ref = db.collection("prospects").doc(prospectId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });
    }
    const data = snap.data() as { userId?: string };
    if (data.userId != null && data.userId !== uid) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    await ref.update({
      shareLinkCreatorIp: ip,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("record-creator-ip:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
