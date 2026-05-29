import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  clampShareSessionCounter,
  clampShareSessionDurationMs,
  clampShareSessionMaxScrollDepth01,
} from "@/lib/share-session-metrics";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const shareToken = typeof body.shareToken === "string" ? body.shareToken.trim() : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!shareToken || !sessionId) {
      return NextResponse.json({ error: "shareToken et sessionId requis" }, { status: 400 });
    }

    const durationMs = clampShareSessionDurationMs(body.durationMs);
    const maxScrollDepth01 = clampShareSessionMaxScrollDepth01(body.maxScrollDepth01);
    const interactionCount = clampShareSessionCounter(body.interactionCount);
    const ctaClicks = clampShareSessionCounter(body.ctaClicks);

    const db = getAdminDb();
    const q = await db.collection("prospects").where("shareToken", "==", shareToken).limit(1).get();
    if (q.empty) {
      return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });
    }

    const prospectRef = q.docs[0].ref;
    const sessionRef = prospectRef.collection("shareSessions").doc(sessionId);

    type EndOutcome = "closed" | "no_session" | "already_closed";

    const outcome: EndOutcome = await db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists) {
        return "no_session";
      }
      const s = sessionSnap.data() as { status?: string };
      if (s.status !== "open") {
        return "already_closed";
      }

      tx.update(sessionRef, {
        endedAt: FieldValue.serverTimestamp(),
        durationMs,
        maxScrollDepth01,
        interactionCount,
        ctaClicks,
        status: "closed",
      });

      tx.update(prospectRef, {
        shareSessionCount: FieldValue.increment(1),
        shareLastSessionAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return "closed";
    });

    if (outcome === "no_session") {
      return NextResponse.json({ ok: true, skipped: "no_session" });
    }
    if (outcome === "already_closed") {
      return NextResponse.json({ ok: true, idempotent: true });
    }

    return NextResponse.json({ ok: true, closed: true });
  } catch (e) {
    console.error("share-session/end:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
