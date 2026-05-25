import { describe, expect, it } from "vitest";
import {
  MATCHING_V5_MVT_MAX_Z,
  MATCHING_V5_MVT_MIN_Z,
  parseMatchingV5TileZXY,
} from "@/lib/discovery-mvt-tile";

describe("parseMatchingV5TileZXY", () => {
  it("accepte une tuile valide", () => {
    expect(parseMatchingV5TileZXY("10", "512", "340")).toEqual({ z: 10, x: 512, y: 340 });
  });

  it("rejette z trop bas ou trop haut", () => {
    expect(parseMatchingV5TileZXY("5", "0", "0")).toBeNull();
    expect(parseMatchingV5TileZXY("20", "0", "0")).toBeNull();
  });

  it("rejette x/y hors grille pour ce z", () => {
    expect(parseMatchingV5TileZXY("2", "4", "0")).toBeNull();
    expect(parseMatchingV5TileZXY("2", "0", "4")).toBeNull();
  });

  it("rejette des nombres invalides", () => {
    expect(parseMatchingV5TileZXY("nan", "0", "0")).toBeNull();
  });

  it("expose les bornes attendues", () => {
    expect(MATCHING_V5_MVT_MIN_Z).toBe(6);
    expect(MATCHING_V5_MVT_MAX_Z).toBe(19);
  });
});
