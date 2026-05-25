import { describe, expect, it } from "vitest";
import {
  DISCOVERY_BUILDINGS_OVERVIEW_CLIENT_LIMIT,
  DISCOVERY_BUILDINGS_OVERVIEW_FETCH_DEBOUNCE_MS,
  DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM,
  DISCOVERY_VIEWPORT_FETCH_DEBOUNCE_MS,
  isMatchingOverviewZoom,
  matchingDataModeFromZoom,
} from "@/lib/discovery-zoom-modes";

describe("discovery-zoom-modes", () => {
  it("borne overview buildings sous l’ancien plafond client 22k", () => {
    expect(DISCOVERY_BUILDINGS_OVERVIEW_CLIENT_LIMIT).toBeLessThan(22_000);
    expect(DISCOVERY_BUILDINGS_OVERVIEW_CLIENT_LIMIT).toBeGreaterThan(0);
  });

  it("expose un debounce overview positif", () => {
    expect(DISCOVERY_BUILDINGS_OVERVIEW_FETCH_DEBOUNCE_MS).toBeGreaterThan(0);
  });

  it("aligne le debounce viewport features sur l’émission bbox carte", () => {
    expect(DISCOVERY_VIEWPORT_FETCH_DEBOUNCE_MS).toBe(500);
  });

  it("dérive le mode matching depuis le zoom", () => {
    expect(matchingDataModeFromZoom(DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM)).toBe("overview");
    expect(matchingDataModeFromZoom(DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM + 1)).toBe("detail");
    expect(isMatchingOverviewZoom(DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM)).toBe(true);
    expect(isMatchingOverviewZoom(DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM + 0.1)).toBe(false);
  });
});
