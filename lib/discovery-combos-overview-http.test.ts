import { describe, expect, it } from "vitest";
import {
  buildCombosOverviewFootprintRatioWhere,
  buildCombosOverviewNafDivisionWhere,
  buildCombosOverviewParkingWhere,
  buildCombosOverviewSearchParams,
  buildCombosOverviewSirenWhere,
  buildCombosOverviewSurfaceWhere,
  isCombosOverviewNafDivision,
  isCombosOverviewSirenExact,
} from "./discovery-combos-overview-http";
import { DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT } from "./discovery-footprint-ratio-defaults";
import { DISCOVERY_SURFACE_SLIDER_MAX_M2 } from "./discovery-surface-defaults";

describe("buildCombosOverviewSurfaceWhere", () => {
  it("n’ajoute pas de clause si filtre désactivé", () => {
    const r = buildCombosOverviewSurfaceWhere(
      { minFootprintM2: 0, maxFootprintM2: DISCOVERY_SURFACE_SLIDER_MAX_M2 },
      5
    );
    expect(r.sqlFragments).toEqual([]);
    expect(r.params).toEqual([]);
    expect(r.nextParamIndex).toBe(5);
  });

  it("filtre min sur footprint_sum_m2 uniquement (sans dérogation landuse)", () => {
    const r = buildCombosOverviewSurfaceWhere({ minFootprintM2: 400, maxFootprintM2: 50_000 }, 5);
    expect(r.sqlFragments[0]).toBe("footprint_sum_m2 > $5");
    expect(r.sqlFragments[0]).not.toContain("has_landuse_waiver");
    expect(r.params[0]).toBe(400);
  });

  it("borne haute ouverte au plafond slider", () => {
    const r = buildCombosOverviewSurfaceWhere(
      { minFootprintM2: 0, maxFootprintM2: DISCOVERY_SURFACE_SLIDER_MAX_M2 },
      1
    );
    expect(r.sqlFragments.some((s) => s.includes("<="))).toBe(false);
  });

  it("borne haute fermée sous le plafond slider", () => {
    const r = buildCombosOverviewSurfaceWhere({ minFootprintM2: 0, maxFootprintM2: 20_000 }, 3);
    expect(r.sqlFragments).toContain("footprint_sum_m2 <= $3");
    expect(r.params[0]).toBe(20_000);
  });
});

describe("buildCombosOverviewFootprintRatioWhere", () => {
  it("n’ajoute pas de clause si filtre désactivé (0–100 %)", () => {
    const r = buildCombosOverviewFootprintRatioWhere(
      { minRatioPct: 0, maxRatioPct: DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT },
      3
    );
    expect(r.sqlFragments).toEqual([]);
    expect(r.params).toEqual([]);
  });

  it("filtre min sur footprint_sum_m2 / parcel_contour_sum_m2", () => {
    const r = buildCombosOverviewFootprintRatioWhere({ minRatioPct: 25, maxRatioPct: 100 }, 2);
    expect(r.sqlFragments.some((s) => s.includes("footprint_sum_m2 / NULLIF(parcel_contour_sum_m2"))).toBe(
      true
    );
    expect(r.sqlFragments.some((s) => s.includes("> $2"))).toBe(true);
    expect(r.params[0]).toBeCloseTo(0.25);
  });

  it("borne haute fermée sous 100 %", () => {
    const r = buildCombosOverviewFootprintRatioWhere({ minRatioPct: 0, maxRatioPct: 60 }, 4);
    expect(r.sqlFragments.some((s) => s.includes("<= $4"))).toBe(true);
    expect(r.params[0]).toBeCloseTo(0.6);
  });
});

describe("buildCombosOverviewParkingWhere", () => {
  it("filtre min sur parking_sum_m2", () => {
    const r = buildCombosOverviewParkingWhere({ minParkingM2: 500, maxParkingM2: 50_000 }, 7);
    expect(r.sqlFragments[0]).toBe("parking_sum_m2 > $7");
    expect(r.params[0]).toBe(500);
  });

  it("borne haute fermée sous le plafond slider", () => {
    const r = buildCombosOverviewParkingWhere({ minParkingM2: 0, maxParkingM2: 10_000 }, 2);
    expect(r.sqlFragments).toContain("parking_sum_m2 <= $2");
    expect(r.params[0]).toBe(10_000);
  });
});

describe("buildCombosOverviewSirenWhere", () => {
  it("filtre owner_sirens", () => {
    const r = buildCombosOverviewSirenWhere({ role: "owner", siren: "123456789" }, 3);
    expect(r.sqlFragments[0]).toBe("$3 = ANY(owner_sirens)");
    expect(r.params[0]).toBe("123456789");
  });

  it("filtre domiciliation_sirens", () => {
    const r = buildCombosOverviewSirenWhere({ role: "domiciliation", siren: "987654321" }, 2);
    expect(r.sqlFragments[0]).toBe("$2 = ANY(domiciliation_sirens)");
  });
});

describe("buildCombosOverviewNafDivisionWhere", () => {
  it("filtre naf_divisions", () => {
    const r = buildCombosOverviewNafDivisionWhere({ division: "47" }, 4);
    expect(r.sqlFragments[0]).toBe("$4 = ANY(naf_divisions)");
    expect(r.params[0]).toBe("47");
  });
});

describe("siren / naf validation", () => {
  it("valide SIREN 9 chiffres", () => {
    expect(isCombosOverviewSirenExact("123456789")).toBe(true);
    expect(isCombosOverviewSirenExact("12345678")).toBe(false);
  });

  it("valide division NAF 2 chiffres", () => {
    expect(isCombosOverviewNafDivision("47")).toBe(true);
    expect(isCombosOverviewNafDivision("4")).toBe(false);
  });
});

describe("buildCombosOverviewSearchParams", () => {
  it("inclut bbox et seuils surface", () => {
    const p = buildCombosOverviewSearchParams({
      minLat: 44,
      maxLat: 45,
      minLng: -1,
      maxLng: 0,
      minFootprintM2: 400,
      maxFootprintM2: 20_000,
      limit: 16_000,
    });
    expect(p.get("minFootprintM2")).toBe("400");
    expect(p.get("maxFootprintM2")).toBe("20000");
    expect(p.get("limit")).toBe("16000");
  });

  it("inclut seuils parking", () => {
    const p = buildCombosOverviewSearchParams({
      minLat: 44,
      maxLat: 45,
      minLng: -1,
      maxLng: 0,
      minParkingM2: 500,
      maxParkingM2: 20_000,
    });
    expect(p.get("minParkingM2")).toBe("500");
    expect(p.get("maxParkingM2")).toBe("20000");
  });

  it("inclut seuils proportion empreinte", () => {
    const p = buildCombosOverviewSearchParams({
      minLat: 44,
      maxLat: 45,
      minLng: -1,
      maxLng: 0,
      minFootprintRatioPct: 20,
      maxFootprintRatioPct: 80,
    });
    expect(p.get("minFootprintRatioPct")).toBe("20");
    expect(p.get("maxFootprintRatioPct")).toBe("80");
  });

  it("inclut SIREN et division NAF", () => {
    const p = buildCombosOverviewSearchParams({
      minLat: 44,
      maxLat: 45,
      minLng: -1,
      maxLng: 0,
      sirenRole: "domiciliation",
      siren: "123456789",
      nafDivision: "47",
    });
    expect(p.get("sirenRole")).toBe("domiciliation");
    expect(p.get("siren")).toBe("123456789");
    expect(p.get("nafDivision")).toBe("47");
  });

  it("ignore SIREN incomplet", () => {
    const p = buildCombosOverviewSearchParams({
      minLat: 44,
      maxLat: 45,
      minLng: -1,
      maxLng: 0,
      sirenRole: "owner",
      siren: "123",
    });
    expect(p.get("siren")).toBeNull();
  });
});
