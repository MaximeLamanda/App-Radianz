import { NextRequest, NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import { verifyIdToken, getAdminDb } from "@/lib/firebase-admin";

function timestampToIso(value: unknown): string | null {
  if (value == null) return null;
  const v = value as { toDate?: () => Date };
  if (typeof v.toDate === "function") {
    const d = v.toDate();
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function serializeSession(id: string, data: DocumentData) {
  return {
    id,
    startedAt: timestampToIso(data.startedAt),
    endedAt: timestampToIso(data.endedAt),
    durationMs: typeof data.durationMs === "number" && Number.isFinite(data.durationMs) ? data.durationMs : null,
    maxScrollDepth01:
      typeof data.maxScrollDepth01 === "number" && Number.isFinite(data.maxScrollDepth01)
        ? data.maxScrollDepth01
        : null,
    interactionCount:
      typeof data.interactionCount === "number" && Number.isFinite(data.interactionCount)
        ? Math.max(0, Math.floor(data.interactionCount))
        : 0,
    ctaClicks:
      typeof data.ctaClicks === "number" && Number.isFinite(data.ctaClicks)
        ? Math.max(0, Math.floor(data.ctaClicks))
        : 0,
    status: typeof data.status === "string" ? data.status : null,
    openerId: typeof data.openerId === "string" && data.openerId.trim().length > 0 ? data.openerId.trim() : null,
  };
}

export async function GET(request: NextRequest) {
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

    const prospectId = request.nextUrl.searchParams.get("prospectId")?.trim() ?? "";
    if (!prospectId) {
      return NextResponse.json({ error: "prospectId requis" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("prospects").doc(prospectId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });
    }

    const data = snap.data() as { userId?: string; shareToken?: string; shareSessionCount?: number; shareLastSessionAt?: unknown };
    if (data.userId != null && data.userId !== uid) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const sessionsSnap = await ref.collection("shareSessions").orderBy("startedAt", "desc").limit(20).get();

    const sessions = sessionsSnap.docs.map((d) => serializeSession(d.id, d.data()));

    return NextResponse.json({
      shareToken: data.shareToken ?? null,
      shareSessionCount:
        typeof data.shareSessionCount === "number" && Number.isFinite(data.shareSessionCount)
          ? Math.max(0, Math.floor(data.shareSessionCount))
          : 0,
      shareLastSessionAt: timestampToIso(data.shareLastSessionAt),
      sessions,
    });
  } catch (e) {
    console.error("share-sessions GET:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
