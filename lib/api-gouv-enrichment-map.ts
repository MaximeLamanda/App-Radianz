import type { EnrichmentResult } from "@/lib/recherche-entreprises";

/** Établissement (siège ou secondaire) dans la réponse API recherche-entreprises */
export interface ApiEtablissementGouv {
  siret?: string;
  adresse?: string;
  geo_adresse?: string;
  code_postal?: string;
  latitude?: string;
  longitude?: string;
  liste_enseignes?: string[] | null;
}

export type SiegeApiGouv = ApiEtablissementGouv;

export interface DirigeantPersonnePhysiqueGouv {
  nom?: string;
  prenoms?: string;
  qualite?: string;
  type_dirigeant?: string;
}

/** Résultat entreprise (réponse recherche-entreprises.api.gouv.fr) */
export interface ResultatApiRechercheEntreprises {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  siege?: SiegeApiGouv;
  activite_principale?: string;
  dirigeants?: Array<DirigeantPersonnePhysiqueGouv | { type_dirigeant?: string; denomination?: string }>;
  matching_etablissements?: ApiEtablissementGouv[];
}

export function mapResultatApiToEnrichment(
  result: ResultatApiRechercheEntreprises
): EnrichmentResult {
  const siege = result.siege;
  const firstDirigeantPhysique = result.dirigeants?.find(
    (d): d is DirigeantPersonnePhysiqueGouv =>
      (d as { type_dirigeant?: string }).type_dirigeant === "personne physique" &&
      "nom" in d &&
      "prenoms" in d
  );
  const managerName = firstDirigeantPhysique
    ? [firstDirigeantPhysique.prenoms, firstDirigeantPhysique.nom].filter(Boolean).join(" ") +
      (firstDirigeantPhysique.qualite ? ` (${firstDirigeantPhysique.qualite})` : "")
    : undefined;

  return {
    siren: result.siren ?? undefined,
    siret: siege?.siret ?? undefined,
    companyLegalName: result.nom_complet ?? result.nom_raison_sociale ?? undefined,
    companyManagerName: managerName,
    companyAddress: siege?.geo_adresse ?? siege?.adresse ?? undefined,
    companyNaf: result.activite_principale ?? undefined,
  };
}

/** Texte pour Fuse (dénomination + enseignes) */
export function getSearchableTextFromResultat(
  r: ResultatApiRechercheEntreprises
): string {
  const parts = [r.nom_complet ?? "", r.nom_raison_sociale ?? ""];
  const enseignes =
    r.matching_etablissements?.flatMap((e) => e.liste_enseignes ?? []) ?? [];
  return [...parts, ...enseignes].filter(Boolean).join(" ");
}
