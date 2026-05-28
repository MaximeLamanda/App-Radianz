import { describe, expect, it } from "vitest";
import type { InverterReference } from "@/types";
import {
  getInvertersAddableFromCatalog,
  mergeInverterFromCatalogForUser,
} from "./inverter-catalog-availability";

const catalogA: InverterReference = {
  id: "a",
  name: "Alpha",
  inverterType: "string_inverter",
  powerW: 10_000,
  efficiencyPercent: 98,
  countryOfOrigin: "FR",
  costEur: 1000,
  imageUrl: "/a.png",
};

const catalogB: InverterReference = {
  id: "b",
  name: "Beta",
  inverterType: "string_inverter",
  powerW: 150_000,
  efficiencyPercent: 99,
  countryOfOrigin: "CN",
  costEur: 18_000,
};

describe("getInvertersAddableFromCatalog", () => {
  it("liste les modèles absents ou masqués", () => {
    const user: InverterReference[] = [
      { ...catalogA, visible: true },
      { ...catalogB, visible: false },
    ];
    const addable = getInvertersAddableFromCatalog([catalogA, catalogB], user);
    expect(addable).toHaveLength(1);
    expect(addable[0]?.catalogRef.id).toBe("b");
    expect(addable[0]?.action).toBe("restore");
  });

  it("exclut les modèles déjà visibles", () => {
    const user: InverterReference[] = [{ ...catalogA, visible: true }];
    const addable = getInvertersAddableFromCatalog([catalogA, catalogB], user);
    expect(addable.map((x) => x.catalogRef.id)).toEqual(["b"]);
    expect(addable[0]?.action).toBe("add");
  });
});

describe("mergeInverterFromCatalogForUser", () => {
  it("réactive avec les données catalogue", () => {
    const existing: InverterReference = {
      ...catalogB,
      visible: false,
      costEur: 999,
      recommended: true,
    };
    const merged = mergeInverterFromCatalogForUser(catalogB, existing);
    expect(merged.visible).toBe(true);
    expect(merged.costEur).toBe(18_000);
    expect(merged.recommended).toBe(true);
    expect(merged.imageUrl).toBeUndefined();
  });
});
