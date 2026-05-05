/**
 * Consommation énergétique typique par type de bâtiment (kWh/m²/an)
 * 
 * Sources:
 * - UK Data (ND-NEED 2024 & BEES Survey)
 * - US EIA Commercial Buildings Energy Consumption Survey
 * 
 * Les valeurs sont des moyennes annuelles en kWh/m²/an (électricité + gaz)
 */

/** Mois (index 0 = janvier, 11 = décembre) */
export type MonthIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export interface BuildingEnergyConsumption {
  googlePlaceType: string; // Type Google Places API exact
  category: string; // Catégorie regroupée (retail, office, warehouse, etc.)
  consumptionKwhPerM2: number; // Consommation annuelle en kWh/m²
  consumptionKwhPerM2PerMonth: number; // Consommation mensuelle moyenne en kWh/m² (annuel / 12)
  /** Consommation par mois en kWh/m² [jan, fév, ..., déc] — profil saisonnier */
  consumptionKwhPerM2ByMonth: number[];
  /** Consommation par heure en kWh/m² [0h-1h, 1h-2h, ..., 23h-24h] — profil horaire type */
  consumptionKwhPerM2PerHours: number[];
  source: string; // Source des données
  notes?: string; // Notes additionnelles
}

/** Calcule la consommation mensuelle moyenne à partir de l'annuelle (kWh/m²/an → kWh/m²/mois) */
function monthlyFromAnnual(annual: number): number {
  return Math.round((annual / 12) * 10) / 10;
}

/**
 * Profil saisonnier type bâtiment tertiaire (UK/Europe) : chauffage hiver, climatisation été.
 * Coefficients par mois (somme = 12) pour répartir l'annuel en mensuel.
 * Index 0 = janvier, 11 = décembre.
 */
const MONTHLY_SEASONAL_PROFILE: number[] = [
  1.15, 1.05, 1.0, 0.92, 0.88, 0.9, 0.95, 0.95, 0.98, 1.02, 1.1, 1.2,
];

/**
 * Répartit la consommation annuelle (kWh/m²/an) en 12 mois selon le profil saisonnier.
 * @returns [jan, fév, ..., déc] en kWh/m²
 */
export function annualToMonthlyBreakdown(annualKwhPerM2: number): number[] {
  const sumCoef = MONTHLY_SEASONAL_PROFILE.reduce((a, b) => a + b, 0);
  return MONTHLY_SEASONAL_PROFILE.map((coef) =>
    Math.round((annualKwhPerM2 * (coef / sumCoef)) * 10) / 10
  );
}

/**
 * Répartit la consommation annuelle en 24 heures (profil type tertiaire).
 * @returns [0h-1h, 1h-2h, ..., 23h-24h] en kWh/m² par heure
 */
export function annualToHourlyBreakdown(annualKwhPerM2: number): number[] {
  const dailyPerM2 = annualKwhPerM2 / 365;
  return HOURLY_CONSUMPTION_PROFILE.map((f) =>
    Math.round((dailyPerM2 * f) * 1000) / 1000
  );
}

/**
 * Profil horaire type bâtiment tertiaire (journée type) : fraction de la consommation journalière par heure.
 * Index 0 = 0h-1h, 23 = 23h-24h. Somme = 1.
 * Faible la nuit (0-6), montée 7-9, plateau 9-18, descente 18-20, faible 20-24.
 */
const HOURLY_PROFILE_RAW = [
  0.015, 0.012, 0.012, 0.012, 0.014, 0.018, 0.025, 0.04, 0.055, 0.06, 0.058, 0.055,
  0.048, 0.052, 0.058, 0.06, 0.058, 0.052, 0.042, 0.032, 0.025, 0.022, 0.018, 0.016,
];
const HOURLY_PROFILE_SUM = HOURLY_PROFILE_RAW.reduce((a, b) => a + b, 0);
export const HOURLY_CONSUMPTION_PROFILE: number[] = HOURLY_PROFILE_RAW.map(
  (f) => Math.round((f / HOURLY_PROFILE_SUM) * 1000) / 1000
);

/**
 * Consommation horaire typique (kWh/m²) pour un type de bâtiment, heure 0-23.
 * Basé sur la consommation annuelle répartie en jour type via HOURLY_CONSUMPTION_PROFILE.
 */
export function getEnergyConsumptionForHour(
  googlePlaceType: string,
  hour0to23: number
): number {
  const data = getBuildingEnergyData(googlePlaceType);
  const annualPerM2 = data?.consumptionKwhPerM2 ?? 170;
  const dailyPerM2 = annualPerM2 / 365;
  const h = Math.max(0, Math.min(23, Math.floor(hour0to23)));
  const fraction = HOURLY_CONSUMPTION_PROFILE[h] ?? 1 / 24;
  return Math.round((dailyPerM2 * fraction) * 1000) / 1000;
}

/**
 * Profil de consommation horaire pour un type (24 valeurs, kWh/m² par heure).
 */
export function getHourlyConsumptionProfileKwhPerM2(googlePlaceType: string): number[] {
  const data = getBuildingEnergyData(googlePlaceType);
  if (data?.consumptionKwhPerM2PerHours?.length === 24) return data.consumptionKwhPerM2PerHours;
  const annualPerM2 = data?.consumptionKwhPerM2 ?? 170;
  return annualToHourlyBreakdown(annualPerM2);
}

/**
 * Tableau de référence des consommations énergétiques par type de bâtiment Google
 * (sans détail mensuel ; le détail par mois est ajouté via annualToMonthlyBreakdown).
 */
const RAW_BUILDING_ENERGY_DATA: Omit<
  BuildingEnergyConsumption,
  "consumptionKwhPerM2ByMonth" | "consumptionKwhPerM2PerHours"
>[] = [
  // === RETAIL / COMMERCE ===
  {
    googlePlaceType: "store",
    category: "retail",
    consumptionKwhPerM2: 168,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(168),
    source: "UK BEES Survey 2024",
    notes: "Retail/Shops moyenne"
  },
  {
    googlePlaceType: "shopping_mall",
    category: "retail",
    consumptionKwhPerM2: 200,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(200),
    source: "UK BEES Survey 2024",
    notes: "Centres commerciaux avec climatisation intensive"
  },
  {
    googlePlaceType: "clothing_store",
    category: "retail",
    consumptionKwhPerM2: 150,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(150),
    source: "UK BEES Survey 2024"
  },
  {
    googlePlaceType: "electronics_store",
    category: "retail",
    consumptionKwhPerM2: 180,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(180),
    source: "UK BEES Survey 2024",
    notes: "Équipements électroniques et éclairage intensif"
  },
  {
    googlePlaceType: "supermarket",
    category: "supermarket",
    consumptionKwhPerM2: 350,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(350),
    source: "US EIA - Food sales parmi les plus énergivores",
    notes: "Réfrigération intensive"
  },
  {
    googlePlaceType: "grocery_or_supermarket",
    category: "supermarket",
    consumptionKwhPerM2: 350,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(350),
    source: "US EIA"
  },
  {
    googlePlaceType: "convenience_store",
    category: "retail",
    consumptionKwhPerM2: 250,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(250),
    source: "UK BEES Survey 2024",
    notes: "Ouvert 24/7 avec réfrigération"
  },
  {
    googlePlaceType: "pharmacy",
    category: "retail",
    consumptionKwhPerM2: 180,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(180),
    source: "UK BEES Survey 2024"
  },
  {
    googlePlaceType: "gas_station",
    category: "retail",
    consumptionKwhPerM2: 200,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(200),
    source: "UK BEES Survey 2024",
    notes: "Éclairage extérieur et équipements"
  },

  // === RESTAURANTS / HOSPITALITY ===
  {
    googlePlaceType: "restaurant",
    category: "hospitality",
    consumptionKwhPerM2: 464,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(464),
    source: "UK ND-NEED 2024",
    notes: "168 kWh/m² électricité + 296 kWh/m² gaz - parmi les plus énergivores"
  },
  {
    googlePlaceType: "cafe",
    category: "hospitality",
    consumptionKwhPerM2: 300,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(300),
    source: "UK BEES Survey 2024"
  },
  {
    googlePlaceType: "bar",
    category: "hospitality",
    consumptionKwhPerM2: 350,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(350),
    source: "UK BEES Survey 2024",
    notes: "Éclairage et équipements de bar"
  },
  {
    googlePlaceType: "night_club",
    category: "hospitality",
    consumptionKwhPerM2: 400,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(400),
    source: "UK BEES Survey 2024",
    notes: "Éclairage et sonorisation intensifs"
  },

  // === BUREAUX / OFFICES ===
  {
    googlePlaceType: "office",
    category: "office",
    consumptionKwhPerM2: 190,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(190),
    source: "UK BEES Survey 2024",
    notes: "~100 kWh/m² électricité + ~90 kWh/m² gaz"
  },
  {
    googlePlaceType: "bank",
    category: "office",
    consumptionKwhPerM2: 200,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(200),
    source: "UK BEES Survey 2024",
    notes: "Sécurité et équipements informatiques"
  },
  {
    googlePlaceType: "real_estate_agency",
    category: "office",
    consumptionKwhPerM2: 150,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(150),
    source: "UK BEES Survey 2024"
  },
  {
    googlePlaceType: "lawyer",
    category: "office",
    consumptionKwhPerM2: 180,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(180),
    source: "UK BEES Survey 2024"
  },
  {
    googlePlaceType: "accounting",
    category: "office",
    consumptionKwhPerM2: 170,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(170),
    source: "UK BEES Survey 2024"
  },

  // === ENTREPÔTS / WAREHOUSES ===
  {
    googlePlaceType: "warehouse",
    category: "warehouse",
    consumptionKwhPerM2: 55,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(55),
    source: "UK BEES Survey 2024",
    notes: "Parmi les plus faibles consommations - principalement éclairage"
  },
  {
    googlePlaceType: "storage",
    category: "warehouse",
    consumptionKwhPerM2: 50,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(50),
    source: "UK BEES Survey 2024"
  },
  {
    googlePlaceType: "storage_facility",
    category: "warehouse",
    consumptionKwhPerM2: 55,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(55),
    source: "UK BEES Survey 2024"
  },

  // === INDUSTRIEL / FACTORIES ===
  {
    googlePlaceType: "factory",
    category: "industrial",
    consumptionKwhPerM2: 100,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(100),
    source: "UK BEES Survey 2024",
    notes: "28 kWh/m² électricité + 72 kWh/m² gaz - faible par m² mais consommation totale élevée"
  },
  {
    googlePlaceType: "industrial",
    category: "industrial",
    consumptionKwhPerM2: 100,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(100),
    source: "UK BEES Survey 2024"
  },
  {
    googlePlaceType: "manufacturing",
    category: "industrial",
    consumptionKwhPerM2: 120,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(120),
    source: "UK BEES Survey 2024",
    notes: "Processus de fabrication énergivores"
  },
  {
    googlePlaceType: "plant",
    category: "industrial",
    consumptionKwhPerM2: 150,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(150),
    source: "UK BEES Survey 2024",
    notes: "Usines avec processus intensifs"
  },

  // === SPORT / FITNESS ===
  {
    googlePlaceType: "gym",
    category: "sport",
    consumptionKwhPerM2: 250,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(250),
    source: "UK BEES Survey 2024",
    notes: "Équipements de fitness et climatisation"
  },
  {
    googlePlaceType: "fitness_center",
    category: "sport",
    consumptionKwhPerM2: 250,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(250),
    source: "UK BEES Survey 2024"
  },
  {
    googlePlaceType: "sports_complex",
    category: "sport",
    consumptionKwhPerM2: 200,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(200),
    source: "UK BEES Survey 2024",
    notes: "Grands espaces avec éclairage"
  },
  {
    googlePlaceType: "stadium",
    category: "sport",
    consumptionKwhPerM2: 150,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(150),
    source: "UK BEES Survey 2024",
    notes: "Grande surface mais utilisation intermittente"
  },
  {
    googlePlaceType: "swimming_pool",
    category: "sport",
    consumptionKwhPerM2: 400,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(400),
    source: "UK BEES Survey 2024",
    notes: "Chauffage de l'eau très énergivore"
  },

  // === AUTRES ===
  {
    googlePlaceType: "other",
    category: "other",
    consumptionKwhPerM2: 170,
    consumptionKwhPerM2PerMonth: monthlyFromAnnual(170),
    source: "UK BEES Survey 2024 - Moyenne bureau/retail sans froid",
    notes: "Bureau / magasin retail sans réfrigération (éclairage, équipements, chauffage). Valeur par défaut pour types non spécifiés"
  }
];

/** Données complètes avec répartition mensuelle (jan–déc) et horaire (24h) pour Firebase et app. */
export const BUILDING_ENERGY_CONSUMPTION_DATA: BuildingEnergyConsumption[] =
  RAW_BUILDING_ENERGY_DATA.map((d) => ({
    ...d,
    consumptionKwhPerM2ByMonth: annualToMonthlyBreakdown(d.consumptionKwhPerM2),
    consumptionKwhPerM2PerHours: annualToHourlyBreakdown(d.consumptionKwhPerM2),
  }));

/**
 * Obtient la consommation énergétique annuelle pour un type de bâtiment Google
 * @param googlePlaceType - Type de bâtiment depuis Google Places API
 * @returns Consommation en kWh/m²/an ou valeur par défaut
 */
export function getEnergyConsumption(googlePlaceType: string): number {
  const buildingData = BUILDING_ENERGY_CONSUMPTION_DATA.find(
    (data) => data.googlePlaceType === googlePlaceType
  );
  if (buildingData) return buildingData.consumptionKwhPerM2;
  const defaultData = BUILDING_ENERGY_CONSUMPTION_DATA.find(
    (data) => data.googlePlaceType === "other"
  );
  return defaultData?.consumptionKwhPerM2 || 170;
}

/**
 * Obtient la consommation énergétique mensuelle pour un type de bâtiment Google (kWh/m²/mois)
 */
export function getEnergyConsumptionMonthly(googlePlaceType: string): number {
  const buildingData = BUILDING_ENERGY_CONSUMPTION_DATA.find(
    (data) => data.googlePlaceType === googlePlaceType
  );
  if (buildingData) return buildingData.consumptionKwhPerM2PerMonth;
  const defaultData = BUILDING_ENERGY_CONSUMPTION_DATA.find(
    (data) => data.googlePlaceType === "other"
  );
  return defaultData?.consumptionKwhPerM2PerMonth ?? 14.2;
}

/**
 * Mapping des types Google vers un type canonique (évite doublons, ex. grocery_or_supermarket → supermarket).
 */
const CANONICAL_PLACE_TYPE_MAP: Record<string, string> = {
  grocery_or_supermarket: "supermarket",
  fitness_center: "gym",
  storage_facility: "storage",
  night_club: "bar",
};

/**
 * Normalise un type Google vers le type canonique utilisé pour la consommation.
 */
export function normalizePlaceTypeForConsumption(placeType: string): string {
  const normalized = placeType?.toLowerCase().trim() || "other";
  return CANONICAL_PLACE_TYPE_MAP[normalized] ?? normalized;
}

/**
 * Liste des types de lieu pour le sélecteur (sans doublons par label, ex. un seul "Supermarché").
 */
export const KNOWN_PLACE_TYPES = BUILDING_ENERGY_CONSUMPTION_DATA
  .filter((d) => !CANONICAL_PLACE_TYPE_MAP[d.googlePlaceType])
  .map((d) => d.googlePlaceType);

/**
 * Vérifie si un type de lieu est dans la base de consommation (exact ou via mapping canonique).
 */
export function isKnownPlaceType(placeType: string): boolean {
  const canonical = normalizePlaceTypeForConsumption(placeType);
  return BUILDING_ENERGY_CONSUMPTION_DATA.some(
    (d) => d.googlePlaceType === placeType || d.googlePlaceType === canonical
  );
}

/**
 * Obtient toutes les données de consommation pour un type de bâtiment
 * (utilise le mapping canonique si le type exact n'est pas trouvé)
 */
export function getBuildingEnergyData(googlePlaceType: string): BuildingEnergyConsumption | null {
  const exact = BUILDING_ENERGY_CONSUMPTION_DATA.find(
    (data) => data.googlePlaceType === googlePlaceType
  );
  if (exact) return exact;
  const canonical = normalizePlaceTypeForConsumption(googlePlaceType);
  const canonicalMatch = BUILDING_ENERGY_CONSUMPTION_DATA.find(
    (data) => data.googlePlaceType === canonical
  );
  if (canonicalMatch) return canonicalMatch;
  // Pour les types inconnus (ex: "health"), utiliser "other" avec son profil complet (mensuel + horaire)
  return BUILDING_ENERGY_CONSUMPTION_DATA.find(
    (data) => data.googlePlaceType === "other"
  ) ?? null;
}

/**
 * Obtient la consommation pour un mois donné (kWh/m²) pour un type de bâtiment.
 * @param googlePlaceType - Type de bâtiment
 * @param monthIndex - 0 = janvier, 11 = décembre
 */
export function getEnergyConsumptionForMonth(
  googlePlaceType: string,
  monthIndex: MonthIndex
): number {
  const data = getBuildingEnergyData(googlePlaceType);
  if (data?.consumptionKwhPerM2ByMonth?.length === 12) {
    return data.consumptionKwhPerM2ByMonth[monthIndex] ?? data.consumptionKwhPerM2PerMonth;
  }
  return data?.consumptionKwhPerM2PerMonth ?? 14.2;
}

/**
 * Répartition mensuelle (kWh) pour un bâtiment : profil saisonnier du type,
 * mise à l’échelle pour que la somme des 12 mois égale `targetAnnualKwh`.
 * Index 0 = janvier, 11 = décembre.
 */
export function monthlyConsumptionKwhFromAnnualProfile(
  googlePlaceType: string,
  surfaceM2: number,
  targetAnnualKwh: number
): number[] {
  if (!Number.isFinite(surfaceM2) || surfaceM2 <= 0 || !Number.isFinite(targetAnnualKwh) || targetAnnualKwh <= 0) {
    return Array.from({ length: 12 }, () => 0);
  }
  const raw = Array.from({ length: 12 }, (_, m) =>
    getEnergyConsumptionForMonth(googlePlaceType, m as MonthIndex) * surfaceM2
  );
  const sumRaw = raw.reduce((a, b) => a + b, 0);
  if (sumRaw <= 0) {
    const flat = targetAnnualKwh / 12;
    return Array.from({ length: 12 }, () => Math.round(flat));
  }
  const exact = raw.map((v) => (v / sumRaw) * targetAnnualKwh);
  const rounded = exact.map((v) => Math.round(v));
  let diff = Math.round(targetAnnualKwh) - rounded.reduce((a, b) => a + b, 0);
  let i = 11;
  while (diff !== 0 && i >= 0) {
    const next = rounded[i]! + diff;
    if (next >= 0) {
      rounded[i] = next;
      diff = 0;
    } else {
      i -= 1;
    }
  }
  return rounded;
}

/** Nombre de jours dans un mois (monthIndex 0 = janvier, 11 = décembre). */
export function getDaysInMonth(monthIndex: number): number {
  return new Date(2000, monthIndex + 1, 0).getDate();
}

/**
 * Jour type consommation (24h) pour un mois donné (kWh par heure).
 * Total journalier = (consommation mensuelle kWh/m² / jours du mois) × surfaceM2, réparti selon le profil horaire.
 * @param placeType - Type de lieu (Google Place type)
 * @param monthIndex - 0 = janvier, 11 = décembre
 * @param surfaceM2 - Surface du bâtiment en m²
 */
export function buildTypicalConsumptionDayForMonth(
  placeType: string,
  monthIndex: number,
  surfaceM2: number
): number[] {
  const consumptionKwhPerM2 = getEnergyConsumptionForMonth(placeType, monthIndex as MonthIndex);
  const daysInMonth = getDaysInMonth(monthIndex);
  const dailyTotalKwh = daysInMonth > 0 ? (consumptionKwhPerM2 / daysInMonth) * surfaceM2 : 0;
  return HOURLY_CONSUMPTION_PROFILE.map((f) => Math.round(dailyTotalKwh * f * 1000) / 1000);
}

/**
 * Obtient la consommation moyenne par catégorie
 */
export function getAverageConsumptionByCategory(category: string): number {
  const categoryData = BUILDING_ENERGY_CONSUMPTION_DATA.filter(
    (data) => data.category === category
  );
  
  if (categoryData.length === 0) return 170;
  
  const total = categoryData.reduce((sum, data) => sum + data.consumptionKwhPerM2, 0);
  return Math.round(total / categoryData.length);
}
