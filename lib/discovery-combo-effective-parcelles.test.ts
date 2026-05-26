import { describe, expect, it } from "vitest";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";
import {
  applyDiscoveryParcelleEditToggle,
  emptyDiscoveryComboParcelleEditState,
  parcelleEditStateFromPersistedParcelleIds,
  parcelleIdsForComboMerge,
  resolveDiscoveryEffectiveParcelleRows,
} from "@/lib/discovery-combo-effective-parcelles";

function parcelle(
  partial: Pick<ScoutMatchingV5Row, "id" | "section" | "numeroNorm" | "codeInsee"> & {
    buildingsJson?: string;
  }
): ScoutMatchingV5Row {
  return {
    grain: "parcelle",
    geometry: { type: "Polygon", coordinates: [] },
    label: "",
    batimentConstructionId: null,
    batimentGroupeId: null,
    nbBatiments: 0,
    footprintSumM2: 0,
    sirenStatus: "",
    statusTechnique: "",
    statusMetier: "single",
    siretCount: 0,
    siretsJson: "",
    sirensJson: "",
    matchingConfidence: 0,
    matchingReason: "",
    passerelleAddress: "",
    passerelleAddressesJson: "",
    parcellesJson: "",
    buildingGeometriesJson: "",
    properties: {},
    ...partial,
  } as ScoutMatchingV5Row;
}

describe("parcelleIdsForComboMerge", () => {
  it("fusionne toutes les parcelles du combo partage", () => {
    const partageJson = JSON.stringify([
      { batiment_construction_id: "bc-x", matching_status: "partage" },
    ]);
    const a = parcelle({
      id: "a",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: partageJson,
    });
    const b = parcelle({
      id: "b",
      section: "B",
      numeroNorm: "0002",
      codeInsee: "33318",
      buildingsJson: partageJson,
    });
    const c = parcelle({ id: "c", section: "C", numeroNorm: "0003", codeInsee: "33318" });
    const allRows = [a, b, c];
    expect(parcelleIdsForComboMerge("b", allRows).sort()).toEqual(["a", "b"]);
    expect(parcelleIdsForComboMerge("c", allRows)).toEqual(["c"]);
  });
});

describe("parcelleEditStateFromPersistedParcelleIds", () => {
  it("marque les parcelles retirées du cluster matching", () => {
    const edit = parcelleEditStateFromPersistedParcelleIds(["p1"], ["p1", "p2", "p3"]);
    expect(edit.removedParcelleIds).toEqual(new Set(["p2", "p3"]));
    expect(edit.customParcelleIds.size).toBe(0);
  });

  it("marque les parcelles ajoutées hors cluster matching", () => {
    const edit = parcelleEditStateFromPersistedParcelleIds(["p1", "p4"], ["p1", "p2"]);
    expect(edit.customParcelleIds).toEqual(new Set(["p4"]));
    expect(edit.removedParcelleIds).toEqual(new Set(["p2"]));
  });
});

describe("resolveDiscoveryEffectiveParcelleRows", () => {
  const p1 = parcelle({ id: "p1", section: "A", numeroNorm: "0001", codeInsee: "33318" });
  const p2 = parcelle({ id: "p2", section: "B", numeroNorm: "0002", codeInsee: "33318" });
  const p3 = parcelle({ id: "p3", section: "C", numeroNorm: "0003", codeInsee: "33318" });
  const allRows = [p1, p2, p3];
  const matchingLinked = [p1];

  it("retourne le cluster matching sans édition", () => {
    expect(
      resolveDiscoveryEffectiveParcelleRows(matchingLinked, allRows, emptyDiscoveryComboParcelleEditState())
    ).toEqual([p1]);
  });

  it("ajoute une parcelle orpheline via customParcelleIds", () => {
    const edit = { customParcelleIds: new Set(["p2"]), removedParcelleIds: new Set<string>() };
    const effective = resolveDiscoveryEffectiveParcelleRows(matchingLinked, allRows, edit);
    expect(effective.map((r) => r.id).sort()).toEqual(["p1", "p2"]);
  });

  it("retire une parcelle du matching via removedParcelleIds", () => {
    const partageJson = JSON.stringify([
      { batiment_construction_id: "bc-x", matching_status: "partage" },
    ]);
    const a = parcelle({
      id: "a",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: partageJson,
    });
    const b = parcelle({
      id: "b",
      section: "B",
      numeroNorm: "0002",
      codeInsee: "33318",
      buildingsJson: partageJson,
    });
    const rows = [a, b];
    const linked = [a, b];
    const edit = { customParcelleIds: new Set<string>(), removedParcelleIds: new Set(["b"]) };
    expect(resolveDiscoveryEffectiveParcelleRows(linked, rows, edit).map((r) => r.id)).toEqual(["a"]);
  });

  it("dédoublonne custom déjà présent dans matching", () => {
    const edit = { customParcelleIds: new Set(["p1"]), removedParcelleIds: new Set<string>() };
    const effective = resolveDiscoveryEffectiveParcelleRows(matchingLinked, allRows, edit);
    expect(effective).toHaveLength(1);
    expect(effective[0]?.id).toBe("p1");
  });
});

describe("applyDiscoveryParcelleEditToggle", () => {
  const p1 = parcelle({ id: "p1", section: "A", numeroNorm: "0001", codeInsee: "33318" });
  const p2 = parcelle({ id: "p2", section: "B", numeroNorm: "0002", codeInsee: "33318" });
  const allRows = [p1, p2];
  const effectiveIds = new Set(["p1"]);

  it("ajoute une parcelle voisine au set custom", () => {
    const next = applyDiscoveryParcelleEditToggle(
      emptyDiscoveryComboParcelleEditState(),
      effectiveIds,
      allRows,
      "p2",
      true
    );
    expect(next.customParcelleIds.has("p2")).toBe(true);
    expect(next.removedParcelleIds.size).toBe(0);
  });

  it("retire une parcelle du matching via removed", () => {
    const next = applyDiscoveryParcelleEditToggle(
      emptyDiscoveryComboParcelleEditState(),
      effectiveIds,
      allRows,
      "p1",
      false
    );
    expect(next.removedParcelleIds.has("p1")).toBe(true);
    expect(next.customParcelleIds.has("p1")).toBe(false);
  });

  it("fusion combo : ajout de b tire a et b", () => {
    const partageJson = JSON.stringify([
      { batiment_construction_id: "bc-x", matching_status: "partage" },
    ]);
    const a = parcelle({
      id: "a",
      section: "A",
      numeroNorm: "0001",
      codeInsee: "33318",
      buildingsJson: partageJson,
    });
    const b = parcelle({
      id: "b",
      section: "B",
      numeroNorm: "0002",
      codeInsee: "33318",
      buildingsJson: partageJson,
    });
    const rows = [a, b];
    const next = applyDiscoveryParcelleEditToggle(
      emptyDiscoveryComboParcelleEditState(),
      new Set(["a"]),
      rows,
      "b",
      true
    );
    expect(next.customParcelleIds.has("a")).toBe(false);
    expect(next.customParcelleIds.has("b")).toBe(true);
  });
});
