import { describe, expect, it } from "vitest";
import { isParcIndustrielIris } from "./matching-v5-iris-zones";

describe("isParcIndustrielIris", () => {
  it("accepte le libellé exact (casse)", () => {
    expect(isParcIndustrielIris("Parc industriel")).toBe(true);
    expect(isParcIndustrielIris("PARC INDUSTRIEL")).toBe(true);
  });

  it("refuse vide, nan et autres libellés", () => {
    expect(isParcIndustrielIris("")).toBe(false);
    expect(isParcIndustrielIris("  ")).toBe(false);
    expect(isParcIndustrielIris("NaN")).toBe(false);
    expect(isParcIndustrielIris("Zone d'activités")).toBe(false);
    expect(isParcIndustrielIris("Centre-ville")).toBe(false);
  });
});
