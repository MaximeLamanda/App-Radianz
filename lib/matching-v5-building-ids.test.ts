import { describe, expect, it } from "vitest";
import { splitMatchingV5BuildingIds } from "./matching-v5-building-ids";

describe("splitMatchingV5BuildingIds", () => {
  it("sépare construction_id et groupe_id + déduplique", () => {
    const out = splitMatchingV5BuildingIds([
      "bdnb-bg-AAAA:1",
      "bdnb-bg-AAAA",
      "bdnb-bg-AAAA:1",
      "  bdnb-bg-BBBB  ",
      "",
      "   ",
    ]);

    expect(out.constructionIds).toEqual(["bdnb-bg-AAAA:1"]);
    expect(out.groupIds).toEqual(["bdnb-bg-AAAA", "bdnb-bg-BBBB"]);
  });

  it("accepte un id préfixé bdnbcstr", () => {
    const out = splitMatchingV5BuildingIds(["bdnbcstr:bdnb-bg-XYZ:2"]);
    expect(out.constructionIds).toEqual(["bdnb-bg-XYZ:2"]);
    expect(out.groupIds).toEqual([]);
  });
});
