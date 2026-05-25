import { describe, expect, it } from "vitest";
import {
  buildParcellesAdjacentSearchParams,
  parseParcellesAdjacentRequest,
} from "@/lib/matching-v5-parcelles-adjacent-http";

describe("parseParcellesAdjacentRequest", () => {
  it("refuse sans parcelle_ids", () => {
    const r = parseParcellesAdjacentRequest(new URLSearchParams());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("parse ids, exclude et buffer", () => {
    const r = parseParcellesAdjacentRequest(
      new URLSearchParams({
        parcelle_ids: "p1,p2",
        exclude_ids: "p3",
        buffer_m: "12",
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parcelleIds).toEqual(["p1", "p2"]);
      expect(r.excludeIds).toEqual(["p3"]);
      expect(r.bufferM).toBe(12);
    }
  });

  it("buffer par défaut 5 m", () => {
    const r = parseParcellesAdjacentRequest(new URLSearchParams({ parcelle_ids: "a" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bufferM).toBe(5);
  });

  it("refuse id invalide", () => {
    const r = parseParcellesAdjacentRequest(
      new URLSearchParams({ parcelle_ids: "ok,bad id!" })
    );
    expect(r.ok).toBe(false);
  });
});

describe("buildParcellesAdjacentSearchParams", () => {
  it("sérialise pour fetch client", () => {
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
