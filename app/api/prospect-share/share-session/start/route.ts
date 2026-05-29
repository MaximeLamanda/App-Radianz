import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { getClientIpFromRequest } from "@/lib/client-ip";
import { evaluateProspectShareSessionStartDecision } from "@/lib/prospect-share-view-eligibility";

function isSameIpBypassEnabledForTests(): boolean {
  return process.env.PROSPECT_SHARE_ALLOW_SAME_IP_FOR_TESTS === "1";
}

function buildOpenerIdFromIp(ip: string): string {
  return createHash("sha256").update(ip.trim().toLowerCase()).digest("hex").slice(0, 12);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const shareToken = typeof body.shareToken === "string" ? body.shareToken.trim() : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!shareToken || !sessionId) {
      return NextResponse.json({ error: "shareToken et sessionId requis" }, { status: 400 });
    }

    const viewerIp = getClientIpFromRequest(request);
    if (!viewerIp) {
      return NextResponse.json({ ok: true, skipped: "no_ip" });
    }

    const db = getAdminDb();
    const q = await db.collection("prospects").where("shareToken", "==", shareToken).limit(1).get();
    if (q.empty) {
      return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });
    }

    const docRef = q.docs[0].ref;
    const data = q.docs[0].data() as {
      shareLinkCreatorIp?: string;
      pipelineStatus?: string;
    };

    const decision = evaluateProspectShareSessionStartDecision({
      viewerIp,
      shareLinkCreatorIp: data.shareLinkCreatorIp,
      pipelineStatus: data.pipelineStatus,
      allowSameIpForTesting: isSameIpBypassEnabledForTests(),
    });
    if (decision.action === "skip") {
      return NextResponse.json({ ok: true, skipped: decision.skipped });
    }

    const sessionRef = docRef.collection("shareSessions").doc(sessionId);
    const existing = await sessionRef.get();
    if (existing.exists) {
      return NextResponse.json({ ok: true, idempotent: true });
    }

    await sessionRef.set({
      startedAt: FieldValue.serverTimestamp(),
      status: "open",
      openerId: buildOpenerIdFromIp(viewerIp),
    });

    return NextResponse.json({ ok: true, created: true });
  } catch (e) {
    console.error("share-session/start:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
