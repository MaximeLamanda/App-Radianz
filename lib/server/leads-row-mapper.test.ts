import { describe, expect, it } from "vitest";
import { mapPostgresLeadRow } from "./leads-row-mapper";

describe("mapPostgresLeadRow", () => {
  it("mappe une ligne enrichie Postgres vers le type Lead UI", () => {
    const lead = mapPostgresLeadRow({
      id: "e4d697a2-a867-4d7b-bd62-0f1234567890",
      name: "ACME Industrie",
      quality_score: 78,
      contact_name: "Jean Martin",
      thumbnail_url: "https://example.com/thumb.jpg",
      created_at: "2026-04-10T11:22:33.000Z",
      siren: "123456789",
      siret: "12345678900011",
      company_legal_name: "ACME INDUSTRIE SAS",
      company_legal_form: "Société par actions simplifiée",
      company_address: "10 AV DE LA PAIX 33600 PESSAC",
      parcelles_count: 4,
      code_insee: "33318",
    });

    expect(lead.id).toBe("e4d697a2-a867-4d7b-bd62-0f1234567890");
    expect(lead.name).toBe("ACME Industrie");
    expect(lead.qualityScore).toBe(78);
    expect(lead.contactName).toBe("Jean Martin");
    expect(lead.companyLegalName).toBe("ACME INDUSTRIE SAS");
    expect(lead.companyLegalForm).toBe("Société par actions simplifiée");
    expect(lead.companyAddress).toContain("PESSAC");
    expect(lead.parcellesCount).toBe(4);
    expect(lead.codeInsee).toBe("33318");
    expect(lead.createdAt).toBeInstanceOf(Date);
  });
});
