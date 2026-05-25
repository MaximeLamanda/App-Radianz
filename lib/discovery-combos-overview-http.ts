import {
  DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT,
  discoveryFootprintRatioHiEffective,
  discoveryFootprintRatioPctToUnit,
} from "@/lib/discovery-footprint-ratio-defaults";
import { DISCOVERY_SURFACE_SLIDER_MAX_M2 } from "@/lib/discovery-surface-defaults";
import { discoverySurfaceHiEffective } from "@/lib/discovery-footprint-landuse-waiver";

export type CombosOverviewSurfaceFilterInput = {
  minFootprintM2: number;
  maxFootprintM2: number;
  sliderMaxM2?: number;
};

export type CombosOverviewSurfaceWhereResult = {
  sqlFragments: string[];
  params: number[];
  /** Prochain index `$n` Postgres après les fragments surface. */
  nextParamIndex: number;
};

/**
 * Clauses SQL footprint : somme combo uniquement (pas de dérogation landuse — contrairement à l’export matching).
 */
export function buildCombosOverviewSurfaceWhere(
  input: CombosOverviewSurfaceFilterInput,
  startParamIndex: number
): CombosOverviewSurfaceWhereResult {
  const sliderMax = input.sliderMaxM2 ?? DISCOVERY_SURFACE_SLIDER_MAX_M2;
  const min = Number.isFinite(input.minFootprintM2) ? Math.max(0, input.minFootprintM2) : 0;
  const max = Number.isFinite(input.maxFootprintM2) ? input.maxFootprintM2 : sliderMax;
  const hiEffective = discoverySurfaceHiEffective(max, sliderMax);

  const sqlFragments: string[] = [];
  const params: number[] = [];
  let p = startParamIndex;

  if (min > 0) {
    sqlFragments.push(`footprint_sum_m2 > $${p}`);
    params.push(min);
    p += 1;
  }

  if (Number.isFinite(hiEffective)) {
    sqlFragments.push(`footprint_sum_m2 <= $${p}`);
    params.push(hiEffective);
    p += 1;
  }

  return { sqlFragments, params, nextParamIndex: p };
}

export type CombosOverviewParkingFilterInput = {
  minParkingM2: number;
  maxParkingM2: number;
  sliderMaxM2?: number;
};

export type CombosOverviewParkingWhereResult = CombosOverviewSurfaceWhereResult;

export type CombosOverviewFootprintRatioFilterInput = {
  minRatioPct: number;
  maxRatioPct: number;
  sliderMaxPct?: number;
};

const FOOTPRINT_PARCEL_RATIO_SQL =
  "(footprint_sum_m2 / NULLIF(parcel_contour_sum_m2, 0))";

/** Proportion empreinte building / surface parcelle (sommes combo). */
export function buildCombosOverviewFootprintRatioWhere(
  input: CombosOverviewFootprintRatioFilterInput,
  startParamIndex: number
): CombosOverviewSurfaceWhereResult {
  const sliderMax = input.sliderMaxPct ?? DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT;
  const minPct = Number.isFinite(input.minRatioPct)
    ? Math.max(0, input.minRatioPct)
    : 0;
  const maxPct = Number.isFinite(input.maxRatioPct) ? input.maxRatioPct : sliderMax;
  const hiEffective = discoveryFootprintRatioHiEffective(maxPct, sliderMax);
  const minUnit = discoveryFootprintRatioPctToUnit(minPct);
  const maxUnit = Number.isFinite(hiEffective)
    ? discoveryFootprintRatioPctToUnit(hiEffective)
    : Number.POSITIVE_INFINITY;

  const sqlFragments: string[] = [];
  const params: number[] = [];
  let p = startParamIndex;

  if (minUnit > 0) {
    sqlFragments.push(`parcel_contour_sum_m2 > 0`);
    sqlFragments.push(`${FOOTPRINT_PARCEL_RATIO_SQL} > $${p}`);
    params.push(minUnit);
    p += 1;
  }

  if (Number.isFinite(maxUnit)) {
    sqlFragments.push(`parcel_contour_sum_m2 > 0`);
    sqlFragments.push(`${FOOTPRINT_PARCEL_RATIO_SQL} <= $${p}`);
    params.push(maxUnit);
    p += 1;
  }

  return { sqlFragments, params, nextParamIndex: p };
}

/** Clauses SQL parking_sum_m2 (somme parkings distincts du combo). */
export function buildCombosOverviewParkingWhere(
  input: CombosOverviewParkingFilterInput,
  startParamIndex: number
): CombosOverviewParkingWhereResult {
  const sliderMax = input.sliderMaxM2 ?? DISCOVERY_SURFACE_SLIDER_MAX_M2;
  const min = Number.isFinite(input.minParkingM2) ? Math.max(0, input.minParkingM2) : 0;
  const max = Number.isFinite(input.maxParkingM2) ? input.maxParkingM2 : sliderMax;
  const hiEffective = discoverySurfaceHiEffective(max, sliderMax);

  const sqlFragments: string[] = [];
  const params: number[] = [];
  let p = startParamIndex;

  if (min > 0) {
    sqlFragments.push(`parking_sum_m2 > $${p}`);
    params.push(min);
    p += 1;
  }

  if (Number.isFinite(hiEffective)) {
    sqlFragments.push(`parking_sum_m2 <= $${p}`);
    params.push(hiEffective);
    p += 1;
  }

  return { sqlFragments, params, nextParamIndex: p };
}

export type CombosOverviewSirenRole = "owner" | "domiciliation";

const SIREN_EXACT_RE = /^\d{9}$/;
const NAF_DIVISION_RE = /^\d{2}$/;

export function isCombosOverviewSirenExact(siren: string): boolean {
  return SIREN_EXACT_RE.test(siren.trim());
}

export function isCombosOverviewNafDivision(division: string): boolean {
  return NAF_DIVISION_RE.test(division.trim());
}

export type CombosOverviewSirenFilterInput = {
  role: CombosOverviewSirenRole;
  siren: string;
};

export function buildCombosOverviewSirenWhere(
  input: CombosOverviewSirenFilterInput,
  startParamIndex: number
): CombosOverviewSurfaceWhereResult {
  const col = input.role === "owner" ? "owner_sirens" : "domiciliation_sirens";
  return {
    sqlFragments: [`$${startParamIndex} = ANY(${col})`],
    params: [input.siren.trim()],
    nextParamIndex: startParamIndex + 1,
  };
}

export type CombosOverviewNafDivisionFilterInput = {
  division: string;
};

export function buildCombosOverviewNafDivisionWhere(
  input: CombosOverviewNafDivisionFilterInput,
  startParamIndex: number
): CombosOverviewSurfaceWhereResult {
  return {
    sqlFragments: [`$${startParamIndex} = ANY(naf_divisions)`],
    params: [input.division.trim()],
    nextParamIndex: startParamIndex + 1,
  };
}

/** Paramètres query string pour `/api/matching-v5/combos-overview`. */
export function buildCombosOverviewSearchParams(input: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  minFootprintM2?: number;
  maxFootprintM2?: number;
  minParkingM2?: number;
  maxParkingM2?: number;
  minFootprintRatioPct?: number;
  maxFootprintRatioPct?: number;
  sirenRole?: CombosOverviewSirenRole;
  siren?: string;
  nafDivision?: string;
  limit?: number;
}): URLSearchParams {
  const p = new URLSearchParams();
  p.set("minLat", String(input.minLat));
  p.set("maxLat", String(input.maxLat));
  p.set("minLng", String(input.minLng));
  p.set("maxLng", String(input.maxLng));
  if (input.minFootprintM2 != null && Number.isFinite(input.minFootprintM2)) {
    p.set("minFootprintM2", String(input.minFootprintM2));
  }
  if (input.maxFootprintM2 != null && Number.isFinite(input.maxFootprintM2)) {
    p.set("maxFootprintM2", String(input.maxFootprintM2));
  }
  if (input.minParkingM2 != null && Number.isFinite(input.minParkingM2)) {
    p.set("minParkingM2", String(input.minParkingM2));
  }
  if (input.maxParkingM2 != null && Number.isFinite(input.maxParkingM2)) {
    p.set("maxParkingM2", String(input.maxParkingM2));
  }
  if (input.minFootprintRatioPct != null && Number.isFinite(input.minFootprintRatioPct)) {
    p.set("minFootprintRatioPct", String(input.minFootprintRatioPct));
  }
  if (input.maxFootprintRatioPct != null && Number.isFinite(input.maxFootprintRatioPct)) {
    p.set("maxFootprintRatioPct", String(input.maxFootprintRatioPct));
  }
  if (input.sirenRole && input.siren && isCombosOverviewSirenExact(input.siren)) {
    p.set("sirenRole", input.sirenRole);
    p.set("siren", input.siren.trim());
  }
  if (input.nafDivision != null && isCombosOverviewNafDivision(input.nafDivision)) {
    p.set("nafDivision", input.nafDivision.trim());
  }
  if (input.limit != null && Number.isFinite(input.limit)) {
    p.set("limit", String(Math.trunc(input.limit)));
  }
  return p;
}
