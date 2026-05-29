import { describe, expect, it } from "vitest";
import type { InverterReference } from "@/types";
import { calculateInverterCount } from "@/lib/solar-settings";
import {
  MAX_RECOMMENDED_INVERTER_COUNT,
  pickRecommendedInverterReference,
} from "@/lib/recommended-inverter-sizing";

function inv(id: string, powerW: number, recommended = false): InverterReference {
  return {
    id,
    name: id,
    inverterType: "string_inverter",
    powerW,
    efficiencyPercent: 98,
    countryOfOrigin: "FR",
    costEur: 1000,
    recommended,
    visible: true,
  };
}

describe("pickRecommendedInverterReference", () => {
  it("privilégie le recommandé catalogue s'il respecte la limite", () => {
    const small = inv("small", 10_000);
    const large = inv("large", 100_000, true);
    const picked = pickRecommendedInverterReference(50, [small, large]);
    expect(picked?.id).toBe("large");
  });

  it("choisit un modèle plus puissant si le recommandé catalogue dépasse 8 unités", () => {
    const weakRecommended = inv("weak", 10_000, true);
    const strong = inv("strong", 150_000);
    const picked = pickRecommendedInverterReference(900, [weakRecommended, strong]);
    expect(calculateInverterCount(900, picked!)).toBeLessThanOrEqual(MAX_RECOMMENDED_INVERTER_COUNT);
    expect(picked?.id).toBe("strong");
  });

  it("retombe sur le premier de la liste si aucun modèle ne respecte la limite", () => {
    const a = inv("a", 5_000);
    const b = inv("b", 6_000);
    const picked = pickRecommendedInverterReference(500, [a, b]);
    expect(picked?.id).toBe("a");
  });
});
