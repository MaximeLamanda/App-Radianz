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

import type { AddressCoordinates } from "@/types";

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
  optimalangles?: boolean; // Calculer les angles optimaux (défaut: true)
  pvtechchoice?: string; // Technologie PV (défaut: "crystSi")
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
    optimalangles: options.optimalangles !== false ? "1" : "0",
    pvtechchoice: options.pvtechchoice || "crystSi",
    outputformat: "json",
  });

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
