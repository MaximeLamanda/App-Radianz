import type { ProspectPipelineStatus } from "@/types";

const VALID: ProspectPipelineStatus[] = ["cree", "envoye", "ouvert", "converti", "perdu"];

const LEGACY_TO_CANONICAL: Record<string, ProspectPipelineStatus> = {
  nouveau: "cree",
  en_cours: "envoye",
  devis_envoye: "envoye",
};

export function normalizeProspectPipelineStatus(
  raw: string | undefined | null
): ProspectPipelineStatus {
  if (raw == null || raw === "") return "cree";
  if (LEGACY_TO_CANONICAL[raw]) return LEGACY_TO_CANONICAL[raw];
  if ((VALID as string[]).includes(raw)) return raw as ProspectPipelineStatus;
  return "cree";
}

export function isTerminalPipelineStatus(status: ProspectPipelineStatus): boolean {
  return status === "converti" || status === "perdu";
}
