import { describe, expect, it } from "vitest";

import { shouldClearBillMonthToBaseline } from "@/lib/prospect-share-bill-input";

describe("shouldClearBillMonthToBaseline", () => {
  it("retourne false pour un blur vide sur un mois jamais modifie", () => {
    expect(
      shouldClearBillMonthToBaseline({
        normalized: "",
        isValid: false,
        baselineMonth: 1200,
        monthWasEdited: false,
      })
    ).toBe(false);
  });

  it("retourne true pour un blur vide sur un mois deja modifie", () => {
    expect(
      shouldClearBillMonthToBaseline({
        normalized: "",
        isValid: false,
        baselineMonth: 1200,
        monthWasEdited: true,
      })
    ).toBe(true);
  });

  it("retourne false quand la saisie est valide", () => {
    expect(
      shouldClearBillMonthToBaseline({
        normalized: "3.2",
        isValid: true,
        baselineMonth: 1200,
        monthWasEdited: true,
      })
    ).toBe(false);
  });
});
