/** Régions métropolitaines France (hors DOM-ROM) */
export const REGIONS_METRO = [
  "Auvergne-Rhône-Alpes",
  "Bourgogne-Franche-Comté",
  "Bretagne",
  "Centre-Val de Loire",
  "Corse",
  "Grand Est",
  "Hauts-de-France",
  "Île-de-France",
  "Normandie",
  "Nouvelle-Aquitaine",
  "Occitanie",
  "Pays de la Loire",
  "Provence-Alpes-Côte d'Azur",
] as const;

/** Régions France métropolitaine + DOM-ROM */
export const REGIONS_FRANCE = [
  ...REGIONS_METRO,
  "Guadeloupe",
  "Guyane",
  "Martinique",
  "Mayotte",
  "La Réunion",
] as const;

/** Liste des régions pour les selects (métropole uniquement) */
export const REGIONS = REGIONS_METRO as unknown as string[];
