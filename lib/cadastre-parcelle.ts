/**
 * Helpers cadastre APICarto IGN (parcelle).
 * @see https://apicarto.ign.fr/api/doc/cadastre
 */

/** Numéro de parcelle sur 4 caractères (ex. 17 → 0017). */
export function padNumeroParcelle(raw: string | null | undefined): string {
  const s = String(raw ?? "")
    .trim()
    .replace(/\D/g, "");
  if (!s) return "";
  return s.length <= 4 ? s.padStart(4, "0") : s.slice(-4);
}

export type GeoJsonFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: unknown };
  properties?: Record<string, unknown>;
};

export function mergeCadastreFeatureCollections(
  collections: Array<{ features?: GeoJsonFeature[] } | null | undefined>
): { type: "FeatureCollection"; features: GeoJsonFeature[] } {
  const features: GeoJsonFeature[] = [];
  for (const c of collections) {
    if (c?.features && Array.isArray(c.features)) {
      for (const f of c.features) {
        if (f?.type === "Feature" && f.geometry) features.push(f);
      }
    }
  }
  return { type: "FeatureCollection", features };
}
