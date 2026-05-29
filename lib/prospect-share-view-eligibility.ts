import {
  isTerminalPipelineStatus,
  normalizeProspectPipelineStatus,
} from "@/lib/prospect-pipeline-status";

/** Raisons de skip communes aux vues « externes » (session KPI + register-view). */
export type ProspectShareSessionStartSkipped = "no_ip" | "no_creator_ip" | "same_ip" | "terminal";

export type ProspectShareSessionStartDecision =
  | { action: "skip"; skipped: ProspectShareSessionStartSkipped }
  | { action: "record_session" };

/**
 * Indique si une vue peut être enregistrée comme session de lecture (KPI).
 * Autorise le statut `ouvert` (relectures) ; exclut créateur, terminaux, IP manquante.
 */
export function evaluateProspectShareSessionStartDecision(input: {
  viewerIp: string | null | undefined;
  shareLinkCreatorIp?: string | null;
  pipelineStatus?: string | null;
  allowSameIpForTesting?: boolean;
}): ProspectShareSessionStartDecision {
  const viewer =
    typeof input.viewerIp === "string" ? input.viewerIp.trim() : String(input.viewerIp ?? "").trim();
  if (!viewer) {
    return { action: "skip", skipped: "no_ip" };
  }

  const creator =
    typeof input.shareLinkCreatorIp === "string"
      ? input.shareLinkCreatorIp.trim()
      : String(input.shareLinkCreatorIp ?? "").trim();
  if (!creator) {
    return { action: "skip", skipped: "no_creator_ip" };
  }

  if (viewer === creator && !input.allowSameIpForTesting) {
    return { action: "skip", skipped: "same_ip" };
  }

  const status = normalizeProspectPipelineStatus(input.pipelineStatus);
  if (isTerminalPipelineStatus(status)) {
    return { action: "skip", skipped: "terminal" };
  }

  return { action: "record_session" };
}

/** Raisons `skipped` alignées sur la réponse JSON de `/api/prospect-share/register-view`. */
export type ProspectShareRegisterViewSkipped =
  | ProspectShareSessionStartSkipped
  | "already_open";

export type ProspectShareRegisterViewDecision =
  | { action: "skip"; skipped: ProspectShareRegisterViewSkipped }
  | { action: "update_pipeline_to_open" };

/**
 * Décide si une vue HTTP doit mettre à jour le pipeline vers `ouvert`.
 * Logique pure (pas de Firestore) — même règles qu’historiquement dans `register-view`.
 */
export function evaluateProspectShareRegisterViewDecision(input: {
  viewerIp: string | null | undefined;
  shareLinkCreatorIp?: string | null;
  pipelineStatus?: string | null;
  allowSameIpForTesting?: boolean;
}): ProspectShareRegisterViewDecision {
  const session = evaluateProspectShareSessionStartDecision(input);
  if (session.action === "skip") {
    return session;
  }

  const status = normalizeProspectPipelineStatus(input.pipelineStatus);
  if (status === "ouvert") {
    return { action: "skip", skipped: "already_open" };
  }

  return { action: "update_pipeline_to_open" };
}
