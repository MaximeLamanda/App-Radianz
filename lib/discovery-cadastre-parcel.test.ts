import { describe, expect, it } from "vitest";
import {
  cadastreLabelFromKeys,
  parseScoutV5ParcelleId,
  scoutV5IdFromCadastreKeys,
} from "@/lib/discovery-cadastre-parcel";

describe("scoutV5IdFromCadastreKeys", () => {
  it("aligne le format pipeline", () => {
    expect(scoutV5IdFromCadastreKeys("33318", "HC", "0045")).toBe("parcelle:33318:HC:0045");
  });
});

describe("parseScoutV5ParcelleId", () => {
  it("parse un id parcelle", () => {
    expect(parseScoutV5ParcelleId("parcelle:33318:HC:0045")).toEqual({
      codeInsee: "33318",
      section: "HC",
      numeroNorm: "0045",
    });
  });
});

describe("cadastreLabelFromKeys", () => {
  it("formate section et numéro", () => {
    expect(cadastreLabelFromKeys("33318", "AB", "0012")).toContain("AB");
    expect(cadastreLabelFromKeys("33318", "AB", "0012")).toContain("33318");
  });
});
