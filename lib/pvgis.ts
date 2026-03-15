/**
 * Bibliothèque pour interagir avec l'API PVGIS (Photovoltaic Geographical Information System)
 * de la Commission Européenne (re.jrc.ec.europa.eu/api/v5_3/PVcalc).
 *
 * Unités officielles des sorties PVGIS :
 * - peakpower : kW. L'app peut appeler avec 1 pour obtenir des valeurs par kWp, puis multiplier côté client.
 * - E_y / E_m : kWh (pour la puissance envoyée). Si peakpower=1 → production pour 1 kWp.
 * - H(i)_y / H(i)_m : kWh/m² (irradiation, inchangée par la puissance).
 * - slope / azimuth : degrés.
 */

import type { AddressCoordinates, SolarPotential } from "@/types";

/**
 * Interface pour les données PVGIS brutes (structure API v5_3)
 */
interface PVGISResponse {
  inputs: {
    location: {
      latitude: number;
      longitude: number;
      elevation: number;
    };
    meteo_data: {
      radiation_db: string;
      meteo_db: string;
      year_min: number;
      year_max: number;
      use_horizon: boolean;
    };
    mounting_system: {
      fixed: {
        slope: {
          value: number;
          optimal: boolean;
        };
        azimuth: {
          value: number;
          optimal: boolean;
        };
      };
    };
    pv_module: {
      technology: string;
      peak_power: number;
    };
    system: {
      loss: number;
    };
  };
  outputs: {
    totals: {
      fixed: {
        E_y: number; // kWh — production annuelle système
        "H(i)_y": number; // kWh/m² — irradiation annuelle plan des panneaux
        "SD_m": number;
        "SD_y": number;
      };
    };
    monthly: Array<{
      month: number;
      E_m: number; // kWh — production mensuelle
      "H(i)_m": number; // kWh/m² — irradiation mensuelle
      SD_m: number;
    }>;
    optimal?: {
      slope: { value: number }; // degrés
      azimuth: { value: number }; // degrés, 0=sud
    };
  };
  meta: {
    inputs: any;
    outputs: any;
  };
}

/**
 * Données PVGIS formatées pour l'app (unités identiques à l'API).
 */
export interface PVGISData {
  /** Production annuelle du système, kWh */
  annualProduction: number;
  /** Irradiation annuelle sur le plan des panneaux, kWh/m² */
  annualIrradiation: number;
  /** Angle d'inclinaison optimal, degrés */
  optimalInclination: number;
  /** Orientation optimale (0=sud, 90=ouest, -90=est), degrés */
  optimalAzimuth: number;
  /** Production mensuelle, kWh par mois */
  monthlyProduction: Array<{ month: number; production: number }>;
  /** Irradiation mensuelle sur le plan des panneaux, kWh/m² par mois */
  monthlyIrradiation: Array<{ month: number; irradiation: number }>;
  /** Heures équivalentes à 1000 W/m² sur l'année (approximation: irradiation annuelle en kWh/m²) */
  sunshineHoursEquivalent: number;
}

/**
 * Options pour l'appel PVGIS
 */
export interface PVGISOptions {
  lat: number;
  lon: number;
  peakpower?: number; // Puissance en kW (défaut: 1)
  loss?: number; // Pertes système en % (défaut: 14)
  optimalangles?: boolean; // Calculer les angles optimaux (défaut: true si slope/azimuth non fournis)
  pvtechchoice?: string; // Technologie PV (défaut: "crystSi")
  slope?: number; // Inclinaison en degrés (0-90). Si fourni, optimalangles sera false
  azimuth?: number; // Orientation en degrés (0=Sud, 90=Ouest, -90=Est). Si fourni, optimalangles sera false
}

/**
 * Construit l'URL pour l'API PVGIS
 */
function buildPVGISURL(options: PVGISOptions): string {
  const baseURL = "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc";
  const params = new URLSearchParams({
    lat: options.lat.toString(),
    lon: options.lon.toString(),
    peakpower: (options.peakpower || 1).toString(),
    loss: (options.loss || 14).toString(),
    pvtechchoice: options.pvtechchoice || "crystSi",
    outputformat: "json",
  });

  // Si slope ou azimuth sont fournis, utiliser des angles fixes (optimalangles=false)
  // Sinon, utiliser les angles optimaux (optimalangles=true)
  if (options.slope != null || options.azimuth != null) {
    params.append("optimalangles", "0");
    if (options.slope != null) {
      params.append("slope", options.slope.toString());
    }
    if (options.azimuth != null) {
      params.append("azimuth", options.azimuth.toString());
    }
  } else {
    params.append("optimalangles", options.optimalangles !== false ? "1" : "0");
  }

  return `${baseURL}?${params.toString()}`;
}

/**
 * Parse la réponse JSON de PVGIS et extrait les données pertinentes
 */
function parsePVGISResponse(response: any): PVGISData {
  // Gérer différentes structures de réponse PVGIS
  const totals = response.outputs?.totals?.fixed || {};
  
  // Les données mensuelles peuvent être dans monthly.fixed ou directement dans monthly
  let monthlyData = response.outputs?.monthly?.fixed || 
                    response.outputs?.monthly;
  
  // S'assurer que monthlyData est un tableau
  if (!Array.isArray(monthlyData)) {
    monthlyData = [];
  }
  const monthly = monthlyData;

  // Extraire les valeurs avec des fallbacks
  const annualProduction = totals.E_y || totals.Sum_energy_produced || 0;
  const annualIrradiation = totals["H(i)_y"] || totals.H_y || 0;

  // Heures équivalentes "plein soleil" (1000 W/m²) : valeur en kWh/m² ≈ heures à 1 kW/m²
  const sunshineHoursEquivalent = Math.round(annualIrradiation);

  // Extraire les angles optimaux depuis inputs.mounting_system.fixed
  const mountingSystem = response.inputs?.mounting_system?.fixed || {};
  const optimalInclination = mountingSystem.slope?.value || 
                             response.outputs?.optimal?.slope?.value ||
                             0;
  const optimalAzimuth = mountingSystem.azimuth?.value || 
                         response.outputs?.optimal?.azimuth?.value ||
                         0;

  return {
    annualProduction: Math.round(annualProduction),
    annualIrradiation: Math.round(annualIrradiation * 10) / 10, // Arrondir à 1 décimale
    optimalInclination: Math.round(optimalInclination * 10) / 10,
    optimalAzimuth: Math.round(optimalAzimuth * 10) / 10,
    monthlyProduction: monthly.map((m: any) => ({
      month: m.month || 0,
      production: Math.round(m.E_m || m.energy || 0),
    })),
    monthlyIrradiation: monthly.map((m: any) => ({
      month: m.month || 0,
      irradiation: Math.round((m["H(i)_m"] || m.irradiation || 0) * 10) / 10,
    })),
    sunshineHoursEquivalent,
  };
}

/**
 * Appelle l'API PVGIS et retourne les données formatées
 * 
 * @param coordinates Coordonnées géographiques
 * @param options Options supplémentaires pour l'appel PVGIS
 * @returns Données PVGIS formatées
 * @throws Error si l'appel échoue
 */
export async function getPVGISData(
  coordinates: AddressCoordinates,
  options?: Partial<PVGISOptions>
): Promise<PVGISData> {
  const pvgisOptions: PVGISOptions = {
    lat: coordinates.lat,
    lon: coordinates.lng,
    ...options,
  };

  const url = buildPVGISURL(pvgisOptions);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Trop de requêtes. Veuillez réessayer dans quelques instants.");
      }
      if (response.status === 529) {
        throw new Error("Service surchargé. Veuillez réessayer plus tard.");
      }
      throw new Error(`Erreur PVGIS: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Vérifier si la réponse contient une erreur
    if (data.error) {
      throw new Error(`Erreur PVGIS: ${data.error.message || JSON.stringify(data.error)}`);
    }

    // Vérifier si la réponse contient des outputs
    if (!data.outputs) {
      throw new Error("Réponse PVGIS invalide: pas de données outputs");
    }

    // Parser la réponse
    return parsePVGISResponse(data);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Erreur lors de l'appel à l'API PVGIS");
  }
}

/**
 * Valide les coordonnées géographiques
 */
export function validateCoordinates(coordinates: AddressCoordinates): boolean {
  return (
    typeof coordinates.lat === "number" &&
    typeof coordinates.lng === "number" &&
    coordinates.lat >= -90 &&
    coordinates.lat <= 90 &&
    coordinates.lng >= -180 &&
    coordinates.lng <= 180
  );
}

/** Profil solaire type (fraction par heure 0-23). Pic midi. */
const HOURLY_SOLAR = [0,0,0,0,0,0,0.02,0.05,0.08,0.1,0.11,0.12,0.12,0.11,0.1,0.08,0.06,0.04,0.02,0.01,0,0,0,0];
const SOLAR_SUM = HOURLY_SOLAR.reduce((a,b)=>a+b,0);

/** Nombre de jours dans un mois (monthIndex 0 = janvier, 11 = décembre). */
export function getDaysInMonth(monthIndex: number): number {
  return new Date(2000, monthIndex + 1, 0).getDate();
}

/**
 * Jour type production (24h) pour un mois donné.
 * Total journalier = production mensuelle du mois / jours du mois × kwp.
 * @param productionPerKwpMonthly Production mensuelle pour 1 kWp (mois 1–12)
 * @param monthIndex Mois 0 = janvier, 11 = décembre
 * @param kwp Puissance crête (kW)
 */
export function buildTypicalDayForMonth(
  productionPerKwpMonthly: Array<{ month: number; production: number }>,
  monthIndex: number,
  kwp: number
): number[] {
  const monthNum = monthIndex + 1;
  const prodMonth = productionPerKwpMonthly.find((m) => m.month === monthNum)?.production ?? 0;
  const daysInMonth = getDaysInMonth(monthIndex);
  const dailyKwh = daysInMonth > 0 ? (prodMonth / daysInMonth) * kwp : 0;
  return HOURLY_SOLAR.map((f) => Math.round((dailyKwh * (f / SOLAR_SUM)) * 100) / 100);
}

/**
 * Jour type production (24h) à partir des productions mensuelles PVGIS.
 * @param monthly Production mensuelle (kWh/mois) — peut être pour 1 kWp ou déjà scalée.
 * @param scaleFactor Facteur de mise à l'échelle (ex. effectiveKwp/kwpAtFetch). Si monthly est pour X kWp et on veut Y kWp, passer Y/X.
 */
export function buildTypicalDayFromMonthly(monthly: Array<{month:number;production:number}>, scaleFactor = 1): number[] {
  const annual = monthly.reduce((s,m)=>s+(m.production??0),0);
  const daily = (annual/365)*scaleFactor;
  return HOURLY_SOLAR.map(f=>Math.round((daily*f/SOLAR_SUM)*100)/100);
}

/** Plage plausible kWh/kWp/an (France/Europe). Utilisée pour la migration. */
const PRODUCTIBLE_MIN = 500;
const PRODUCTIBLE_MAX = 2000;

/**
 * Récupère productionPerKwp depuis un SolarPotential.
 * Utilise les nouveaux champs si présents, sinon dérive des anciens (migration).
 */
export function getProductionPerKwpFromSolarPotential(
  solarPotential: SolarPotential | undefined,
  /** Pour migration : kWp correspondant à maxArrayAreaMeters2 (surfaceToKwp(area)) */
  legacyKwpAtFetch?: number
): { productionPerKwpAnnual: number; productionPerKwpMonthly: Array<{ month: number; production: number }> } | null {
  if (!solarPotential) return null;
  if (
    solarPotential.productionPerKwpAnnual != null &&
    solarPotential.productionPerKwpAnnual > 0 &&
    solarPotential.productionPerKwpMonthly?.length
  ) {
    return {
      productionPerKwpAnnual: solarPotential.productionPerKwpAnnual,
      productionPerKwpMonthly: solarPotential.productionPerKwpMonthly,
    };
  }
  const maxKwh = solarPotential.maxKwhPerYear;
  const kwp = legacyKwpAtFetch;
  if (maxKwh != null && maxKwh > 0 && kwp != null && kwp > 0) {
    const derived = maxKwh / kwp;
    if (derived >= PRODUCTIBLE_MIN && derived <= PRODUCTIBLE_MAX) {
      const monthly = solarPotential.monthlyProduction;
      const perKwpMonthly =
        monthly?.length === 12
          ? monthly.map((m) => ({ month: m.month, production: (m.production ?? 0) / kwp }))
          : Array.from({ length: 12 }, (_, i) => ({
              month: i + 1,
              production: Math.round((derived / 12) * 100) / 100,
            }));
      return { productionPerKwpAnnual: derived, productionPerKwpMonthly: perKwpMonthly };
    }
  }
  return null;
}

/**
 * Calcule la production à partir des données PVGIS normalisées (par kWp).
 * production = productionPerKwp × kwp
 */
export function getProductionFromPerKwp(
  productionPerKwpAnnual: number,
  productionPerKwpMonthly: Array<{ month: number; production: number }>,
  kwp: number
): { annualKwh: number; monthlyProduction: Array<{ month: number; production: number }>; dailyTypical: number[] } {
  const annualKwh = Math.round(productionPerKwpAnnual * kwp);
  const monthlyProduction = productionPerKwpMonthly.map((m) => ({
    month: m.month,
    production: Math.round((m.production ?? 0) * kwp),
  }));
  const dailyTypical = buildTypicalDayFromMonthly(productionPerKwpMonthly, kwp);
  return { annualKwh, monthlyProduction, dailyTypical };
}

export interface PVGISHourlyTypicalDay { hourlyProduction: number[]; peakpower: number; }

export async function getPVGISHourlyTypicalDay(
  coordinates: AddressCoordinates,
  opts?: { peakpower?: number; loss?: number; monthlyProduction?: Array<{month:number;production:number}> }
): Promise<PVGISHourlyTypicalDay> {
  const peakpower = opts?.peakpower ?? 1;
  const fallback = (): PVGISHourlyTypicalDay => ({
    hourlyProduction: opts?.monthlyProduction?.length
      ? buildTypicalDayFromMonthly(opts.monthlyProduction, peakpower)
      : HOURLY_SOLAR.map(f=>Math.round(4*peakpower*(f/SOLAR_SUM)*100)/100),
    peakpower,
  });
  const url = `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?lat=${coordinates.lat}&lon=${coordinates.lng}&pvcalculation=1&peakpower=${peakpower}&loss=${opts?.loss??14}&optimalangles=1&outputformat=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(18000) });
    if (!res.ok) return fallback();
    const data = await res.json();
    const hourly = data.outputs?.hourly ?? data.outputs?.time_series;
    if (!Array.isArray(hourly)) return fallback();
    const byH = Array(24).fill(0); const cnt = Array(24).fill(0);
    for (const row of hourly) {
      const h = (row.hour ?? 0) % 24;
      // P = puissance en W (PVGIS seriescalc) ; E = énergie en Wh si présent. 1 W × 1 h = 1 Wh = 0,001 kWh.
      const raw = Number(row.P ?? row.E ?? 0);
      byH[h] += raw; cnt[h]++;
    }
    // PVGIS renvoie P en W (puissance). Énergie sur 1 h = P (W) × 1 h = P Wh → kWh = P/1000.
    const avgByHour = byH.map((s, h) => (cnt[h] ? s / cnt[h] : 0) / 1000);
    return { hourlyProduction: avgByHour.map((v) => Math.round(v * 100) / 100), peakpower };
  } catch { return fallback(); }
}
