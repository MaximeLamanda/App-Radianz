import { describe, expect, it } from "vitest";
import {
  isCadastreOnlyUpsertEnabledForCodeInsee,
  resolveCadastreOnlyNextMatchStatus,
} from "@/lib/matching-v5-cadastre-only-upsert";

describe("resolveCadastreOnlyNextMatchStatus", () => {
  it("conserve matched quand deja present", () => {
    expect(resolveCadastreOnlyNextMatchStatus("matched")).toBe("matched");
  });

  it("passe en cadastre_only sinon", () => {
    expect(resolveCadastreOnlyNextMatchStatus("cadastre_only")).toBe("cadastre_only");
    expect(resolveCadastreOnlyNextMatchStatus(null)).toBe("cadastre_only");
    expect(resolveCadastreOnlyNextMatchStatus("")).toBe("cadastre_only");
  });
});

describe("isCadastreOnlyUpsertEnabledForCodeInsee", () => {
  it("active uniquement Pessac (33318)", () => {
    expect(isCadastreOnlyUpsertEnabledForCodeInsee("33318")).toBe(true);
    expect(isCadastreOnlyUpsertEnabledForCodeInsee(" 33318 ")).toBe(true);
    expect(isCadastreOnlyUpsertEnabledForCodeInsee("33063")).toBe(false);
    expect(isCadastreOnlyUpsertEnabledForCodeInsee(null)).toBe(false);
  });
});

describe("upsertCadastreOnlyParcelles SQL", () => {
  it("conserve properties_json des parcelles deja matched (pas d ecrasement cadastre)", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [], rowCount: 0 };
      },
    };
    const { upsertCadastreOnlyParcelles } = await import("@/lib/matching-v5-cadastre-only-upsert");
    await upsertCadastreOnlyParcelles({
      client: client as never,
      matchingTable: { schema: "public", table: "scout_matching_v5_features" },
      parcelles: [
        {
          scoutV5Id: "parcelle:33318:HH:0005",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-0.655, 44.783],
                [-0.654, 44.783],
                [-0.654, 44.784],
                [-0.655, 44.784],
                [-0.655, 44.783],
              ],
            ],
          },
          codeInsee: "33318",
          section: "HH",
          numeroNorm: "0005",
        },
      ],
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("WHEN COALESCE");
    expect(queries[0]).toMatch(/THEN "public"\."scout_matching_v5_features"\.properties_json/);
    expect(queries[0]).not.toContain("properties_json = EXCLUDED.properties_json");
  });
});
