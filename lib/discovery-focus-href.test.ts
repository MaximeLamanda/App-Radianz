import { describe, expect, it } from "vitest";
import {
  buildDiscoveryFocusHref,
  comboIdForDiscoveryFocusRow,
  DISCOVERY_FOCUS_QUERY,
  selectionFromDiscoveryUrlFocus,
} from "@/lib/discovery-focus-href";
import { buildDiscoveryComboMarkers } from "@/lib/discovery-combo-markers";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";
import type { Prospect } from "@/types";

function parcelle(id: string): ScoutMatchingV5Row {
  return {
    id,
    grain: "parcelle",
    geometry: { type: "Point", coordinates: [0, 0] },
    section: "A",
    numeroNorm: "0001",
    codeInsee: "33318",
    buildingsJson: "[]",
    buildingGeometriesJson: null,
  } as ScoutMatchingV5Row;
}

describe("buildDiscoveryFocusHref", () => {
  it("inclut focusCombo quand matchingV5ComboId est renseigné", () => {
    const href = buildDiscoveryFocusHref({
      pipelineEntrySource: "discovery_v5",
      matchingV5RowId: "parcelle:p1",
      matchingV5ComboId: "combo:p1|p2",
      coordinates: { lat: 44.8, lng: -0.62 },
    } as Prospect);
    expect(href).toContain(`${DISCOVERY_FOCUS_QUERY.focusCombo}=combo%3Ap1%7Cp2`);
    expect(href).toContain("focusRow=parcelle%3Ap1");
  });
});

describe("selectionFromDiscoveryUrlFocus", () => {
  it("préfère focusCombo et résout ancre via marqueurs", () => {
    const rows = [parcelle("p1")];
    const markers = buildDiscoveryComboMarkers(rows, []);
    const sel = selectionFromDiscoveryUrlFocus({
      focusComboId: "combo:p1",
      focusRowId: "p1",
      rows,
      markers,
    });
    expect(sel?.comboId).toBe("combo:p1");
    expect(sel?.anchorParcelleId).toBe("p1");
  });

  it("dérive le combo depuis focusRow si focusCombo absent", () => {
    const rows = [parcelle("p1")];
    const markers = buildDiscoveryComboMarkers(rows, []);
    const comboId = comboIdForDiscoveryFocusRow("p1", rows, markers);
    expect(comboId).toBe("combo:p1");
    const sel = selectionFromDiscoveryUrlFocus({
      focusComboId: null,
      focusRowId: "p1",
      rows,
      markers,
    });
    expect(sel?.comboId).toBe("combo:p1");
  });
});
