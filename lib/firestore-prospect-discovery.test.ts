import { describe, expect, it } from "vitest";
import { prepareProspectForFirestore, prospectFromFirestore } from "./firestore-prospect";
import type { Prospect, ProspectContact } from "@/types";

describe("prepareProspectForFirestore discovery combo", () => {
  it("persiste matchingV5ParcelleIds et matchingV5BuildingSelectionIds", () => {
    const prospect: Prospect = {
      address: "1 rue Test",
      coordinates: { lat: 44.8, lng: -0.6 },
      roofSurface: { area: 500, polygon: [] },
      placeType: "other",
      qualityScore: 80,
      pipelineEntrySource: "discovery_v5",
      matchingV5RowId: "parcelle-ancre",
      matchingV5ComboId: "combo:p1|p2",
      matchingV5ParcelleIds: ["p1", "p2", "p3"],
      matchingV5BuildingSelectionIds: ["bc:1", "osm:w2"],
      parcelContourAreaM2: 10_495,
      bdnbFootprintSumM2: 2539,
    };

    const doc = prepareProspectForFirestore(prospect, undefined, "user-1");
    expect(doc.matchingV5ParcelleIds).toEqual(["p1", "p2", "p3"]);
    expect(doc.matchingV5BuildingSelectionIds).toEqual(["bc:1", "osm:w2"]);
    expect(doc.parcelContourAreaM2).toBe(10495);
    expect(doc.bdnbFootprintSumM2).toBe(2539);

    const roundtrip = prospectFromFirestore("doc-1", doc);
    expect(roundtrip.matchingV5ComboId).toBe("combo:p1|p2");
    expect(roundtrip.matchingV5ParcelleIds).toEqual(["p1", "p2", "p3"]);
    expect(roundtrip.matchingV5BuildingSelectionIds).toEqual(["bc:1", "osm:w2"]);
  });

  it("persiste et relit les contacts Discovery", () => {
    const manualContact: ProspectContact = {
      id: "manual-1",
      fullName: "Jean Dupont",
      email: "jean@example.com",
      source: "manual",
      originKind: "parcelle",
      originRef: "parc-1",
      originLabel: "HN 0011 · 33318",
      createdAt: new Date("2026-05-26T10:00:00Z"),
      updatedAt: new Date("2026-05-26T10:00:00Z"),
    };
    const prospect: Prospect = {
      address: "1 rue Test",
      coordinates: { lat: 44.8, lng: -0.6 },
      roofSurface: { area: 500, polygon: [] },
      placeType: "other",
      qualityScore: 80,
      contacts: [manualContact],
    };

    const doc = prepareProspectForFirestore(prospect, undefined, "user-1");
    expect(doc.contacts).toHaveLength(1);
    expect(doc.contacts?.[0]?.fullName).toBe("Jean Dupont");
    expect(doc.contacts?.[0]?.createdAt).toBeDefined();

    const roundtrip = prospectFromFirestore("doc-1", doc);
    expect(roundtrip.contacts).toHaveLength(1);
    expect(roundtrip.contacts?.[0]?.fullName).toBe("Jean Dupont");
    expect(roundtrip.contacts?.[0]?.email).toBe("jean@example.com");
    expect(roundtrip.contacts?.[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("resynchronise maxKwhPerYear quand estimatedKwp est fourni", () => {
    const prospect: Prospect = {
      address: "1 rue Test",
      coordinates: { lat: 44.8, lng: -0.6 },
      placeType: "other",
      qualityScore: 80,
      solarPotential: {
        maxArrayPanelsCount: 0,
        maxSunshineHoursPerYear: 1400,
        maxArrayAreaMeters2: 500,
        maxKwhPerYear: 900_000,
        estimatedKwp: 800,
        productionPerKwpAnnual: 1200,
        productionPerKwpMonthly: Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          production: 100,
        })),
      },
    };
    const doc = prepareProspectForFirestore(prospect, { estimatedKwp: 50 }, "user-1");
    expect(doc.solarPotential?.estimatedKwp).toBe(50);
    expect(doc.solarPotential?.maxKwhPerYear).toBe(
      Array.from({ length: 12 }, () => Math.round(100 * 50)).reduce((a, b) => a + b, 0)
    );
  });
});
