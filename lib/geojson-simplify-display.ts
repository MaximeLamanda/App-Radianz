function sqDist(p: GeoJSON.Position, a: GeoJSON.Position, b: GeoJSON.Position): number {
  const x = p[0]!;
  const y = p[1]!;
  const x1 = a[0]!;
  const y1 = a[1]!;
  const x2 = b[0]!;
  const y2 = b[1]!;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    const qx = x - x1;
    const qy = y - y1;
    return qx * qx + qy * qy;
  }
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  const qx = x - px;
  const qy = y - py;
  return qx * qx + qy * qy;
}

function simplifyRing(ring: GeoJSON.Position[], tolerance: number): GeoJSON.Position[] {
  if (ring.length <= 2 || tolerance <= 0) return ring.slice();

  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  const closed = first[0] === last[0] && first[1] === last[1] && ring.length > 3;
  const work = closed ? ring.slice(0, -1) : ring.slice();

  const tol2 = tolerance * tolerance;
  const stack: Array<[number, number]> = [[0, work.length - 1]];
  const keep = new Set<number>([0, work.length - 1]);

  while (stack.length > 0) {
    const pair = stack.pop()!;
    let i = pair[0]!;
    let j = pair[1]!;
    let maxD = -1;
    let maxIdx = -1;
    const ai = work[i]!;
    const aj = work[j]!;
    for (let k = i + 1; k < j; k += 1) {
      const d = sqDist(work[k]!, ai, aj);
      if (d > maxD) {
        maxD = d;
        maxIdx = k;
      }
    }
    if (maxIdx !== -1 && maxD > tol2) {
      keep.add(maxIdx);
      stack.push([i, maxIdx], [maxIdx, j]);
    }
  }

  const out: GeoJSON.Position[] = [];
  for (let i = 0; i < work.length; i += 1) {
    if (keep.has(i)) out.push(work[i]!.slice() as GeoJSON.Position);
  }
  if (closed && out.length >= 1) {
    out.push([out[0]![0]!, out[0]![1]!]);
  }
  return out.length >= (closed ? 4 : 3) ? out : ring.slice();
}

function simplifyPolygon(poly: GeoJSON.Polygon, tolerance: number): GeoJSON.Polygon {
  return {
    type: "Polygon",
    coordinates: poly.coordinates.map((ring) => simplifyRing(ring, tolerance)),
  };
}

function simplifyMultiPolygon(mp: GeoJSON.MultiPolygon, tolerance: number): GeoJSON.MultiPolygon {
  return {
    type: "MultiPolygon",
    coordinates: mp.coordinates.map((poly) => poly.map((ring) => simplifyRing(ring, tolerance))),
  };
}

function simplifyGeometry(
  g: GeoJSON.Feature["geometry"],
  tolerance: number
): GeoJSON.Feature["geometry"] {
  if (tolerance <= 0) return g;
  if (g.type === "Polygon") return simplifyPolygon(g, tolerance);
  if (g.type === "MultiPolygon") return simplifyMultiPolygon(g, tolerance);
  return g;
}

/**
 * Tolérance en degrés (4326) pour le surlignage carte — liée au zoom Leaflet.
 */
export function toleranceDegForParcelHighlightZoom(zoom: number): number {
  if (zoom >= 17) return 0;
  if (zoom >= 15) return 1.2e-7;
  if (zoom >= 13) return 3e-7;
  if (zoom >= 11) return 8e-7;
  return 2e-6;
}

/**
 * Simplifie une collection pour l’affichage uniquement (ne modifie pas les features hors polygones).
 */
export function simplifyFeatureCollectionForMapDisplay(
  fc: GeoJSON.FeatureCollection,
  toleranceDeg: number
): GeoJSON.FeatureCollection {
  if (toleranceDeg <= 0) return fc;
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => ({
      ...f,
      geometry: simplifyGeometry(f.geometry, toleranceDeg),
    })),
  };
}
