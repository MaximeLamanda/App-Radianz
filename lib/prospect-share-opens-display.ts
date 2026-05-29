import { formatShareSessionDateFr } from "@/lib/share-reading-session-format";

export const SHARE_OPENS_DOT_CAP = 5;

/** Sessions terminées considérées comme « récentes » (surbrillance du dernier point). */
export const SHARE_OPENS_RECENT_MS = 7 * 24 * 60 * 60 * 1000;

export type ProspectShareOpensInput = {
  shareToken?: string | null;
  shareSessionCount?: number | null;
  shareLastSessionAt?: Date | string | null;
};

export type ProspectShareOpensDisplay = {
  hasShareLink: boolean;
  count: number;
  filledDots: number;
  emptyDots: number;
  isRecent: boolean;
  tooltip: string;
};

function normalizeCount(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getProspectShareOpensDisplay(input: ProspectShareOpensInput): ProspectShareOpensDisplay {
  const hasShareLink = Boolean((input.shareToken ?? "").trim());
  const count = normalizeCount(input.shareSessionCount);
  const lastAt = toDate(input.shareLastSessionAt);
  const isRecent =
    lastAt != null && count > 0 && Date.now() - lastAt.getTime() <= SHARE_OPENS_RECENT_MS;

  const filledDots = Math.min(count, SHARE_OPENS_DOT_CAP);
  const emptyDots = hasShareLink ? Math.max(0, SHARE_OPENS_DOT_CAP - filledDots) : 0;

  let tooltip: string;
  if (!hasShareLink) {
    tooltip = "Aucun lien page client — générez-le depuis la fiche prospect";
  } else if (count === 0) {
    tooltip = "Lien actif · aucune ouverture enregistrée";
  } else {
    const lastLabel = formatShareSessionDateFr(lastAt?.toISOString() ?? null);
    const plural = count > 1 ? "ouvertures" : "ouverture";
    const overflow = count > SHARE_OPENS_DOT_CAP ? ` (affichage plafonné à ${SHARE_OPENS_DOT_CAP})` : "";
    tooltip = `${count} ${plural} terminée${count > 1 ? "s" : ""}${overflow} · dernière : ${lastLabel}`;
  }

  return { hasShareLink, count, filledDots, emptyDots, isRecent, tooltip };
}
