export type MatchingV5BuildingIds = {
  constructionIds: string[];
  groupIds: string[];
};

/**
 * Normalise des IDs de buildings V5 venant du front.
 * - `batiment_construction_id` contient ":" (ex: "...:1")
 * - fallback legacy: `batiment_groupe_id` sans suffixe
 */
export function splitMatchingV5BuildingIds(rawIds: string[]): MatchingV5BuildingIds {
  const construction = new Set<string>();
  const groups = new Set<string>();

  for (const raw of rawIds) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const id = trimmed.startsWith("bdnbcstr:") ? trimmed.slice("bdnbcstr:".length) : trimmed;
    if (!id) continue;
    if (id.includes(":")) {
      construction.add(id);
    } else {
      groups.add(id);
    }
  }

  return {
    constructionIds: Array.from(construction),
    groupIds: Array.from(groups),
  };
}
