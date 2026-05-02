import type { Lead } from "@/types";

type PostgresLeadRow = {
  id: string;
  name: string | null;
  quality_score: number | null;
  contact_name: string | null;
  thumbnail_url: string | null;
  created_at: string | Date;
  siren: string | null;
  siret: string | null;
  company_legal_name: string | null;
  company_legal_form: string | null;
  company_address: string | null;
  parcelles_count: number | null;
  code_insee: string | null;
};

export function mapPostgresLeadRow(row: PostgresLeadRow): Lead {
  return {
    id: row.id,
    prospectId: "",
    name: row.name ?? "Lead sans nom",
    qualityScore: row.quality_score ?? 0,
    contactName: row.contact_name ?? undefined,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    createdAt: new Date(row.created_at),
    siren: row.siren ?? undefined,
    siret: row.siret ?? undefined,
    companyLegalName: row.company_legal_name ?? undefined,
    companyLegalForm: row.company_legal_form ?? undefined,
    companyAddress: row.company_address ?? undefined,
    parcellesCount: row.parcelles_count ?? undefined,
    codeInsee: row.code_insee ?? undefined,
  };
}
