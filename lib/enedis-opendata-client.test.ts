import { describe, expect, it } from "vitest";
import {
  buildEnedisOdsWhereClause,
  formatEnedisAddressLabel,
  normalizeEnedisAddressKey,
  type EnedisOpenDataRecord,
} from "./enedis-opendata-client";

describe("formatEnedisAddressLabel", () => {
  it("compose numéro, voie et commune", () => {
    const r: EnedisOpenDataRecord = {
      numero_de_voie: "12",
      type_de_voie: "RUE",
      libelle_de_voie: "DE LA PAIX",
      nom_commune: "Pessac",
    };
    expect(formatEnedisAddressLabel(r)).toBe("12 RUE DE LA PAIX Pessac");
  });

  it("repli sur adresse puis commune", () => {
    expect(
      formatEnedisAddressLabel({
        adresse: "ZONE INDUSTRIELLE",
        nom_commune: "Pessac",
      })
    ).toBe("ZONE INDUSTRIELLE Pessac");
  });

  it("retourne null si libellé trop court", () => {
    expect(formatEnedisAddressLabel({ nom_commune: "X" })).toBeNull();
  });
});

describe("normalizeEnedisAddressKey", () => {
  it("normalise casse et espaces", () => {
    expect(normalizeEnedisAddressKey("  12  Rue   Test  ")).toBe("12 rue test");
  });
});

describe("buildEnedisOdsWhereClause", () => {
  it("filtre communes, année et MWh", () => {
    const w = buildEnedisOdsWhereClause({
      codeCommunes: ["33318", "33063"],
      annee: "2024",
      mwhMin: 50,
      mwhMax: 500,
    });
    expect(w).toContain("code_commune IN ('33318', '33063')");
    expect(w).toContain("annee = '2024'");
    expect(w).toContain(">= 50");
    expect(w).toContain("<= 500");
  });

  it("borne haute ouverte au plafond slider", () => {
    const w = buildEnedisOdsWhereClause({
      codeCommunes: ["33318"],
      annee: "2024",
      mwhMin: 0,
      mwhMax: 10_000,
    });
    expect(w).not.toContain("<=");
  });
});
