import { describe, expect, it } from "vitest";
import { discoveryPipelinePerimeterPersistFields } from "@/lib/discovery-pipeline-perimeter-persist";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";

function parcelleRow(id: string): ScoutMatchingV5Row {
  return {
    id,
    grain: "parcelle",
    geometry: { type: "Point", coordinates: [0, 0] },
    label: id,
    batimentConstructionId: null,
    batimentGroupeId: null,
    codeInsee: "33318",
    section: "AB",
    numeroNorm: "0001",
    nbBatiments: 0,
    footprintSumM2: 100,
    sirenStatus: "",
    statusTechnique: "",
    statusMetier: "none",
    siretCount: 0,
    siretsJson: "",
    sirensJson: "",
    matchingConfidence: 0,
    matchingReason: "",
    passerelleAddress: "",
    passerelleAddressesJson: "",
    parcellesJson: "",
    buildingsJson: "",
    buildingGeometriesJson: "",
    properties: {},
  };
}

describe("discoveryPipelinePerimeterPersistFields", () => {
  it("dérive matchingV5ParcelleIds et matchingV5ComboId depuis le cluster effectif", () => {
    const anchor = parcelleRow("parcelle:33318:AB:0001");
    const linked = [anchor, parcelleRow("parcelle:33318:AB:0002")];
    const { matchingV5ParcelleIds, matchingV5ComboId } = discoveryPipelinePerimeterPersistFields(
      anchor,
      linked
    );
    expect(matchingV5ParcelleIds).toEqual([
      "parcelle:33318:AB:0001",
      "parcelle:33318:AB:0002",
    ]);
    expect(matchingV5ComboId).toBe(
      "combo:parcelle:33318:AB:0001|parcelle:33318:AB:0002"
    );
  });

  it("utilise fallbackComboId si aucune parcelle", () => {
    const anchor = {
      ...parcelleRow("bc:1"),
      grain: "building" as const,
    };
    const { matchingV5ParcelleIds, matchingV5ComboId } = discoveryPipelinePerimeterPersistFields(
      anchor,
      [],
      { fallbackComboId: "combo:legacy" }
    );
    expect(matchingV5ParcelleIds).toEqual([]);
    expect(matchingV5ComboId).toBe("combo:legacy");
  });
});
