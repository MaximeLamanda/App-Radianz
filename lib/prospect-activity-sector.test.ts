import { describe, expect, it } from "vitest";
import {
  discoveryZoneTagToActivitySector,
  placeTypeToActivitySector,
  resolveProspectActivitySector,
} from "./prospect-activity-sector";

describe("discoveryZoneTagToActivitySector", () => {
  it("mappe les tags OSM Discovery", () => {
    expect(discoveryZoneTagToActivitySector("industrial")).toBe("industrial");
    expect(discoveryZoneTagToActivitySector("commercial")).toBe("tertiary");
    expect(discoveryZoneTagToActivitySector("retail")).toBe("retail");
    expect(discoveryZoneTagToActivitySector("residential")).toBe("other");
  });
});

describe("placeTypeToActivitySector", () => {
  it("mappe entrepôt et bureau", () => {
    expect(placeTypeToActivitySector("warehouse")).toBe("industrial");
    expect(placeTypeToActivitySector("office")).toBe("tertiary");
    expect(placeTypeToActivitySector("supermarket")).toBe("retail");
  });
});

describe("resolveProspectActivitySector", () => {
  it("priorise discoveryActivityZoneTag", () => {
    expect(
      resolveProspectActivitySector({
        address: "x",
        coordinates: { lat: 0, lng: 0 },
        roofSurface: { area: 1, polygon: [] },
        placeType: "office",
        qualityScore: 0,
        discoveryActivityZoneTag: "industrial",
      })
    ).toBe("industrial");
  });
});
