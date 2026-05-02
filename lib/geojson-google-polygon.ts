/**
 * Convertit un polygone / multi-polygone GeoJSON (WGS84) en anneaux pour google.maps.Polygon.
 * Sortie : tableau de « parties » (MultiPolygon), chaque partie = anneaux [extérieur, trous…].
 */
export function geojsonPolygonToGooglePathParts(geom: {
  type: "Polygon";
  coordinates: number[][][];
} | {
  type: "MultiPolygon";
  coordinates: number[][][][];
}): Array<Array<Array<{ lat: number; lng: number }>>> {
  if (geom.type === "Polygon") {
    const rings = geom.coordinates.map((ring) =>
      ring.map(([lng, lat]) => ({ lat, lng }))
    );
    return [rings];
  }
  return geom.coordinates.map((poly) =>
    poly.map((ring) => ring.map(([lng, lat]) => ({ lat, lng })))
  );
}
