import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { getClientIpFromRequest } from "@/lib/client-ip";
import { evaluateProspectShareRegisterViewDecision } from "@/lib/prospect-share-view-eligibility";
import type { ProspectPipelineStatus } from "@/types";

function isSameIpBypassEnabledForTests(): boolean {
  return process.env.PROSPECT_SHARE_ALLOW_SAME_IP_FOR_TESTS === "1";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const shareToken = typeof body.shareToken === "string" ? body.shareToken.trim() : "";
    if (!shareToken) {
      return NextResponse.json({ error: "shareToken requis" }, { status: 400 });
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

    const decision = evaluateProspectShareRegisterViewDecision({
      viewerIp,
      shareLinkCreatorIp: data.shareLinkCreatorIp,
      pipelineStatus: data.pipelineStatus,
      allowSameIpForTesting: isSameIpBypassEnabledForTests(),
    });
    if (decision.action === "skip") {
      return NextResponse.json({ ok: true, skipped: decision.skipped });
    }

    const next: ProspectPipelineStatus = "ouvert";
    await docRef.update({
      pipelineStatus: next,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, updated: true });
  } catch (e) {
    console.error("register-view:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
