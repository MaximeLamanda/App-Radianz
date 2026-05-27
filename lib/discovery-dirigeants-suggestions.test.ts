import { describe, expect, it } from "vitest";
import {
  collectUniqueSirensForDirigeantFetch,
  contactFromDirigeant,
  isDirigeantAlreadyAdded,
  normalizeContactPersonName,
  sirenFromSiretOrSiren,
} from "./discovery-dirigeants-suggestions";
import type { ProspectContact } from "@/types";

describe("discovery-dirigeants-suggestions", () => {
  it("extrait le SIREN depuis un SIRET", () => {
    expect(sirenFromSiretOrSiren("12345678901234")).toBe("123456789");
    expect(sirenFromSiretOrSiren("123456789")).toBe("123456789");
  });

  it("normalise les noms pour comparaison", () => {
    expect(normalizeContactPersonName("  Jean  DUPONT ")).toBe("jean dupont");
    expect(normalizeContactPersonName("Élodie Martin")).toBe("elodie martin");
  });

  it("détecte un dirigeant déjà ajouté sur même origine", () => {
    const contacts: ProspectContact[] = [
      {
        fullName: "Jean Dupont",
        source: "manual",
        originKind: "parcelle",
        originRef: "p1",
      },
    ];
    expect(
      isDirigeantAlreadyAdded(contacts, {
        originKind: "parcelle",
        originRef: "p1",
        fullName: "Jean Dupont",
      })
    ).toBe(true);
    expect(
      isDirigeantAlreadyAdded(contacts, {
        originKind: "parcelle",
        originRef: "p2",
        fullName: "Jean Dupont",
      })
    ).toBe(false);
  });

  it("déduplique les SIREN pour fetch", () => {
    expect(
      collectUniqueSirensForDirigeantFetch({
        parcelleSirens: ["111111111", "222222222"],
        etablissementSirensOrSirets: ["11111111100001", "333333333"],
      })
    ).toEqual(["111111111", "222222222", "333333333"]);
  });

  it("crée un contact manuel depuis un dirigeant", () => {
    const c = contactFromDirigeant({
      dirigeant: { prenoms: "Marie", nom: "Martin", qualite: "DG" },
      originKind: "etablissement",
      originRef: "12345678901234",
      originLabel: "ACME SAS",
    });
    expect(c.fullName).toBe("Marie Martin");
    expect(c.title).toBe("DG");
    expect(c.originKind).toBe("etablissement");
    expect(c.originRef).toBe("12345678901234");
    expect(c.source).toBe("manual");
  });
});
