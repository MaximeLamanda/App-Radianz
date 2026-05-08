/**
 * Après création / mise à jour du lien partagé côté client, enregistre l’IP du commercial
 * (requête vers l’API) pour la détection d’ouverture « externe ».
 */
export async function recordShareLinkCreatorIp(
  idToken: string,
  prospectId: string
): Promise<void> {
  const res = await fetch("/api/prospect-share/record-creator-ip", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ prospectId }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.warn("[prospect-share] record-creator-ip failed", res.status, t);
  }
}

export async function registerProspectSharePageView(shareToken: string): Promise<void> {
  const res = await fetch("/api/prospect-share/register-view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.warn("[prospect-share] register-view failed", res.status, t);
  }
}

/** Début de session KPI sur la page partagée (id stable par onglet via sessionStorage côté page). */
export async function startProspectShareSession(
  shareToken: string,
  sessionId: string
): Promise<void> {
  const res = await fetch("/api/prospect-share/share-session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken, sessionId }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.warn("[prospect-share] share-session/start failed", res.status, t);
  }
}

export async function endProspectShareSession(
  shareToken: string,
  sessionId: string,
  durationMs: number,
  maxScrollDepth01: number
): Promise<void> {
  const res = await fetch("/api/prospect-share/share-session/end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareToken, sessionId, durationMs, maxScrollDepth01 }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.warn("[prospect-share] share-session/end failed", res.status, t);
  }
}
