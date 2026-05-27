import { describe, expect, it } from "vitest";
import { mapResultatApiToEnrichment, type ResultatApiRechercheEntreprises } from "./api-gouv-enrichment-map";

describe("mapResultatApiToEnrichment", () => {
  it("priorise l’établissement matching quand preferSiret est un SIRET secondaire", () => {
    const result: ResultatApiRechercheEntreprises = {
      siren: "123456789",
      activite_principale: "6202A",
      tranche_effectif_salarie: "11",
      siege: {
        siret: "12345678900001",
        tranche_effectif_salarie: "11",
        annee_tranche_effectif_salarie: "2021",
      },
      matching_etablissements: [
        {
          siret: "12345678901234",
          activite_principale: "4711D",
          tranche_effectif_salarie: "03",
          annee_tranche_effectif_salarie: "2023",
        },
      ],
    };
    const m = mapResultatApiToEnrichment(result, { preferSiret: "12345678901234" });
    expect(m.siret).toBe("12345678901234");
    expect(m.companyNaf).toBe("4711D");
    expect(m.companyTrancheEffectif).toBe("03");
    expect(m.companyAnneeTrancheEffectif).toBe("2023");
  });

  it("utilise le siège quand preferSiret correspond au siège", () => {
    const result: ResultatApiRechercheEntreprises = {
      siren: "123456789",
      activite_principale: "6202A",
      siege: {
        siret: "12345678900001",
        tranche_effectif_salarie: "05",
        annee_tranche_effectif_salarie: "2022",
      },
    };
    const m = mapResultatApiToEnrichment(result, { preferSiret: "12345678900001" });
    expect(m.companyTrancheEffectif).toBe("05");
    expect(m.companyAnneeTrancheEffectif).toBe("2022");
  });

  it("mappe tous les dirigeants personnes physiques", () => {
    const m = mapResultatApiToEnrichment({
      siren: "123456789",
      dirigeants: [
        { type_dirigeant: "personne physique", prenoms: "Jean", nom: "Dupont", qualite: "Président" },
        { type_dirigeant: "personne physique", prenoms: "Marie", nom: "Martin", qualite: "DG" },
        { type_dirigeant: "personne morale", denomination: "HOLDING SA" },
      ],
    });
    expect(m.dirigeantsPhysiques).toHaveLength(2);
    expect(m.dirigeantsPhysiques?.[0]).toMatchObject({ nom: "Dupont", qualite: "Président" });
    expect(m.companyManagerName).toContain("Jean");
  });
});
