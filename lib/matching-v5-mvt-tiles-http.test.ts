import { describe, expect, it } from "vitest";
import {
  buildMvtWeakEtag,
  ifNoneMatchSatisfied,
  SCOUT_BUILDINGS_MVT_CACHE_CONTROL,
} from "@/lib/matching-v5-mvt-tiles-http";

describe("buildMvtWeakEtag", () => {
  it("change quand le corps change", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 4]);
    const ea = buildMvtWeakEtag("v1", 10, 5, 6, a);
    const eb = buildMvtWeakEtag("v1", 10, 5, 6, b);
    expect(ea).not.toBe(eb);
  });

  it("change quand la révision change", () => {
    const body = new Uint8Array([0]);
    expect(buildMvtWeakEtag("a", 10, 0, 0, body)).not.toBe(buildMvtWeakEtag("b", 10, 0, 0, body));
  });
});

describe("ifNoneMatchSatisfied", () => {
  it("retourne vrai pour égalité exacte (faible)", () => {
    const etag = buildMvtWeakEtag("0", 8, 10, 20, new Uint8Array([7]));
    expect(ifNoneMatchSatisfied(etag, etag)).toBe(true);
  });

  it("accepte If-None-Match avec plusieurs ETags", () => {
    const etag = buildMvtWeakEtag("0", 8, 10, 20, new Uint8Array([7]));
    const header = `"stale", ${etag}`;
    expect(ifNoneMatchSatisfied(header, etag)).toBe(true);
  });

  it("retourne vrai pour *", () => {
    const etag = buildMvtWeakEtag("0", 8, 0, 0, new Uint8Array());
    expect(ifNoneMatchSatisfied("*", etag)).toBe(true);
  });

  it("retourne faux sans header", () => {
    expect(ifNoneMatchSatisfied(null, 'W/"x"')).toBe(false);
  });
});

describe("SCOUT_BUILDINGS_MVT_CACHE_CONTROL", () => {
  it("est private avec max-age", () => {
    expect(SCOUT_BUILDINGS_MVT_CACHE_CONTROL).toContain("private");
    expect(SCOUT_BUILDINGS_MVT_CACHE_CONTROL).toMatch(/max-age=\d+/);
  });
});
