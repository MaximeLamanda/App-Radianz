/**
 * Libellés des divisions NAF rév. 2 (niveau 2 chiffres, INSEE).
 * Utilisé pour le filtre Discovery (préfixe sur code APE établissement, ex. 47.11F → division 47).
 */

export type NafRev2Division = {
  code: string;
  label: string;
};

/** Divisions officielles NAF rév. 2 (code → intitulé section). */
export const NAF_REV2_DIVISIONS: readonly NafRev2Division[] = [
  { code: "01", label: "Culture et production animale, chasse et services annexes" },
  { code: "02", label: "Sylviculture et exploitation forestière" },
  { code: "03", label: "Pêche et aquaculture" },
  { code: "05", label: "Extraction de houille et de lignite" },
  { code: "06", label: "Extraction d'hydrocarbures" },
  { code: "07", label: "Extraction de minerais métalliques" },
  { code: "08", label: "Autres industries extractives" },
  { code: "09", label: "Services de soutien aux industries extractives" },
  { code: "10", label: "Industries alimentaires" },
  { code: "11", label: "Fabrication de boissons" },
  { code: "12", label: "Fabrication de produits à base de tabac" },
  { code: "13", label: "Fabrication de textiles" },
  { code: "14", label: "Industrie de l'habillement" },
  { code: "15", label: "Industrie du cuir et de la chaussure" },
  { code: "16", label: "Travail du bois et fabrication d'articles en bois" },
  { code: "17", label: "Industrie du papier et du carton" },
  { code: "18", label: "Imprimerie et reproduction d'enregistrements" },
  { code: "19", label: "Cokéfaction et raffinage" },
  { code: "20", label: "Fabrication de produits chimiques" },
  { code: "21", label: "Fabrication de produits pharmaceutiques" },
  { code: "22", label: "Fabrication de produits en caoutchouc et en plastique" },
  { code: "23", label: "Fabrication d'autres produits minéraux non métalliques" },
  { code: "24", label: "Métallurgie" },
  { code: "25", label: "Fabrication de produits métalliques" },
  { code: "26", label: "Fabrication de produits informatiques, électroniques et optiques" },
  { code: "27", label: "Fabrication d'équipements électriques" },
  { code: "28", label: "Fabrication de machines et équipements n.c.a." },
  { code: "29", label: "Industrie automobile" },
  { code: "30", label: "Fabrication d'autres matériels de transport" },
  { code: "31", label: "Fabrication de meubles" },
  { code: "32", label: "Autres industries manufacturières" },
  { code: "33", label: "Réparation et installation de machines et d'équipements" },
  { code: "35", label: "Production et distribution d'électricité, de gaz, de vapeur et d'air conditionné" },
  { code: "36", label: "Captage, traitement et distribution d'eau" },
  { code: "37", label: "Collecte et traitement des eaux usées" },
  { code: "38", label: "Collecte, traitement et élimination des déchets ; récupération" },
  { code: "39", label: "Dépollution et autres services de gestion des déchets" },
  { code: "41", label: "Construction de bâtiments" },
  { code: "42", label: "Génie civil" },
  { code: "43", label: "Travaux de construction spécialisés" },
  { code: "45", label: "Commerce et réparation d'automobiles et de motocycles" },
  { code: "46", label: "Commerce de gros" },
  { code: "47", label: "Commerce de détail" },
  { code: "49", label: "Transports terrestres et transport par conduites" },
  { code: "50", label: "Transports par eau" },
  { code: "51", label: "Transports aériens" },
  { code: "52", label: "Entreposage et services auxiliaires des transports" },
  { code: "53", label: "Activités de poste et de courrier" },
  { code: "55", label: "Hébergement" },
  { code: "56", label: "Restauration" },
  { code: "58", label: "Édition" },
  { code: "59", label: "Production de films cinématographiques et programmes télévisés" },
  { code: "60", label: "Enregistrement sonore et édition musicale" },
  { code: "61", label: "Télécommunications" },
  { code: "62", label: "Programmation, conseil et autres activités informatiques" },
  { code: "63", label: "Services d'information" },
  { code: "64", label: "Activités des services financiers" },
  { code: "65", label: "Assurance" },
  { code: "66", label: "Activités auxiliaires de services financiers et d'assurance" },
  { code: "68", label: "Activités immobilières" },
  { code: "69", label: "Activités juridiques et comptables" },
  { code: "70", label: "Activités des sièges sociaux ; conseil de gestion" },
  { code: "71", label: "Activités d'architecture et d'ingénierie" },
  { code: "72", label: "Recherche-développement scientifique" },
  { code: "73", label: "Publicité et études de marché" },
  { code: "74", label: "Autres activités spécialisées, scientifiques et techniques" },
  { code: "75", label: "Activités vétérinaires" },
  { code: "77", label: "Activités de location et location-bail" },
  { code: "78", label: "Activités liées à l'emploi" },
  { code: "79", label: "Agences de voyage, voyagistes et services de réservation" },
  { code: "80", label: "Enquêtes et sécurité" },
  { code: "81", label: "Services relatifs aux bâtiments et aménagement paysager" },
  { code: "82", label: "Activités administratives et autres activités de soutien aux entreprises" },
  { code: "84", label: "Administration publique et défense ; sécurité sociale obligatoire" },
  { code: "85", label: "Enseignement" },
  { code: "86", label: "Activités pour la santé humaine" },
  { code: "87", label: "Hébergement médico-social et social" },
  { code: "88", label: "Action sociale sans hébergement" },
  { code: "90", label: "Activités créatives, artistiques et de spectacle" },
  { code: "91", label: "Bibliothèques, archives, musées et autres activités culturelles" },
  { code: "92", label: "Organisation de jeux de hasard et d'argent" },
  { code: "93", label: "Activités sportives, récréatives et de loisirs" },
  { code: "94", label: "Activités des organisations associatives" },
  { code: "95", label: "Réparation d'ordinateurs et de biens personnels" },
  { code: "96", label: "Autres services personnels" },
  { code: "97", label: "Activités des ménages en tant qu'employeurs" },
  { code: "98", label: "Activités indifférenciées des ménages" },
  { code: "99", label: "Activités des organisations extraterritoriales" },
] as const;

const BY_CODE = new Map<string, string>(
  NAF_REV2_DIVISIONS.map((d) => [d.code, d.label])
);

/** Intitulé français de la division, ou le code seul si inconnu. */
export function labelNafRev2Division(code: string): string {
  const c = String(code ?? "").trim();
  if (!c) return "";
  return BY_CODE.get(c) ?? `Division ${c}`;
}

/** Libellé affiché dans le picker : « 47 — Commerce de détail ». */
export function formatNafRev2DivisionOption(code: string): string {
  const c = String(code ?? "").trim();
  if (!c) return "";
  const label = labelNafRev2Division(c);
  return label.startsWith("Division ") ? label : `${c} — ${label}`;
}

export function searchNafRev2Divisions(query: string): NafRev2Division[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...NAF_REV2_DIVISIONS];
  return NAF_REV2_DIVISIONS.filter((d) => {
    if (d.code.includes(q)) return true;
    return d.label.toLowerCase().includes(q);
  });
}
