import { describe, expect, it } from "vitest";
import { getScoutMatchingV5TableRef } from "./scout-matching-v5-table";

describe("getScoutMatchingV5TableRef", () => {
  it("défaut public.scout_matching_v5_features", () => {
    const r = getScoutMatchingV5TableRef("public.scout_matching_v5_features");
    expect(r.schema).toBe("public");
    expect(r.table).toBe("scout_matching_v5_features");
    expect(r.qualifiedSql).toBe(`"public"."scout_matching_v5_features"`);
  });

  it("table seule → schéma public", () => {
    const r = getScoutMatchingV5TableRef("scout_matching_v5_features");
    expect(r.schema).toBe("public");
    expect(r.table).toBe("scout_matching_v5_features");
  });

  it("rejette identifiants invalides", () => {
    expect(() => getScoutMatchingV5TableRef("bad-schema.scout_matching_v5_features")).toThrow();
  });
});
