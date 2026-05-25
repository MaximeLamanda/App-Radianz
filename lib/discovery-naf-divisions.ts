import {
  formatNafRev2DivisionOption,
  labelNafRev2Division,
  NAF_REV2_DIVISIONS,
  searchNafRev2Divisions,
} from "@/lib/naf-rev2-division-labels";

export type DiscoveryNafDivisionOption = {
  code: string;
  label: string;
  displayLabel: string;
  count: number;
};

export function countNafDivisionsFromCombos(
  combos: readonly { nafDivisions: readonly string[] }[]
): Array<{ code: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of combos) {
    for (const code of c.nafDivisions) {
      const k = String(code ?? "").trim();
      if (!/^\d{2}$/.test(k)) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/**
 * Options pour le picker : divisions présentes dans le viewport d’abord (avec effectif),
 * puis le reste du référentiel NAF.
 */
export function buildDiscoveryNafDivisionPickerOptions(
  viewportCounts: readonly { code: string; count: number }[]
): DiscoveryNafDivisionOption[] {
  const seen = new Set<string>();
  const out: DiscoveryNafDivisionOption[] = [];

  for (const { code, count } of viewportCounts) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({
      code,
      count,
      label: labelNafRev2Division(code),
      displayLabel: formatNafRev2DivisionOption(code),
    });
  }

  for (const d of NAF_REV2_DIVISIONS) {
    if (seen.has(d.code)) continue;
    out.push({
      code: d.code,
      count: 0,
      label: d.label,
      displayLabel: formatNafRev2DivisionOption(d.code),
    });
  }

  return out;
}

export { searchNafRev2Divisions, formatNafRev2DivisionOption, labelNafRev2Division };
