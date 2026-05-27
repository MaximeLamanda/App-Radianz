import { describe, expect, it } from "vitest";
import {
  approximateMapBoundsAreaM2,
  buildParcellesAdjacentBboxSearchParams,
  buildParcellesAdjacentSearchParams,
  isMapBoundsAreaAllowed,
  parseParcellesAdjacentRequest,
  PARCELLES_ADJACENT_MAX_BBOX_AREA_M2,
} from "@/lib/matching-v5-parcelles-adjacent-http";

describe("parseParcellesAdjacentRequest", () => {
  it("refuse sans parcelle_ids ni bbox", () => {
    const r = parseParcellesAdjacentRequest(new URLSearchParams());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("parse mode anchor (ids, exclude, buffer)", () => {
    const r = parseParcellesAdjacentRequest(
      new URLSearchParams({
        parcelle_ids: "p1,p2",
        exclude_ids: "p3",
        buffer_m: "12",
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.mode === "anchor") {
      expect(r.parcelleIds).toEqual(["p1", "p2"]);
      expect(r.excludeIds).toEqual(["p3"]);
      expect(r.bufferM).toBe(12);
    }
  });

  it("buffer par défaut 5 m en mode anchor", () => {
    const r = parseParcellesAdjacentRequest(new URLSearchParams({ parcelle_ids: "a" }));
    expect(r.ok).toBe(true);
    if (r.ok && r.mode === "anchor") expect(r.bufferM).toBe(5);
  });

  it("refuse id invalide", () => {
    const r = parseParcellesAdjacentRequest(
      new URLSearchParams({ parcelle_ids: "ok,bad id!" })
    );
    expect(r.ok).toBe(false);
  });

  it("parse mode bbox", () => {
    const r = parseParcellesAdjacentRequest(
      new URLSearchParams({
        swLat: "44.8000",
        swLng: "-0.6000",
        neLat: "44.8008",
        neLng: "-0.5992",
        code_insee: "33318",
        exclude_ids: "parcelle:33318:AB:0001",
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.mode === "bbox") {
      expect(r.codeInsee).toEqual(["33318"]);
      expect(r.excludeIds).toEqual(["parcelle:33318:AB:0001"]);
      expect(r.bounds.sw.lat).toBeCloseTo(44.8);
      expect(r.bounds.ne.lat).toBeCloseTo(44.8008);
    }
  });

  it("refuse bbox trop grande", () => {
    const r = parseParcellesAdjacentRequest(
      new URLSearchParams({
        swLat: "44.0",
        swLng: "-1.0",
        neLat: "45.0",
        neLng: "0.0",
        code_insee: "33318",
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/BBox trop grande/i);
  });

  it("priorise bbox si coords présentes", () => {
    const r = parseParcellesAdjacentRequest(
      new URLSearchParams({
        swLat: "44.8000",
        swLng: "-0.6000",
        neLat: "44.8008",
        neLng: "-0.5992",
        code_insee: "33318",
        parcelle_ids: "p1",
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mode).toBe("bbox");
  });
});

describe("buildParcellesAdjacentSearchParams", () => {
  it("sérialise mode anchor", () => {
    const sp = buildParcellesAdjacentSearchParams({
      parcelleIds: ["p1"],
      excludeIds: ["p2"],
      bufferM: 8,
    });
    expect(sp.get("parcelle_ids")).toBe("p1");
    expect(sp.get("exclude_ids")).toBe("p2");
    expect(sp.get("buffer_m")).toBe("8");
  });
});

describe("buildParcellesAdjacentBboxSearchParams", () => {
  it("sérialise bbox + code_insee", () => {
    const sp = buildParcellesAdjacentBboxSearchParams({
      bounds: { sw: { lat: 1, lng: 2 }, ne: { lat: 3, lng: 4 } },
      codeInsee: ["33318", "33063"],
      excludeIds: ["p1"],
    });
    expect(sp.get("swLat")).toBe("1");
    expect(sp.get("neLng")).toBe("4");
    expect(sp.get("code_insee")).toBe("33318,33063");
    expect(sp.get("exclude_ids")).toBe("p1");
  });
});

describe("approximateMapBoundsAreaM2", () => {
  it("autorise une petite bbox", () => {
    const bounds = { sw: { lat: 44.8, lng: -0.6 }, ne: { lat: 44.801, lng: -0.599 } };
    expect(approximateMapBoundsAreaM2(bounds)).toBeLessThan(PARCELLES_ADJACENT_MAX_BBOX_AREA_M2);
    expect(isMapBoundsAreaAllowed(bounds)).toBe(true);
  });
});
