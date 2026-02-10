/**
 * Gestion des paramètres d'équipement solaire
 * Les paramètres sont stockés dans localStorage et peuvent être utilisés
 * pour les calculs de potentiel solaire
 */

import type { SolarEquipmentSettings, SolarPanelType, InverterType } from "@/types";

const STORAGE_KEY = "solarEquipmentSettings";

/**
 * Valeurs par défaut des paramètres
 */
export const DEFAULT_SOLAR_SETTINGS: SolarEquipmentSettings = {
  panelType: "monocrystalline",
  inverterType: "string_inverter",
  panelPowerW: 400,
  panelEfficiency: 20,
};

/**
 * Récupère les paramètres d'équipement solaire depuis localStorage
 */
export function getSolarEquipmentSettings(): SolarEquipmentSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SOLAR_SETTINGS;
  }

  try {
    const savedSettings = localStorage.getItem(STORAGE_KEY);
    if (savedSettings) {
      const settings = JSON.parse(savedSettings) as SolarEquipmentSettings;
      return {
        ...DEFAULT_SOLAR_SETTINGS,
        ...settings,
      };
    }
  } catch (error) {
    console.error("Erreur lors de la récupération des paramètres:", error);
  }

  return DEFAULT_SOLAR_SETTINGS;
}

/**
 * Sauvegarde les paramètres d'équipement solaire dans localStorage
 */
export function saveSolarEquipmentSettings(settings: SolarEquipmentSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des paramètres:", error);
  }
}

/**
 * Caractéristiques typiques par type de panneau
 */
export const PANEL_TYPE_CHARACTERISTICS: Record<SolarPanelType, {
  label: string;
  typicalEfficiency: number; // %
  typicalPowerW: number; // W
  description: string;
}> = {
  monocrystalline: {
    label: "Monocristallin",
    typicalEfficiency: 20,
    typicalPowerW: 400,
    description: "Rendement élevé, meilleur pour espaces limités",
  },
  polycrystalline: {
    label: "Polycristallin",
    typicalEfficiency: 17,
    typicalPowerW: 350,
    description: "Bon rapport qualité/prix",
  },
  thin_film: {
    label: "Couche mince",
    typicalEfficiency: 12,
    typicalPowerW: 200,
    description: "Léger et flexible, moins efficace",
  },
  bifacial: {
    label: "Bifacial",
    typicalEfficiency: 22,
    typicalPowerW: 450,
    description: "Capture la lumière des deux côtés",
  },
};

/**
 * Caractéristiques typiques par type d'onduleur
 */
export const INVERTER_TYPE_CHARACTERISTICS: Record<InverterType, {
  label: string;
  efficiency: number; // %
  description: string;
  costPerWatt: number; // €/W approximatif
}> = {
  central_inverter: {
    label: "Onduleur central",
    efficiency: 96,
    description: "Pour grandes installations, coût réduit",
    costPerWatt: 0.15,
  },
  string_inverter: {
    label: "Onduleur string",
    efficiency: 97,
    description: "Équilibre entre coût et performance",
    costPerWatt: 0.20,
  },
  micro_inverter: {
    label: "Micro-onduleur",
    efficiency: 96.5,
    description: "Optimisation par panneau, meilleur rendement",
    costPerWatt: 0.35,
  },
  power_optimizer: {
    label: "Optimiseur de puissance",
    efficiency: 98,
    description: "Optimisation avec onduleur central",
    costPerWatt: 0.30,
  },
};

/**
 * Calcule le nombre de panneaux nécessaires pour une surface donnée
 */
export function calculatePanelCount(
  availableAreaM2: number,
  settings: SolarEquipmentSettings = getSolarEquipmentSettings()
): number {
  const panelAreaM2 = 1.6; // Surface moyenne d'un panneau en m² (environ 1m x 1.6m)
  const panelCount = Math.floor(availableAreaM2 / panelAreaM2);
  return Math.max(0, panelCount);
}

/**
 * Calcule la puissance totale installée en kW
 */
export function calculateTotalPowerKW(
  panelCount: number,
  settings: SolarEquipmentSettings = getSolarEquipmentSettings()
): number {
  const panelPowerW = settings.panelPowerW || PANEL_TYPE_CHARACTERISTICS[settings.panelType].typicalPowerW;
  return (panelCount * panelPowerW) / 1000; // Conversion en kW
}

/**
 * Calcule la production annuelle estimée en kWh
 */
export function calculateAnnualProductionKWh(
  panelCount: number,
  sunshineHoursPerYear: number,
  settings: SolarEquipmentSettings = getSolarEquipmentSettings()
): number {
  const panelPowerW = settings.panelPowerW || PANEL_TYPE_CHARACTERISTICS[settings.panelType].typicalPowerW;
  const panelEfficiency = settings.panelEfficiency || PANEL_TYPE_CHARACTERISTICS[settings.panelType].typicalEfficiency;
  const inverterEfficiency = INVERTER_TYPE_CHARACTERISTICS[settings.inverterType].efficiency / 100;
  
  const totalPowerKW = (panelCount * panelPowerW) / 1000;
  const productionKWh = totalPowerKW * sunshineHoursPerYear * (panelEfficiency / 100) * inverterEfficiency;
  
  return Math.round(productionKWh);
}
