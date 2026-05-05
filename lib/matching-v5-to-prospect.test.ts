import { describe, expect, it } from "vitest";
import type { PanelReference } from "@/types";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";
import {
  discoveryCentroidFromV5,
  discoveryScoreDisplayFromV5,
  footprintSumTotalFromV5,
  getParcelleClusterForV5,
  matchingV5RowsToProspectDraft,
  parcelContourAreaM2FromV5Row,
} from "@/lib/matching-v5-to-prospect";

const testPanel: PanelReference = {
  id: "panel-test",
  name: "Test panel",
  panelType: "monocrystalline",
  powerW: 400,
  efficiencyPercent: 20,
  countryOfOrigin: "FR",
  costEur: 200,
};

function rowParcelle(
  id: string,
  footprint: number,
  confidence: number,
  ring: number[][]
): ScoutMatchingV5Row {
  return {
    id,
    grain: "parcelle",
    geometry: { type: "Polygon", coordinates: [ring] },
    label: `Label ${id}`,
    batimentConstructionId: null,
    batimentGroupeId: null,
    codeInsee: "33318",
    section: "A",
    numeroNorm: "0001",
    codeIris: "",
    nomIris: "",
    nbBatiments: 0,
    footprintSumM2: footprint,
    sirenStatus: "",
    statusTechnique: "",
    statusMetier: "single",
    siretCount: 0,
    siretsJson: "",
    sirensJson: "",
    matchingConfidence: confidence,
    matchingReason: "",
    passerelleAddress: "12 rue du Test 33600 Pessac",
    passerelleAddressesJson: "",
    parcellesJson: "",
    buildingsJson: "",
    buildingGeometriesJson: "",
    properties: {},
  };
}

const ringPessac: number[][] = [
  [-0.62, 44.8],
  [-0.61, 44.8],
  [-0.61, 44.81],
  [-0.62, 44.81],
  [-0.62, 44.8],
];

describe("getParcelleClusterForV5", () => {
  it("retourne les parcelles liées quand il y en a", () => {
    const p1 = rowParcelle("p1", 100, 50, ringPessac);
    const p2 = rowParcelle("p2", 200, 60, ringPessac);
    const b = { ...p1, id: "b1", grain: "building" as const };
    expect(getParcelleClusterForV5(b, [p1, p2])).toEqual([p1, p2]);
  });

  it("retourne la parcelle seule si grain parcelle sans liées", () => {
    const p = rowParcelle("p1", 100, 50, ringPessac);
    expect(getParcelleClusterForV5(p, [])).toEqual([p]);
  });
});

describe("footprintSumTotalFromV5", () => {
  it("somme les empreintes du cluster", () => {
    const p1 = rowParcelle("p1", 100, 50, ringPessac);
    const p2 = rowParcelle("p2", 250, 60, ringPessac);
    const b = { ...p1, id: "b1", grain: "building" as const };
    expect(footprintSumTotalFromV5(b, [p1, p2])).toBe(350);
  });
});

describe("discoveryScoreDisplayFromV5", () => {
  it("prend le max des confiances sur le cluster", () => {
    const p1 = rowParcelle("p1", 100, 42, ringPessac);
    const p2 = rowParcelle("p2", 100, 88, ringPessac);
    const b = { ...p1, id: "b1", grain: "building" as const, matchingConfidence: 30 };
    expect(discoveryScoreDisplayFromV5(b, [p1, p2])).toBe(88);
  });
});

describe("discoveryCentroidFromV5", () => {
  it("retourne un centroïde valide", () => {
    const p = rowParcelle("p1", 500, 70, ringPessac);
    const c = discoveryCentroidFromV5(p, [p]);
    expect(c).not.toBeNull();
    expect(c!.lat).toBeGreaterThan(44.7);
    expect(c!.lat).toBeLessThan(44.9);
    expect(c!.lng).toBeLessThan(-0.59);
    expect(c!.lng).toBeGreaterThan(-0.64);
  });
});

describe("parcelContourAreaM2FromV5Row", () => {
  it("somme les aires des polygones du cluster parcelle", () => {
    const p1 = rowParcelle("p1", 100, 50, ringPessac);
    const p2 = rowParcelle("p2", 200, 60, ringPessac);
    const b = { ...p1, id: "b1", grain: "building" as const };
    const a = parcelContourAreaM2FromV5Row(b, [p1, p2]);
    expect(a).toBeGreaterThan(0);
    expect(Math.round(a)).toBe(
      Math.round(parcelContourAreaM2FromV5Row(p1, [p1]) + parcelContourAreaM2FromV5Row(p2, [p2]))
    );
  });
});

describe("matchingV5RowsToProspectDraft", () => {
  it("remplit pipelineEntrySource, matchingV5RowId, qualityScore et adresse", () => {
    const p = rowParcelle("row-abc", 800, 73, ringPessac);
    const draft = matchingV5RowsToProspectDraft(p, [p], { panelRef: testPanel });
    expect(draft.pipelineEntrySource).toBe("discovery_v5");
    expect(draft.matchingV5RowId).toBe("row-abc");
    expect(draft.qualityScore).toBe(73);
    expect(draft.address).toContain("Pessac");
    expect(draft.placeType).toBe("other");
    expect(draft.roofSurfaces?.[0]?.area).toBe(800);
    expect(draft.roofSurfaces?.[0]?.orientation).toBeDefined();
    expect(typeof draft.roofSurfaces?.[0]?.orientation).toBe("number");
    expect(draft.solarPotential?.estimatedKwp).toBeGreaterThan(0);
    expect(draft.parcelContourAreaM2).toBeDefined();
    expect(draft.parcelContourAreaM2!).toBeGreaterThan(0);
    expect(draft.bdnbFootprintSumM2).toBe(800);
  });

  it("sans PVGIS fourni, expose quand même estimatedKwp et surface", () => {
    const p = rowParcelle("p2", 400, 50, ringPessac);
    const draft = matchingV5RowsToProspectDraft(p, null, { panelRef: testPanel });
    expect(draft.solarPotential?.estimatedKwp).toBeGreaterThan(0);
    expect(draft.solarPotential?.maxArrayAreaMeters2).toBe(400);
  });
});
