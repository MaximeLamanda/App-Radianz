/**
 * Prospect pipeline depuis la sélection Discovery (matching V5).
 * Aligné sur les agrégations du drawer (`ProspectDrawerDiscoverySection`).
 */

import { latLngFromMatchingGeometry } from "@/lib/matching-v5-google-poi-fallback/centroid-from-geojson";
import { polygonAreaM2ApproxWithPointFallback, polygonAreaM2ApproxWgs84 } from "@/lib/geojson-polygon-area-m2";
import {
  centroidWeightedFromParcelleRowGeometries,
  confirmedDisplayAddressFromRow,
  footprintSumM2DedupedFromParcelleCluster,
  parsePasserelleAddressesJson,
  parseSiretsMatchJson,
  type ScoutMatchingV5Row,
} from "@/lib/scout-matching-v5-map";
import { pvgisAzimuthFromFootprintGeometry } from "@/lib/footprint-orientation-pvgis";
import { computeDiscoveryKwpEstForPipeline } from "@/lib/discovery-pipeline-add-financials";
import { getProductionFromPerKwp, type PVGISData } from "@/lib/pvgis";
import type { AddressCoordinates, PanelReference, Prospect, RoofSurface, SolarPotential } from "@/types";

const DEFAULT_USABLE_ROOF_RATIO = 0.75;

/** kWp sans accès `window` / localStorage (SSR-safe). Même formule que `surfaceToKwp`. */
function estimateKwpFromFootprintM2(
  areaM2: number,
  panelRef?: PanelReference | null,
  usableRatio: number = DEFAULT_USABLE_ROOF_RATIO
): number {
  if (areaM2 <= 0) return 0;
  const ratio = Math.max(0.01, Math.min(1, usableRatio));
  const efficiency = panelRef?.efficiencyPercent ?? 20;
  const usableAreaM2 = areaM2 * ratio;
  const powerKwPerM2 = efficiency / 100;
  const kwp = usableAreaM2 * powerKwPerM2;
  return Math.round(kwp * 100) / 100;
}

/** Centre par défaut (Pessac) si géométrie invalide — évite doc Firestore sans coordonnées. */
export const DISCOVERY_FALLBACK_CENTER: AddressCoordinates = { lat: 44.8067, lng: -0.6311 };

export function getParcelleClusterForV5(
  row: ScoutMatchingV5Row,
  linkedParcelleRows: ScoutMatchingV5Row[] | null | undefined
): ScoutMatchingV5Row[] {
  const linked = linkedParcelleRows ?? [];
  const filtered = linked.filter((r) => r.grain === "parcelle");
  if (filtered.length > 0) return filtered;
  if (row.grain === "parcelle") return [row];
  return [];
}

export function footprintSumTotalFromV5(
  row: ScoutMatchingV5Row,
  parcelleCluster: ScoutMatchingV5Row[]
): number {
  if (parcelleCluster.length > 0) {
    const deduped = footprintSumM2DedupedFromParcelleCluster(parcelleCluster);
    if (deduped != null) return deduped;
    return parcelleCluster.reduce((s, p) => s + p.footprintSumM2, 0);
  }
  return row.footprintSumM2;
}

/** Aire contour parcelle(s) sur la carte (m²), même logique que le tiroir Discovery. */
export function parcelContourAreaM2FromV5Row(
  row: ScoutMatchingV5Row,
  parcelleCluster: ScoutMatchingV5Row[]
): number {
  if (parcelleCluster.length === 0) {
    return polygonAreaM2ApproxWithPointFallback(row.geometry, row.footprintSumM2);
  }
  return parcelleCluster.reduce(
    (sum, p) => sum + polygonAreaM2ApproxWithPointFallback(p.geometry, p.footprintSumM2),
    0
  );
}

export function discoveryScoreDisplayFromV5(
  row: ScoutMatchingV5Row,
  parcelleCluster: ScoutMatchingV5Row[]
): number {
  if (parcelleCluster.length === 0) {
    return Math.round(Math.max(0, row.matchingConfidence));
  }
  const m = Math.max(...parcelleCluster.map((p) => p.matchingConfidence), row.matchingConfidence);
  return Math.round(Math.max(0, m));
}

export function discoveryCentroidFromV5(
  row: ScoutMatchingV5Row,
  parcelleCluster: ScoutMatchingV5Row[]
): AddressCoordinates | null {
  const w = centroidWeightedFromParcelleRowGeometries(parcelleCluster);
  if (w) return { lat: w.lat, lng: w.lng };
  const c = latLngFromMatchingGeometry(row.geometry);
  if (!c) return null;
  return { lat: c.lat, lng: c.lng };
}

function outerRingLatLngPolygon(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): Array<{ lat: number; lng: number }> {
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates[0] ?? [];
    return ring.map(([lng, lat]) => ({ lat, lng }));
  }
  const first = geometry.coordinates[0]?.[0] ?? [];
  return first.map(([lng, lat]) => ({ lat, lng }));
}

function syntheticRoofSurface(areaM2: number, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): RoofSurface {
  const polygon = outerRingLatLngPolygon(geometry);
  const orientation = pvgisAzimuthFromFootprintGeometry(geometry);
  return {
    id: "discovery-footprint",
    area: Math.max(0, areaM2),
    polygon: polygon.length >= 3 ? polygon : [],
    ...(orientation != null ? { orientation } : {}),
  };
}

function syntheticRoofSurfaceFromMatchingRow(areaM2: number, row: ScoutMatchingV5Row): RoofSurface {
  const g = row.geometry;
  if (g.type === "Point") {
    const c = latLngFromMatchingGeometry(g);
    if (!c) {
      return { id: "discovery-footprint", area: Math.max(0, areaM2), polygon: [] };
    }
    const d = 0.00005;
    const polygon = [
      { lat: c.lat - d, lng: c.lng - d },
      { lat: c.lat - d, lng: c.lng + d },
      { lat: c.lat + d, lng: c.lng },
    ];
    return { id: "discovery-footprint", area: Math.max(0, areaM2), polygon };
  }
  return syntheticRoofSurface(areaM2, g);
}

function collectSiretsUnique(row: ScoutMatchingV5Row, parcelleCluster: ScoutMatchingV5Row[]) {
  const seen = new Set<string>();
  const out: ReturnType<typeof parseSiretsMatchJson> = [];
  const addFrom = (r: ScoutMatchingV5Row) => {
    for (const e of parseSiretsMatchJson(r.siretsJson)) {
      if (seen.has(e.siret)) continue;
      seen.add(e.siret);
      out.push(e);
    }
  };
  for (const pr of parcelleCluster) addFrom(pr);
  if (row.grain === "building") addFrom(row);
  if (out.length === 0 && row.grain === "parcelle" && parcelleCluster.length === 0) addFrom(row);
  return out;
}

function primaryAddress(row: ScoutMatchingV5Row, parcelleCluster: ScoutMatchingV5Row[]): string {
  const cluster = parcelleCluster.length > 0 ? parcelleCluster : [row];
  for (const r of cluster) {
    const confirmed = confirmedDisplayAddressFromRow(r);
    if (confirmed) return confirmed;
  }
  const rowConfirmed = confirmedDisplayAddressFromRow(row);
  if (rowConfirmed) return rowConfirmed;
  const fromRow = String(row.passerelleAddress || "").trim();
  if (fromRow) return fromRow;
  for (const pr of parcelleCluster.length > 0 ? parcelleCluster : [row]) {
    for (const p of parsePasserelleAddressesJson(pr.passerelleAddressesJson)) {
      const a = String(p.address || "").trim();
      if (a) return a;
    }
  }
  const label = String(row.label || "").trim();
  if (label) return label;
  return "Adresse inconnue";
}

function displayName(row: ScoutMatchingV5Row, parcelleCluster: ScoutMatchingV5Row[]): string {
  const sirets = collectSiretsUnique(row, parcelleCluster);
  const firstDen = sirets.find((e) => String(e.denomination || "").trim())?.denomination?.trim();
  if (firstDen) return firstDen;
  const label = String(row.label || "").trim();
  if (label) return label;
  return primaryAddress(row, parcelleCluster);
}

function companyFieldsFromSirets(row: ScoutMatchingV5Row, parcelleCluster: ScoutMatchingV5Row[]) {
  const sirets = collectSiretsUnique(row, parcelleCluster);
  const first = sirets[0];
  if (!first) return {};
  return {
    siret: first.siret?.trim() || undefined,
    siren: first.siren?.trim() || undefined,
    companyLegalName: first.denomination?.trim() || undefined,
    companyAddress: first.adresse_etablissement?.trim() || undefined,
    companyNaf: first.activite_principale?.trim() || undefined,
    companyTrancheEffectif: first.tranche_effectifs?.trim() || undefined,
  };
}

function buildSolarPotential(
  pvgis: PVGISData | null | undefined,
  footprintM2: number,
  kwp: number
): SolarPotential | undefined {
  if (footprintM2 <= 0 || kwp <= 0) return undefined;

  const productionPerKwpMonthly = pvgis
    ? pvgis.monthlyProduction.map((m) => ({
        month: m.month,
        production: Math.max(0, m.production),
      }))
    : undefined;

  const productionPerKwpAnnual = pvgis ? Math.max(0, pvgis.annualProduction) : undefined;

  if (
    pvgis &&
    productionPerKwpAnnual != null &&
    productionPerKwpAnnual > 0 &&
    productionPerKwpMonthly &&
    productionPerKwpMonthly.length > 0
  ) {
    const { monthlyProduction } = getProductionFromPerKwp(
      productionPerKwpAnnual,
      productionPerKwpMonthly,
      kwp
    );
    const maxKwhPerYear = monthlyProduction.reduce((sum, m) => sum + m.production, 0);
    return {
      maxArrayPanelsCount: 0,
      maxSunshineHoursPerYear: Math.round(pvgis.sunshineHoursEquivalent),
      maxArrayAreaMeters2: footprintM2,
      maxKwhPerYear,
      estimatedKwp: kwp,
      productionPerKwpAnnual,
      productionPerKwpMonthly,
      optimalInclination: pvgis.optimalInclination,
      optimalAzimuth: pvgis.optimalAzimuth,
      annualIrradiation: pvgis.annualIrradiation,
      monthlyIrradiation: pvgis.monthlyIrradiation,
      monthlyProduction,
      pvgisDataFetched: true,
    };
  }

  return {
    maxArrayPanelsCount: 0,
    maxSunshineHoursPerYear: 0,
    maxArrayAreaMeters2: footprintM2,
    estimatedKwp: kwp,
    maxKwhPerYear: 0,
  };
}

export interface MatchingV5ToProspectDraftOptions {
  /** Panneau recommandé (client) ; en tests passer un panneau fictif pour un kWp stable. */
  panelRef?: PanelReference | null;
  /** Données PVGIS déjà chargées dans le drawer (évite un second appel si fourni). */
  pvgisData?: PVGISData | null;
  /** Clé combo Discovery (`combo:…`) pour rattachement pipeline strict. */
  matchingV5ComboId?: string;
  /** Périmètre parcelles personnalisé (session édition combo). */
  matchingV5ParcelleIds?: string[];
  /** Bâtiments cochés (`bc:` / `osm:`). */
  matchingV5BuildingSelectionIds?: string[];
  /** Empreinte Σ si filtre bâtiments actif (sinon calcul classique). */
  footprintSumM2Override?: number;
  /** Surface parcelle(s) (m²) alignée tiroir / combo effectif. */
  parcelContourM2Override?: number;
}

/**
 * Brouillon `Prospect` pour `addProspectToPipeline` — source Discovery uniquement.
 */
export function matchingV5RowsToProspectDraft(
  row: ScoutMatchingV5Row,
  linkedParcelleRows: ScoutMatchingV5Row[] | null | undefined,
  options?: MatchingV5ToProspectDraftOptions
): Prospect {
  const parcelleCluster = getParcelleClusterForV5(row, linkedParcelleRows);
  const parcelContourM2 =
    options?.parcelContourM2Override != null &&
    Number.isFinite(options.parcelContourM2Override)
      ? options.parcelContourM2Override
      : parcelContourAreaM2FromV5Row(row, parcelleCluster);
  const footprintSum =
    options?.footprintSumM2Override != null && Number.isFinite(options.footprintSumM2Override)
      ? options.footprintSumM2Override
      : footprintSumTotalFromV5(row, parcelleCluster);
  const centroid = discoveryCentroidFromV5(row, parcelleCluster);
  const coordinates = centroid ?? DISCOVERY_FALLBACK_CENTER;
  const pvgis = options?.pvgisData ?? null;
  const kwp =
    pvgis && pvgis.annualProduction > 0
      ? computeDiscoveryKwpEstForPipeline({
          footprintM2: footprintSum,
          pvgisAnnualPerKwp: pvgis.annualProduction,
          panelRef: options?.panelRef ?? null,
          placeType: "other",
        })
      : estimateKwpFromFootprintM2(footprintSum, options?.panelRef ?? null);
  const roofSurface = syntheticRoofSurfaceFromMatchingRow(footprintSum, row);
  const address = primaryAddress(row, parcelleCluster);
  const name = displayName(row, parcelleCluster);
  const qualityScore = discoveryScoreDisplayFromV5(row, parcelleCluster);
  const company = companyFieldsFromSirets(row, parcelleCluster);

  const solarPotential = buildSolarPotential(pvgis, footprintSum, kwp);

  const base: Prospect = {
    address,
    name,
    coordinates,
    roofSurface,
    roofSurfaces: footprintSum > 0 ? [roofSurface] : undefined,
    placeType: "other",
    qualityScore,
    pipelineStatus: "cree",
    configurationMode: "perfect_fit",
    pipelineEntrySource: "discovery_v5",
    matchingV5RowId: row.id,
    ...(options?.matchingV5ComboId?.trim()
      ? { matchingV5ComboId: options.matchingV5ComboId.trim() }
      : {}),
    ...(options?.matchingV5ParcelleIds?.length
      ? { matchingV5ParcelleIds: [...options.matchingV5ParcelleIds] }
      : {}),
    ...(options?.matchingV5BuildingSelectionIds?.length
      ? { matchingV5BuildingSelectionIds: [...options.matchingV5BuildingSelectionIds] }
      : {}),
    ...company,
    ...(solarPotential ? { solarPotential } : {}),
    ...(parcelContourM2 > 0 ? { parcelContourAreaM2: Math.round(parcelContourM2) } : {}),
    ...(footprintSum > 0 ? { bdnbFootprintSumM2: Math.round(footprintSum) } : {}),
  };

  return base;
}
