import type { DirigeantPhysiqueGouv, EnrichmentResult } from "@/lib/recherche-entreprises";

/** Établissement (siège ou secondaire) dans la réponse API recherche-entreprises */
export interface ApiEtablissementGouv {
  siret?: string;
  adresse?: string;
  geo_adresse?: string;
  code_postal?: string;
  latitude?: string;
  longitude?: string;
  liste_enseignes?: string[] | null;
  tranche_effectif_salarie?: string;
  annee_tranche_effectif_salarie?: string;
  /** Présent sur certains établissements dans matching_etablissements */
  activite_principale?: string;
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
  /**
   * Statut administratif de l’unité légale : "A" = Actif, "C" = Cessé.
   * Utilisé pour exclure les sociétés inactives du scoring.
   */
  etat_administratif?: string;
  dirigeants?: Array<DirigeantPersonnePhysiqueGouv | { type_dirigeant?: string; denomination?: string }>;
  matching_etablissements?: ApiEtablissementGouv[];
  /** Unité légale — prioritaire sur le siège pour l’effectif global */
  tranche_effectif_salarie?: string;
  annee_tranche_effectif_salarie?: string;
}

export type MapResultatApiToEnrichmentOpts = {
  /** SIRET 14 chiffres : priorise l’établissement dans matching_etablissements (effectif / NAF à l’échelle locale). */
  preferSiret?: string;
};

export function extractDirigeantsPhysiques(
  result: ResultatApiRechercheEntreprises
): DirigeantPhysiqueGouv[] {
  const out: DirigeantPhysiqueGouv[] = [];
  for (const d of result.dirigeants ?? []) {
    if ((d as { type_dirigeant?: string }).type_dirigeant !== "personne physique") continue;
    if (!("nom" in d) || !("prenoms" in d)) continue;
    const pp = d as DirigeantPersonnePhysiqueGouv;
    const nom = String(pp.nom ?? "").trim();
    const prenoms = String(pp.prenoms ?? "").trim();
    if (!nom && !prenoms) continue;
    out.push({
      nom: nom || undefined,
      prenoms: prenoms || undefined,
      qualite: pp.qualite?.trim() || undefined,
    });
  }
  return out;
}

export function formatDirigeantPhysiqueName(d: DirigeantPhysiqueGouv): string {
  return [d.prenoms, d.nom].filter(Boolean).join(" ").trim();
}

export function mapResultatApiToEnrichment(
  result: ResultatApiRechercheEntreprises,
  opts?: MapResultatApiToEnrichmentOpts
): EnrichmentResult {
  const siege = result.siege;
  const dirigeantsPhysiques = extractDirigeantsPhysiques(result);
  const firstDirigeantPhysique = dirigeantsPhysiques[0];
  const managerName = firstDirigeantPhysique
    ? formatDirigeantPhysiqueName(firstDirigeantPhysique) +
      (firstDirigeantPhysique.qualite ? ` (${firstDirigeantPhysique.qualite})` : "")
    : undefined;

  const prefer = (opts?.preferSiret ?? "").trim();
  let etabMatch: ApiEtablissementGouv | undefined;
  if (/^\d{14}$/.test(prefer)) {
    const stSiege = String(siege?.siret ?? "").trim();
    if (stSiege === prefer) {
      etabMatch = siege;
    } else {
      etabMatch = (result.matching_etablissements ?? []).find((e) => String(e?.siret ?? "").trim() === prefer);
    }
  }

  const nafFromEtab =
    etabMatch?.activite_principale != null && String(etabMatch.activite_principale).trim() !== ""
      ? String(etabMatch.activite_principale).trim()
      : undefined;

  const trancheFromEtab =
    etabMatch?.tranche_effectif_salarie != null && String(etabMatch.tranche_effectif_salarie).trim() !== ""
      ? String(etabMatch.tranche_effectif_salarie).trim()
      : undefined;

  const anneeFromEtab =
    etabMatch?.annee_tranche_effectif_salarie != null && String(etabMatch.annee_tranche_effectif_salarie).trim() !== ""
      ? String(etabMatch.annee_tranche_effectif_salarie).trim()
      : undefined;

  const effectifCode =
    trancheFromEtab ??
    result.tranche_effectif_salarie ??
    siege?.tranche_effectif_salarie;
  const codeTrim = effectifCode != null ? String(effectifCode).trim() : "";

  const anneeOut =
    anneeFromEtab ??
    (siege?.annee_tranche_effectif_salarie != null
      ? String(siege.annee_tranche_effectif_salarie).trim()
      : undefined) ??
    (result.annee_tranche_effectif_salarie != null
      ? String(result.annee_tranche_effectif_salarie).trim()
      : undefined);

  const siretOut =
    etabMatch?.siret != null && String(etabMatch.siret).trim() !== ""
      ? String(etabMatch.siret).trim()
      : siege?.siret != null
        ? String(siege.siret).trim()
        : undefined;

  return {
    siren: result.siren ?? undefined,
    siret: siretOut,
    companyLegalName: result.nom_complet ?? result.nom_raison_sociale ?? undefined,
    companyManagerName: managerName,
    dirigeantsPhysiques: dirigeantsPhysiques.length > 0 ? dirigeantsPhysiques : undefined,
    companyAddress: siege?.geo_adresse ?? siege?.adresse ?? undefined,
    companyNaf: nafFromEtab ?? result.activite_principale ?? undefined,
    /** Code INSEE seul (ex. 03), pas de libellé */
    companyTrancheEffectif: codeTrim !== "" ? codeTrim : undefined,
    companyAnneeTrancheEffectif: anneeOut !== "" ? anneeOut : undefined,
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
