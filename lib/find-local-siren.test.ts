import { describe, expect, it } from "vitest";
import type { ResultatApiRechercheEntreprises } from "@/lib/api-gouv-enrichment-map";
import {
  expandStreetAbbreviations,
  extractPoiTokensForMatch,
  hasDiscriminatingTokenInNom,
  nomContainsTokenAsWholeWord,
  normalizeForMatch,
  scoreCandidate,
  stripFrenchLegalFormsForPoi,
  type LocalSirenCandidate,
} from "./find-local-siren";

const stubCompany = {} as ResultatApiRechercheEntreprises;

function candidate(
  o: Pick<
    LocalSirenCandidate,
    "siren" | "siret" | "nom_complet" | "adresse" | "code_postal"
  > & { latitude?: number | null; longitude?: number | null }
): LocalSirenCandidate {
  return {
    ...o,
    latitude: o.latitude ?? 44.8069,
    longitude: o.longitude ?? -0.6329,
    sourceCompany: stubCompany,
  };
}

const pessacLat = 44.8069;
const pessacLon = -0.6329;

describe("expandStreetAbbreviations", () => {
  it("normalise Av. vers avenue", () => {
    const n = normalizeForMatch("32 Av. Léonard de Vinci");
    expect(expandStreetAbbreviations(n)).toContain("avenue");
    expect(expandStreetAbbreviations(n)).toContain("leonard de vinci");
  });
});

describe("extractPoiTokensForMatch", () => {
  it("exclut la commune des tokens", () => {
    const t = extractPoiTokensForMatch("AMAZON PESSAC", "Pessac");
    expect(t).toContain("amazon");
    expect(t).not.toContain("pessac");
  });

  it("Sud Tp Service SA : plus de token exploitable (service + SA exclus)", () => {
    expect(extractPoiTokensForMatch("Sud Tp Service SA", "Pessac")).toEqual([]);
  });
});

describe("stripFrenchLegalFormsForPoi", () => {
  it("retire un suffixe SA en fin de chaîne", () => {
    expect(stripFrenchLegalFormsForPoi("sud tp service sa")).toBe("sud tp service");
  });
});

describe("nomContainsTokenAsWholeWord", () => {
  it("service ne matche pas le mot services", () => {
    const nom = normalizeForMatch("ORANGE BUSINESS SERVICES");
    expect(nomContainsTokenAsWholeWord(nom, "service")).toBe(false);
    expect(nomContainsTokenAsWholeWord(nom, "services")).toBe(true);
  });

  it("amazon matche comme mot entier", () => {
    const nom = normalizeForMatch("AMAZON TECHNOLOGICAL SERVICES");
    expect(nomContainsTokenAsWholeWord(nom, "amazon")).toBe(true);
  });
});

describe("scoreCandidate", () => {
  it("Amazon (token + Av./Avenue) bat Allianz au même CP / coords", () => {
    const poiName = "AMAZON PESSAC";
    const rue = "32 Av. Léonard de Vinci";
    const cp = "33600";
    const amazon = candidate({
      siren: "429836810",
      siret: "42983681000078",
      nom_complet: "AMAZON TECHNOLOGICAL SERVICES",
      adresse: "32 AVENUE LEONARD DE VINCI 33600 PESSAC",
      code_postal: cp,
    });
    const allianz = candidate({
      siren: "340234962",
      siret: "34023496208390",
      nom_complet: "ALLIANZ I.A.R.D.",
      adresse: "32 AVENUE LEONARD DE VINCI 33600 PESSAC",
      code_postal: cp,
    });
    const opts = { commune: "Pessac" };
    const sAmazon = scoreCandidate(poiName, rue, cp, pessacLat, pessacLon, amazon, opts);
    const sAllianz = scoreCandidate(poiName, rue, cp, pessacLat, pessacLon, allianz, opts);
    expect(sAmazon).toBeGreaterThan(sAllianz);
    expect(sAmazon).toBeGreaterThanOrEqual(900);
  });

  it("Créalis / accents : score élevé avec raison sociale sans accents", () => {
    const poiName = "Créalis Ingénierie";
    const rue = "BAT 2 32 Av. Léonard de Vinci";
    const cp = "33600";
    const crealis = candidate({
      siren: "478919855",
      siret: "47891985500047",
      nom_complet: "CREALIS INGENIERIE (JUNCTO)",
      adresse: "BAT 2 32 AVENUE LEONARD DE VINCI 33600 PESSAC",
      code_postal: cp,
    });
    const s = scoreCandidate(poiName, rue, cp, pessacLat, pessacLon, crealis, {
      commune: "Pessac",
    });
    expect(s).toBeGreaterThanOrEqual(850);
  });

  it("blacklist : seul token SERVICES ne déclenche pas le bonus discriminant", () => {
    expect(
      hasDiscriminatingTokenInNom("SERVICES", "ACME SERVICES FRANCE", null)
    ).toBe(false);
    expect(
      hasDiscriminatingTokenInNom("ORANGE BUSINESS", "ORANGE BUSINESS SERVICES", null)
    ).toBe(true);
  });

  it("Sud Tp Service SA : pas de bonus token sur ORANGE BUSINESS SERVICES (même adresse)", () => {
    expect(
      hasDiscriminatingTokenInNom(
        "Sud Tp Service SA",
        "ORANGE BUSINESS SERVICES",
        "Pessac"
      )
    ).toBe(false);
    const rue = "32 Av. Léonard de Vinci";
    const cp = "33600";
    const orange = candidate({
      siren: "529040677",
      siret: "52904067700583",
      nom_complet: "ORANGE BUSINESS SERVICES",
      adresse: "32 AVENUE LEONARD DE VINCI 33600 PESSAC",
      code_postal: cp,
    });
    const s = scoreCandidate(
      "Sud Tp Service SA",
      rue,
      cp,
      pessacLat,
      pessacLon,
      orange,
      { commune: "Pessac" }
    );
    expect(s).toBeLessThan(900);
  });
});
