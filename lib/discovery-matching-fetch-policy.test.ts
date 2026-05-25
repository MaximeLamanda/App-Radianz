import { describe, expect, it } from "vitest";
import {
  shouldSkipDiscoveryFetch,
  shouldSkipMatchingFeaturesFetch,
} from "@/lib/discovery-matching-fetch-policy";

const vb = (sw: [number, number], ne: [number, number]) => ({
  sw: { lat: sw[0], lng: sw[1] },
  ne: { lat: ne[0], lng: ne[1] },
});

describe("shouldSkipDiscoveryFetch (alias historique shouldSkipMatchingFeaturesFetch)", () => {
  it("expose les deux noms (alias)", () => {
    expect(shouldSkipMatchingFeaturesFetch).toBe(shouldSkipDiscoveryFetch);
  });
  it("ne skip pas si forceRefetch", () => {
    expect(
      shouldSkipDiscoveryFetch({
        forceRefetch: true,
        viewportBounds: vb([44.7, -0.7], [44.9, -0.5]),
        lastQueryBounds: vb([44.6, -0.8], [45.0, -0.4]),
        lastMode: "detail",
        nextMode: "detail",
      })
    ).toBe(false);
  });

  it("ne skip pas si le mode change (overview → detail)", () => {
    expect(
      shouldSkipDiscoveryFetch({
        forceRefetch: false,
        viewportBounds: vb([44.75, -0.65], [44.85, -0.55]),
        lastQueryBounds: vb([44.6, -0.8], [45.0, -0.4]),
        lastMode: "overview",
        nextMode: "detail",
      })
    ).toBe(false);
  });

  it("skip si même mode et viewport inclus dans la dernière bbox", () => {
    const query = vb([44.6, -0.8], [45.0, -0.4]);
    const view = vb([44.75, -0.65], [44.85, -0.55]);
    expect(
      shouldSkipDiscoveryFetch({
        forceRefetch: false,
        viewportBounds: view,
        lastQueryBounds: query,
        lastMode: "detail",
        nextMode: "detail",
      })
    ).toBe(true);
  });

  it("ne skip pas si le viewport dépasse la bbox couverte (même mode)", () => {
    const query = vb([44.75, -0.65], [44.85, -0.55]);
    const view = vb([44.6, -0.8], [45.0, -0.4]);
    expect(
      shouldSkipDiscoveryFetch({
        forceRefetch: false,
        viewportBounds: view,
        lastQueryBounds: query,
        lastMode: "overview",
        nextMode: "overview",
      })
    ).toBe(false);
  });

  it("ne skip pas si aucune bbox précédente", () => {
    expect(
      shouldSkipDiscoveryFetch({
        forceRefetch: false,
        viewportBounds: vb([44.75, -0.65], [44.85, -0.55]),
        lastQueryBounds: null,
        lastMode: "detail",
        nextMode: "detail",
      })
    ).toBe(false);
  });
});
