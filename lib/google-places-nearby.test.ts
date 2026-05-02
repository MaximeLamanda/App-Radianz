import { describe, expect, it } from "vitest";
import {
  parsePlacesNearbyJson,
  buildNearbySearchUrl,
  summarizePlacesNearbyResponse,
} from "./google-places-nearby";

describe("parsePlacesNearbyJson", () => {
  it("OK avec résultats", () => {
    const r = parsePlacesNearbyJson({
      status: "OK",
      results: [
        {
          name: "Café",
          types: ["establishment"],
          geometry: { location: { lat: 44.8, lng: -0.6 } },
        },
      ],
    });
    expect(r.status).toBe("OK");
    expect(r.results).toHaveLength(1);
    expect(r.results[0]?.name).toBe("Café");
  });

  it("ZERO_RESULTS → tableau vide", () => {
    const r = parsePlacesNearbyJson({ status: "ZERO_RESULTS", results: [] });
    expect(r.results).toHaveLength(0);
  });

  it("REQUEST_DENIED → vide et message d’erreur exposé", () => {
    const r = parsePlacesNearbyJson({
      status: "REQUEST_DENIED",
      error_message: "The provided API key is invalid.",
    });
    expect(r.results).toHaveLength(0);
    expect(r.errorMessage).toContain("API key");
  });

  it("OK sans tableau results", () => {
    const r = parsePlacesNearbyJson({ status: "OK" });
    expect(r.results).toHaveLength(0);
  });
});

describe("summarizePlacesNearbyResponse", () => {
  it("expose brut et status", () => {
    const s = summarizePlacesNearbyResponse({
      status: "OK",
      results: [{ name: "A", types: ["establishment"] }],
    });
    expect(s.status).toBe("OK");
    expect(s.rawResultCount).toBe(1);
    expect(s.resultsIfOk).toHaveLength(1);
  });

  it("ZERO_RESULTS: brut 0", () => {
    const s = summarizePlacesNearbyResponse({ status: "ZERO_RESULTS", results: [] });
    expect(s.rawResultCount).toBe(0);
    expect(s.resultsIfOk).toHaveLength(0);
  });
});

describe("buildNearbySearchUrl", () => {
  it("contient location, radius, type, key", () => {
    const u = buildNearbySearchUrl({
      lat: 48.85,
      lng: 2.35,
      radiusM: 150,
      apiKey: "test-key",
      type: "establishment",
    });
    expect(u).toContain("maps.googleapis.com/maps/api/place/nearbysearch/json");
    expect(u).toContain("48.85%2C2.35");
    expect(u).toContain("radius=150");
    expect(u).toContain("type=establishment");
    expect(u).toContain("key=test-key");
  });
});
