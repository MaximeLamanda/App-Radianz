import {
  formatV5ZoneTagLabel,
  parseMatchingV5BuildingsJson,
  type ScoutMatchingV5Row,
} from "@/lib/scout-matching-v5-map";

const DISCOVERY_ACTIVITY_TAG_ORDER = [
  "industrial",
  "commercial",
  "retail",
  "residential",
] as const;

/** Tags affichés dans le panneau « Activité de la zone » (Discovery). */
export const DISCOVERY_SELECTABLE_ZONE_TAGS = new Set([
  "industrial",
  "commercial",
  "retail",
  "residential",
]);

export function discoverySelectableZoneTag(raw: unknown): string | null {
  const tag = String(raw ?? "").trim().toLowerCase();
  return DISCOVERY_SELECTABLE_ZONE_TAGS.has(tag) ? tag : null;
}

export function zoneTagsFromMatchingV5Row(row: ScoutMatchingV5Row): string[] {
  const out = new Set<string>();
  const push = (raw: unknown) => {
    const tag = discoverySelectableZoneTag(raw);
    if (tag) out.add(tag);
  };
  push(row.properties?.zone_tag);
  push(row.properties?.osm_zone_tag);
  for (const b of parseMatchingV5BuildingsJson(row.buildingsJson)) {
    push(b.zoneTag);
  }
  return Array.from(out);
}

export function comboMeetsDiscoveryActivityTag(
  zoneTags: readonly string[],
  selectedTag: string | null
): boolean {
  if (!selectedTag) return true;
  return zoneTags.includes(selectedTag);
}

/** Tags activité pour le tiroir Discovery (SQL combo ou parcelles liées). */
export function discoveryZoneTagsForDrawer(
  row: ScoutMatchingV5Row,
  parcelleRows: readonly ScoutMatchingV5Row[],
  comboZoneTagsFromApi?: readonly string[] | null
): string[] {
  if (comboZoneTagsFromApi && comboZoneTagsFromApi.length > 0) {
    return [...comboZoneTagsFromApi];
  }
  const out = new Set<string>();
  const parcelles =
    parcelleRows.length > 0 ? parcelleRows : row.grain === "parcelle" ? [row] : [];
  for (const r of parcelles) {
    for (const tag of zoneTagsFromMatchingV5Row(r)) out.add(tag);
  }
  if (parcelles.length === 0) {
    for (const tag of zoneTagsFromMatchingV5Row(row)) out.add(tag);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Libellé court pour badge hero / pills (ex. « Industriel · Tertiaire »). */
export function discoveryComboActivityHeroBadgeLabel(zoneTags: readonly string[]): string {
  const normalized = new Set(
    zoneTags.map((t) => String(t ?? "").trim().toLowerCase()).filter(Boolean)
  );
  if (normalized.size === 0) return "";
  const ordered = DISCOVERY_ACTIVITY_TAG_ORDER.filter((t) => normalized.has(t));
  const labels = ordered.map((t) => formatV5ZoneTagLabel(t)).filter(Boolean);
  if (labels.length > 0) return labels.join(" · ");
  const rest = [...normalized]
    .filter((t) => !(DISCOVERY_ACTIVITY_TAG_ORDER as readonly string[]).includes(t))
    .sort((a, b) => a.localeCompare(b));
  return rest
    .map((t) => formatV5ZoneTagLabel(t))
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
}

export function countZoneTagsFromCombos(
  combos: readonly { zoneTags: readonly string[] }[]
): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of combos) {
    for (const tag of c.zoneTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
