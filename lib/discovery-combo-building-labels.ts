import { centroidFromGeoJsonPolygonLike } from "@/lib/matching-v5-google-poi-fallback/centroid-from-geojson";
import {
  parseMatchingV5BuildingsJson,
  type ScoutMatchingV5Row,
  type V5BuildingsJsonEntry,
} from "@/lib/scout-matching-v5-map";
import {
  discoveryBuildingSelectionIdFromEntry,
  discoveryBuildingSelectionIdFromFeature,
  isDiscoveryBuildingEntrySelected,
} from "@/lib/discovery-combo-building-selection";

/** Tri aligné onglet « Bâtiments » du tiroir Discovery (empreinte ↓, puis BC id). */
export function compareV5BuildingsJsonEntriesForDisplay(
  a: V5BuildingsJsonEntry,
  b: V5BuildingsJsonEntry
): number {
  const fa = a.footprintM2;
  const fb = b.footprintM2;
  if (fa == null && fb == null) {
    return a.batimentConstructionId.localeCompare(b.batimentConstructionId, "fr");
  }
  if (fa == null) return 1;
  if (fb == null) return -1;
  if (fb !== fa) return fb - fa;
  return a.batimentConstructionId.localeCompare(b.batimentConstructionId, "fr");
}

function syntheticBuildingEntryFromRow(row: ScoutMatchingV5Row): V5BuildingsJsonEntry | null {
  const bc = row.batimentConstructionId?.trim() || "";
  const bg = row.batimentGroupeId?.trim() || null;
  if (!bc && !bg) return null;

  const props = row.properties ?? {};
  const annRaw = props.annee_construction;
  const ann =
    typeof annRaw === "number" && Number.isFinite(annRaw)
      ? annRaw
      : (() => {
          const n = Number(String(annRaw ?? "").trim());
          return Number.isFinite(n) ? n : null;
        })();
  const fpRaw = props.footprint_m2;
  const fpFromProps =
    typeof fpRaw === "number" && Number.isFinite(fpRaw)
      ? fpRaw
      : (() => {
          const n = Number(String(fpRaw ?? "").trim());
          return Number.isFinite(n) ? n : null;
        })();
  const footprintM2 = fpFromProps ?? (row.footprintSumM2 > 0 ? row.footprintSumM2 : null);
  const ms = String(props.matching_status ?? "").trim();
  const md = String(props.matching_decision ?? "").trim();
  const mss = String(props.matching_siren_selected ?? "").trim();

  return {
    batimentConstructionId: bc || "—",
    batimentGroupeId: bg,
    anneeConstruction: ann,
    footprintM2,
    intersectionAreaM2: null,
    matchingStatus: ms || "—",
    matchingDecision: md,
    matchingSirenSelected: mss,
  };
}

/**
 * Bâtiments du combo triés comme dans le tiroir (`buildingDetailRows`).
 * Dédupliqués par `batiment_construction_id` sur le cluster parcelle.
 */
export function collectSortedDiscoveryComboBuildingEntries(
  parcelleCluster: readonly ScoutMatchingV5Row[],
  anchorRow: ScoutMatchingV5Row
): V5BuildingsJsonEntry[] {
  const byBc = new Map<string, V5BuildingsJsonEntry>();
  for (const pr of parcelleCluster.length > 0 ? parcelleCluster : []) {
    for (const b of parseMatchingV5BuildingsJson(pr.buildingsJson)) {
      if (!byBc.has(b.batimentConstructionId)) byBc.set(b.batimentConstructionId, b);
    }
  }

  let raw: V5BuildingsJsonEntry[];
  if (byBc.size > 0) {
    raw = Array.from(byBc.values());
  } else {
    const parsed = parseMatchingV5BuildingsJson(anchorRow.buildingsJson);
    if (parsed.length > 0) {
      raw = parsed;
    } else if (anchorRow.grain !== "building") {
      raw = [];
    } else {
      const synthetic = syntheticBuildingEntryFromRow(anchorRow);
      raw = synthetic ? [synthetic] : [];
    }
  }

  return [...raw].sort(compareV5BuildingsJsonEntriesForDisplay);
}

/** Empreinte d’un bâtiment, repli sur une autre parcelle du cluster si absente. */
function footprintM2ForBuildingEntry(
  entry: V5BuildingsJsonEntry,
  parcelleCluster: readonly ScoutMatchingV5Row[]
): number {
  const direct = entry.footprintM2;
  if (direct != null && Number.isFinite(direct) && direct > 0) return direct;
  const bc = entry.batimentConstructionId.trim();
  if (!bc || bc === "—") return 0;
  for (const pr of parcelleCluster) {
    for (const b of parseMatchingV5BuildingsJson(pr.buildingsJson)) {
      if (b.batimentConstructionId.trim() !== bc) continue;
      const fp = b.footprintM2;
      if (fp != null && Number.isFinite(fp) && fp > 0) return fp;
    }
  }
  return 0;
}

export type DiscoveryComboBuildingNumberLabel = {
  number: number;
  lat: number;
  lng: number;
  batimentConstructionId: string;
  osmBuildingId?: string;
  selectionId: string;
};

function footprintFromFeatureProps(props: Record<string, unknown> | undefined): number | null {
  const raw = props?.footprint_m2;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function compareBuildingFeaturesForDisplay(
  a: GeoJSON.Feature,
  b: GeoJSON.Feature
): number {
  const fa = footprintFromFeatureProps(a.properties as Record<string, unknown> | undefined);
  const fb = footprintFromFeatureProps(b.properties as Record<string, unknown> | undefined);
  const bcA = String((a.properties as Record<string, unknown> | undefined)?.batiment_construction_id ?? "").trim();
  const bcB = String((b.properties as Record<string, unknown> | undefined)?.batiment_construction_id ?? "").trim();
  if (fa == null && fb == null) return bcA.localeCompare(bcB, "fr");
  if (fa == null) return 1;
  if (fb == null) return -1;
  if (fb !== fa) return fb - fa;
  return bcA.localeCompare(bcB, "fr");
}

function labelFromFeature(
  feature: GeoJSON.Feature,
  number: number
): DiscoveryComboBuildingNumberLabel | null {
  const geom = feature.geometry;
  if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") return null;
  const c = centroidFromGeoJsonPolygonLike(geom);
  if (!c) return null;
  const props = feature.properties as Record<string, unknown> | undefined;
  const bc = String(props?.batiment_construction_id ?? "").trim();
  const osmId = String(props?.osm_building_id ?? "").trim();
  return {
    number,
    lat: c.lat,
    lng: c.lng,
    batimentConstructionId: bc || `feature-${number}`,
    osmBuildingId: osmId || undefined,
    selectionId: discoveryBuildingSelectionIdFromFeature(feature),
  };
}

/**
 * Numéros 1…N au centroïde de chaque empreinte surlignée.
 * Ordre = `collectSortedDiscoveryComboBuildingEntries` ; repli sur tri empreinte des features GeoJSON.
 */
export function buildDiscoveryComboBuildingNumberLabels(
  parcelleCluster: readonly ScoutMatchingV5Row[],
  anchorRow: ScoutMatchingV5Row | null,
  buildingFc: GeoJSON.FeatureCollection
): DiscoveryComboBuildingNumberLabel[] {
  if (!anchorRow || buildingFc.features.length === 0) return [];

  const polygonFeatures = buildingFc.features.filter(
    (f): f is GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> =>
      f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"
  );
  if (polygonFeatures.length === 0) return [];

  const sortedEntries = collectSortedDiscoveryComboBuildingEntries(parcelleCluster, anchorRow);
  const bcToNumber = new Map<string, number>();
  for (let i = 0; i < sortedEntries.length; i++) {
    const bc = sortedEntries[i]!.batimentConstructionId.trim();
    if (!bc || bc === "—" || bcToNumber.has(bc)) continue;
    bcToNumber.set(bc, i + 1);
  }

  const labels: DiscoveryComboBuildingNumberLabel[] = [];
  const seenBc = new Set<string>();

  for (const feature of polygonFeatures) {
    const props = feature.properties as Record<string, unknown> | undefined;
    const bc = String(props?.batiment_construction_id ?? "").trim();
    const number = bc && bc !== "—" ? bcToNumber.get(bc) : undefined;
    if (number == null || seenBc.has(bc)) continue;
    const label = labelFromFeature(feature, number);
    if (!label) continue;
    seenBc.add(bc);
    labels.push(label);
  }

  if (labels.length > 0 || sortedEntries.length === 0) {
    return labels.sort((a, b) => a.number - b.number);
  }

  const orphans = [...polygonFeatures].sort(compareBuildingFeaturesForDisplay);
  let nextNumber = 1;
  for (const feature of orphans) {
    const props = feature.properties as Record<string, unknown> | undefined;
    const bc = String(props?.batiment_construction_id ?? "").trim();
    if (bc && seenBc.has(bc)) continue;
    const label = labelFromFeature(feature, nextNumber);
    if (!label) continue;
    if (bc) seenBc.add(bc);
    labels.push(label);
    nextNumber += 1;
  }

  return labels.sort((a, b) => a.number - b.number);
}

/** Tous les bâtiments du combo sélectionnés par défaut. */
export function defaultDiscoveryComboBuildingSelectionIds(
  parcelleCluster: readonly ScoutMatchingV5Row[],
  anchorRow: ScoutMatchingV5Row,
  buildingFc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] }
): Set<string> {
  const ids = new Set<string>();
  for (const entry of collectSortedDiscoveryComboBuildingEntries(parcelleCluster, anchorRow)) {
    const id = discoveryBuildingSelectionIdFromEntry(entry);
    if (id) ids.add(id);
  }
  for (const feature of buildingFc.features) {
    const id = discoveryBuildingSelectionIdFromFeature(feature);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Σ empreintes des bâtiments cochés.
 * `null` si pas de filtre (`selectedBuildingIds` absent) → utiliser `footprintSumTotalFromV5`.
 * `0` si filtre actif mais aucun bâtiment coché.
 */
export function discoveryComboFootprintSumM2(
  parcelleCluster: readonly ScoutMatchingV5Row[],
  anchorRow: ScoutMatchingV5Row,
  selectedBuildingIds?: ReadonlySet<string> | null
): number | null {
  if (selectedBuildingIds == null) return null;
  const entries = collectSortedDiscoveryComboBuildingEntries(parcelleCluster, anchorRow);
  let sum = 0;
  let counted = false;
  for (const e of entries) {
    if (!isDiscoveryBuildingEntrySelected(selectedBuildingIds, e)) continue;
    counted = true;
    sum += footprintM2ForBuildingEntry(e, parcelleCluster);
  }
  return counted ? sum : 0;
}
