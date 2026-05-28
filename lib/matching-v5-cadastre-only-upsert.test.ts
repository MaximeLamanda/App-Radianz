import { describe, expect, it } from "vitest";
import { resolveCadastreOnlyNextMatchStatus } from "@/lib/matching-v5-cadastre-only-upsert";

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
