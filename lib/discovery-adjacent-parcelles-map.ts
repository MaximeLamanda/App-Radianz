import type { DiscoveryAdjacentParcelle } from "@/lib/matching-v5-parcelles-adjacent-http";

/** Toutes les voisines restent cliquables ; `in_effective` pilote le style et le toggle. */
export function adjacentParcellesToFeatureCollection(
  candidates: readonly DiscoveryAdjacentParcelle[],
  effectiveParcelleIds: ReadonlySet<string>
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const c of candidates) {
    features.push({
      type: "Feature",
      id: c.scout_v5_id,
      geometry: c.geometry,
      properties: {
        scout_v5_id: c.scout_v5_id,
        combo_id: c.combo_id,
        cadastre_label: c.cadastre_label,
        in_effective: effectiveParcelleIds.has(c.scout_v5_id),
      },
    });
  }
  return { type: "FeatureCollection", features };
}
