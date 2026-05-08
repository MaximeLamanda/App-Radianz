import {
  isTerminalPipelineStatus,
  normalizeProspectPipelineStatus,
} from "@/lib/prospect-pipeline-status";

/** Raisons `skipped` alignées sur la réponse JSON de `/api/prospect-share/register-view`. */
export type ProspectShareRegisterViewSkipped =
  | "no_ip"
  | "no_creator_ip"
  | "same_ip"
  | "terminal"
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
}): ProspectShareRegisterViewDecision {
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

  if (viewer === creator) {
    return { action: "skip", skipped: "same_ip" };
  }

  const status = normalizeProspectPipelineStatus(input.pipelineStatus);
  if (isTerminalPipelineStatus(status)) {
    return { action: "skip", skipped: "terminal" };
  }

  if (status === "ouvert") {
    return { action: "skip", skipped: "already_open" };
  }

  return { action: "update_pipeline_to_open" };
}
