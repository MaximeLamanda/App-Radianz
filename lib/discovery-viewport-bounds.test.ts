import { describe, expect, it } from "vitest";
import type { MapBounds } from "@/lib/swr-hooks";
import {
  expandMapBounds,
  filterScoutMatchingV5RowsByMapBounds,
  viewportContainedInQueryBounds,
} from "@/lib/discovery-viewport-bounds";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";

const sample: MapBounds = {
  sw: { lat: 44.78, lng: -0.68 },
  ne: { lat: 44.84, lng: -0.57 },
};

describe("expandMapBounds", () => {
  it("élargit symétriquement avec padding 0.25", () => {
    const out = expandMapBounds(sample, 0.25);
    const latSpan = sample.ne.lat - sample.sw.lat;
    const lngSpan = sample.ne.lng - sample.sw.lng;
    const padLat = latSpan * 0.25;
    const padLng = lngSpan * 0.25;
    expect(out.sw.lat).toBeCloseTo(sample.sw.lat - padLat, 10);
    expect(out.ne.lat).toBeCloseTo(sample.ne.lat + padLat, 10);
    expect(out.sw.lng).toBeCloseTo(sample.sw.lng - padLng, 10);
    expect(out.ne.lng).toBeCloseTo(sample.ne.lng + padLng, 10);
  });

  it("avec padding 0 la bbox est inchangée (lat clamp)", () => {
    const out = expandMapBounds(sample, 0);
    expect(out).toEqual(sample);
  });
});

describe("viewportContainedInQueryBounds", () => {
  const query = expandMapBounds(sample, 0.3);

  it("retourne vrai si le viewport est identique à query", () => {
    expect(viewportContainedInQueryBounds(query, query)).toBe(true);
  });

  it("retourne vrai si le viewport est strictement intérieur", () => {
    const inner: MapBounds = {
      sw: { lat: sample.sw.lat + 0.01, lng: sample.sw.lng + 0.01 },
      ne: { lat: sample.ne.lat - 0.01, lng: sample.ne.lng - 0.01 },
    };
    expect(viewportContainedInQueryBounds(inner, query)).toBe(true);
  });

  it("retourne faux si le viewport dépasse au nord", () => {
    const tooNorth: MapBounds = {
      ...sample,
      ne: { ...sample.ne, lat: query.ne.lat + 0.001 },
    };
    expect(viewportContainedInQueryBounds(tooNorth, query)).toBe(false);
  });

  it("retourne faux si le viewport dépasse à l’ouest", () => {
    const tooWest: MapBounds = {
      ...sample,
      sw: { ...sample.sw, lng: query.sw.lng - 0.001 },
    };
    expect(viewportContainedInQueryBounds(tooWest, query)).toBe(false);
  });
});

describe("filterScoutMatchingV5RowsByMapBounds", () => {
  const viewport: MapBounds = {
    sw: { lat: 44.78, lng: -0.68 },
    ne: { lat: 44.84, lng: -0.57 },
  };

  function rowWithRing(coords: number[][]): ScoutMatchingV5Row {
    return {
      id: "t",
      grain: "parcelle",
      geometry: { type: "Polygon", coordinates: [coords] },
      label: "",
      batimentConstructionId: null,
      batimentGroupeId: null,
      codeInsee: "33318",
      section: "A",
      numeroNorm: "0001",
      codeIris: "",
      nomIris: "",
      nbBatiments: 0,
      footprintSumM2: 100,
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
      buildingsJson: "",
      buildingGeometriesJson: "",
      properties: {},
    } as ScoutMatchingV5Row;
  }

  it("retient une parcelle dont le polygone intersecte le viewport", () => {
    const inside = rowWithRing([
      [-0.62, 44.8],
      [-0.61, 44.8],
      [-0.61, 44.81],
      [-0.62, 44.81],
      [-0.62, 44.8],
    ]);
    const outside = rowWithRing([
      [-0.2, 45.2],
      [-0.19, 45.2],
      [-0.19, 45.21],
      [-0.2, 45.21],
      [-0.2, 45.2],
    ]);
    const out = filterScoutMatchingV5RowsByMapBounds([inside, outside], viewport, 0);
    expect(out).toEqual([inside]);
  });
});
