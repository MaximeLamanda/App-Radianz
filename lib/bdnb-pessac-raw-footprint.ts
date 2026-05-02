/**
 * Polygones BDNB sans jointure (table bdnb_pessac_geom_raw · 33318).
 */

export type BdnbPessacRawFootprint = {
  batimentGroupeId: string;
  codeCommuneInsee: string;
  areaM2: number;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};

export function parseBdnbPessacRawFeature(f: {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
}): BdnbPessacRawFootprint | null {
  const g = f.geometry;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return null;
  const props = f.properties ?? {};
  const id = String(props.batiment_groupe_id ?? "");
  const cc = String(props.code_commune_insee ?? "");
  const areaRaw = props.area_m2;
  const areaM2 =
    typeof areaRaw === "number"
      ? areaRaw
      : parseFloat(String(areaRaw ?? ""));
  if (!id || !Number.isFinite(areaM2)) return null;
  return {
    batimentGroupeId: id,
    codeCommuneInsee: cc,
    areaM2,
    geometry: g as GeoJSON.Polygon | GeoJSON.MultiPolygon,
  };
}
