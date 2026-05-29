/** À partir de ce nombre de barres, le graphique défile horizontalement. */
export const SHARE_SESSION_CHART_SCROLL_MIN_BARS = 8;

/** Largeur réservée par visite (barre + marge) en px. */
export const SHARE_SESSION_CHART_BAR_SLOT_PX = 44;

export function shareSessionChartNeedsHorizontalScroll(barCount: number): boolean {
  return barCount > SHARE_SESSION_CHART_SCROLL_MIN_BARS;
}

export function shareSessionChartScrollWidthPx(barCount: number): number {
  return Math.max(barCount, 1) * SHARE_SESSION_CHART_BAR_SLOT_PX;
}

/**
 * Vert plus soutenu quand le nombre d’interactions est élevé (relatif au max de la série).
 */
export function shareSessionBarFillFromInteractions(
  interactionCount: number,
  maxInteractionsInSeries: number
): string {
  const max = Math.max(0, maxInteractionsInSeries);
  if (max <= 0) {
    return "hsl(142 35% 88%)";
  }
  const count = Math.max(0, interactionCount);
  const t = Math.min(1, count / max);
  const saturation = 28 + t * 48;
  const lightness = 90 - t * 48;
  return `hsl(142 ${saturation}% ${lightness}%)`;
}
