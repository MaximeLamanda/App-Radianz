/**
 * Gestion des paramètres d'équipement solaire
 * Les paramètres sont stockés dans localStorage et peuvent être utilisés
 * pour les calculs de potentiel solaire
 */

import type { SolarEquipmentSettings, SolarPanelType, InverterType, PanelReference, InverterReference, BatteryReference } from "@/types";
import { getPanelReferencesFromFirebase } from "./firestore-panel-references";
import { getInverterReferencesFromFirebase } from "./firestore-inverter-references";
import { getBatteryReferencesFromFirebase } from "./firestore-battery-references";
import type { BatterySimulationResult } from "./battery-simulation";

const STORAGE_KEY = "solarEquipmentSettings";

/** Activer les logs détaillés d'autoconsommation. Désactivé par défaut. */
const DEBUG_AUTOCONSO = false;
const STORAGE_KEY_PANEL_REFERENCES = "solarPanelReferences";
const STORAGE_KEY_INVERTER_REFERENCES = "solarInverterReferences";

/** URL du drapeau (FlagCDN) pour un code pays ISO 2 lettres */
export function getCountryFlagUrl(countryCode: string): string {
  const code = countryCode.toLowerCase().slice(0, 2);
  return `https://flagcdn.com/w80/${code}.png`;
}

/**
 * Valeurs par défaut des paramètres
 */
export const DEFAULT_SOLAR_SETTINGS: SolarEquipmentSettings = {
  panelType: "monocrystalline",
  inverterType: "string_inverter",
  panelPowerW: 400,
  panelEfficiency: 20,
  usableRoofRatio: 0.75,
  includeBattery: true,
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

/** URL de l'image du panneau par défaut : Firebase Storage si définie, sinon image locale */
const DEFAULT_PANEL_IMAGE_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEFAULT_PANEL_IMAGE_URL) ||
  "/DM450M10RT-B54HBB.jpeg";

/**
 * Références de panneau par défaut (utilisées pour l'init Firestore si vide)
 */
export const DEFAULT_PANEL_REFERENCES: PanelReference[] = [
  {
    id: "default-1",
    name: "DM450M10RT-B54HBB",
    panelType: "monocrystalline",
    powerW: 450,
    efficiencyPercent: 20.9,
    countryOfOrigin: "Chine",
    countryCode: "cn",
    costEur: 150,
    widthM: 1762 / 1000,   // 1762 mm → m
    lengthM: 1134 / 1000,  // 1134 mm → m
    imageUrl: DEFAULT_PANEL_IMAGE_URL,
    warrantyYears: 25,
    recommended: true,
  },
];

/**
 * Références d'onduleur par défaut (utilisées pour l'init Firestore si vide)
 */
export const DEFAULT_INVERTER_REFERENCES: InverterReference[] = [
  {
    id: "inverter-default-1",
    name: "SUN2000-10KTL-M1",
    inverterType: "string_inverter",
    powerW: 10000,
    efficiencyPercent: 98.4,
    countryOfOrigin: "Chine",
    countryCode: "cn",
    costEur: 2000,
    warrantyYears: 10,
    recommended: true,
  },
  {
    id: "inverter-default-2",
    name: "SMA Sunny Boy 5.0",
    inverterType: "string_inverter",
    powerW: 5000,
    efficiencyPercent: 97.5,
    countryOfOrigin: "Allemagne",
    countryCode: "de",
    costEur: 1200,
    warrantyYears: 10,
    recommended: false,
  },
  {
    id: "inverter-default-3",
    name: "Enphase IQ8+",
    inverterType: "micro_inverter",
    powerW: 295,
    efficiencyPercent: 97.5,
    countryOfOrigin: "États-Unis",
    countryCode: "us",
    costEur: 150,
    warrantyYears: 25,
    recommended: false,
  },
];

/**
 * Références de batterie par défaut (gamme LUNA2000)
 * 7/14/21-S1 pour < 100 kWp, 107-1S11 (Smart String ESS), 215-2S10 pour ≥ 100 kWp
 */
export const DEFAULT_BATTERY_REFERENCES: BatteryReference[] = [
  {
    id: "battery-luna2000-107-1s11",
    name: "HUAWEI LUNA2000-107-1S11",
    capacityKwh: 107,
    powerChargeKw: 108,
    powerDischargeKw: 108,
    roundTripEfficiencyPercent: 90,
    costEur: 55000,
    countryOfOrigin: "Chine",
    countryCode: "cn",
    imageUrl: "/AR0797-WS_visual.webp",
    warrantyYears: 10,
    recommended: false,
    maxKwpRecommended: 9999,
    maxBatteriesPerRack: 20,
  },
  {
    id: "battery-luna2000-7-s1",
    name: "LUNA2000-7-S1",
    capacityKwh: 7,
    powerChargeKw: 10.5,
    powerDischargeKw: 10.5,
    roundTripEfficiencyPercent: 90,
    costEur: 4500,
    countryOfOrigin: "Chine",
    countryCode: "cn",
    warrantyYears: 10,
    recommended: true,
    maxKwpRecommended: 100,
    maxBatteriesPerRack: 20,
  },
  {
    id: "battery-luna2000-14-s1",
    name: "LUNA2000-14-S1",
    capacityKwh: 14,
    powerChargeKw: 10.5,
    powerDischargeKw: 10.5,
    roundTripEfficiencyPercent: 90,
    costEur: 8000,
    countryOfOrigin: "Chine",
    countryCode: "cn",
    warrantyYears: 10,
    recommended: false,
    maxKwpRecommended: 100,
    maxBatteriesPerRack: 20,
  },
  {
    id: "battery-luna2000-21-s1",
    name: "LUNA2000-21-S1",
    capacityKwh: 21,
    powerChargeKw: 10.5,
    powerDischargeKw: 10.5,
    roundTripEfficiencyPercent: 90,
    costEur: 11000,
    countryOfOrigin: "Chine",
    countryCode: "cn",
    warrantyYears: 10,
    recommended: false,
    maxKwpRecommended: 100,
    maxBatteriesPerRack: 20,
  },
  {
    id: "battery-luna2000-215-2s10",
    name: "LUNA2000-215-2S10",
    capacityKwh: 215,
    powerChargeKw: 108,
    powerDischargeKw: 108,
    roundTripEfficiencyPercent: 90,
    costEur: 95000,
    countryOfOrigin: "Chine",
    countryCode: "cn",
    warrantyYears: 10,
    recommended: false,
    maxKwpRecommended: 9999,
    maxBatteriesPerRack: 20,
  },
];

/**
 * Récupère les références de panneau depuis localStorage
 */
export function getPanelReferences(): PanelReference[] {
  if (typeof window === "undefined") {
    return DEFAULT_PANEL_REFERENCES;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY_PANEL_REFERENCES);
    if (saved) {
      const list = JSON.parse(saved) as PanelReference[];
      return Array.isArray(list) && list.length > 0 ? list : DEFAULT_PANEL_REFERENCES;
    }
  } catch (error) {
    console.error("Erreur lors du chargement des références panneaux:", error);
  }
  return DEFAULT_PANEL_REFERENCES;
}

/**
 * Sauvegarde les références de panneau dans localStorage
 */
export function savePanelReferences(references: PanelReference[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_PANEL_REFERENCES, JSON.stringify(references));
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des références panneaux:", error);
  }
}

/**
 * Récupère les références d'onduleur depuis localStorage
 */
export function getInverterReferences(): InverterReference[] {
  if (typeof window === "undefined") {
    return DEFAULT_INVERTER_REFERENCES;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY_INVERTER_REFERENCES);
    if (saved) {
      const list = JSON.parse(saved) as InverterReference[];
      return Array.isArray(list) && list.length > 0 ? list : DEFAULT_INVERTER_REFERENCES;
    }
  } catch (error) {
    console.error("Erreur lors du chargement des références onduleurs:", error);
  }
  return DEFAULT_INVERTER_REFERENCES;
}

/**
 * Sauvegarde les références d'onduleur dans localStorage
 */
export function saveInverterReferences(references: InverterReference[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_INVERTER_REFERENCES, JSON.stringify(references));
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des références onduleurs:", error);
  }
}

/**
 * Récupère le panneau recommandé (celui avec recommended: true)
 * Version synchrone pour utilisation côté client
 */
export function getRecommendedPanelReferenceSync(): PanelReference | null {
  const localRefs = getPanelReferences();
  return localRefs.find(r => r.recommended === true) || null;
}

/**
 * Récupère le panneau recommandé (celui avec recommended: true)
 * Version async pour utilisation avec Firebase
 * @param userId - UID de l'utilisateur (propriétaire des références)
 */
export async function getRecommendedPanelReference(userId?: string | null): Promise<PanelReference | null> {
  if (!userId) return getRecommendedPanelReferenceSync();
  try {
    const refs = await getPanelReferencesFromFirebase(userId);
    const recommended = refs.find(r => r.recommended === true);
    if (recommended) return recommended;
  } catch (error) {
    // Ignorer l'erreur et utiliser le fallback
  }
  return getRecommendedPanelReferenceSync();
}

/**
 * Récupère l'onduleur recommandé (celui avec recommended: true)
 * Version synchrone pour utilisation côté client
 */
export function getRecommendedInverterReferenceSync(): InverterReference | null {
  const localRefs = getInverterReferences();
  return localRefs.find(r => r.recommended === true) || null;
}

/**
 * Récupère l'onduleur recommandé (celui avec recommended: true)
 * Version async pour utilisation avec Firebase
 * @param userId - UID de l'utilisateur (propriétaire des références)
 */
export async function getRecommendedInverterReference(userId?: string | null): Promise<InverterReference | null> {
  if (!userId) return getRecommendedInverterReferenceSync();
  try {
    const refs = await getInverterReferencesFromFirebase(userId);
    const recommended = refs.find(r => r.recommended === true);
    if (recommended) return recommended;
  } catch (error) {
    // Ignorer l'erreur et utiliser le fallback
  }
  return getRecommendedInverterReferenceSync();
}

/**
 * Récupère la batterie recommandée (celle avec recommended: true, ou la première)
 * Version synchrone pour utilisation côté client (fallback sur DEFAULT_BATTERY_REFERENCES)
 */
export function getRecommendedBatteryReferenceSync(batteryRefs?: BatteryReference[]): BatteryReference | null {
  const refs = batteryRefs ?? DEFAULT_BATTERY_REFERENCES;
  return refs.find(r => r.recommended === true) ?? refs[0] ?? null;
}

/**
 * Récupère la batterie recommandée (celle avec recommended: true)
 * Version async pour utilisation avec Firebase
 * @param userId - UID de l'utilisateur (propriétaire des références)
 */
export async function getRecommendedBatteryReference(userId?: string | null): Promise<BatteryReference | null> {
  if (!userId) return getRecommendedBatteryReferenceSync();
  try {
    const refs = await getBatteryReferencesFromFirebase(userId);
    const recommended = refs.find(r => r.recommended === true);
    if (recommended) return recommended;
    if (refs.length > 0) return refs[0];
  } catch {
    // Ignorer l'erreur et utiliser le fallback
  }
  return getRecommendedBatteryReferenceSync();
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
 * Utilise le panneau recommandé si disponible, sinon les paramètres par défaut
 */
/** Surface par défaut d'un panneau en m² (environ 1 m × 1,6 m) si dimensions non renseignées */
const DEFAULT_PANEL_AREA_M2 = 1.6;

export function calculatePanelCount(
  availableAreaM2: number,
  settings: SolarEquipmentSettings = getSolarEquipmentSettings(),
  recommendedPanel?: PanelReference | null
): number {
  const w = recommendedPanel?.widthM ?? 0;
  const l = recommendedPanel?.lengthM ?? 0;
  const panelAreaM2 = w > 0 && l > 0 ? w * l : DEFAULT_PANEL_AREA_M2;
  const panelCount = Math.floor(availableAreaM2 / panelAreaM2);
  return Math.max(0, panelCount);
}

/**
 * Calcule la puissance totale installée en kW
 * Utilise le panneau recommandé si disponible
 */
export function calculateTotalPowerKW(
  panelCount: number,
  settings: SolarEquipmentSettings = getSolarEquipmentSettings(),
  recommendedPanel?: PanelReference | null
): number {
  // Utiliser le panneau recommandé si disponible
  const panelPowerW = recommendedPanel?.powerW 
    || settings.panelPowerW 
    || PANEL_TYPE_CHARACTERISTICS[settings.panelType].typicalPowerW;
  return (panelCount * panelPowerW) / 1000; // Conversion en kW
}

/**
 * Calcule la production annuelle estimée en kWh
 * Utilise le panneau et l'onduleur recommandés si disponibles
 */
export function calculateAnnualProductionKWh(
  panelCount: number,
  sunshineHoursPerYear: number,
  settings: SolarEquipmentSettings = getSolarEquipmentSettings(),
  recommendedPanel?: PanelReference | null,
  recommendedInverter?: InverterReference | null
): number {
  // Utiliser le panneau recommandé si disponible
  const panelPowerW = recommendedPanel?.powerW 
    || settings.panelPowerW 
    || PANEL_TYPE_CHARACTERISTICS[settings.panelType].typicalPowerW;
  
  const panelEfficiency = recommendedPanel?.efficiencyPercent 
    || settings.panelEfficiency 
    || PANEL_TYPE_CHARACTERISTICS[settings.panelType].typicalEfficiency;
  
  // Utiliser l'onduleur recommandé si disponible
  const inverterEfficiency = recommendedInverter?.efficiencyPercent 
    ? recommendedInverter.efficiencyPercent / 100
    : INVERTER_TYPE_CHARACTERISTICS[settings.inverterType].efficiency / 100;
  
  const totalPowerKW = (panelCount * panelPowerW) / 1000;
  const productionKWh = totalPowerKW * sunshineHoursPerYear * (panelEfficiency / 100) * inverterEfficiency;
  
  return Math.round(productionKWh);
}

/**
 * Calcule le nombre d'onduleurs nécessaires pour une puissance donnée
 * Utilise l'onduleur recommandé si disponible
 */
export function calculateInverterCount(
  totalPowerKW: number,
  recommendedInverter?: InverterReference | null
): number {
  if (!recommendedInverter) {
    // Si pas d'onduleur recommandé, utiliser une estimation basée sur le type par défaut
    const defaultInverterPowerKW = 10; // 10kW par défaut
    return Math.ceil(totalPowerKW / defaultInverterPowerKW);
  }
  
  const inverterPowerKW = recommendedInverter.powerW / 1000;
  return Math.ceil(totalPowerKW / inverterPowerKW);
}

/** Prix de l'électricité par défaut (€/kWh) pour le calcul des économies */
export const DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH = 0.20;

/** Prix de rachat EDF OA (obligation d'achat) par défaut en €/kWh pour l'injection sur le réseau */
export const DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH = 0.053;

/** Résultat du calcul d'économies avec distinction autoconsommation / injection */
export interface SavingsBreakdown {
  /** kWh autoconsommés (min(production, consommation)) */
  selfConsumptionKwh: number;
  /** kWh injectés sur le réseau (max(0, production - consommation)) */
  excessKwh: number;
  /** Économies annuelles en € (autoconsommation × prix retail + injection × prix rachat) */
  annualSavingsEur: number;
}

export type { BatterySimulationResult };

/**
 * Économies annuelles avec batterie (sorties simulation).
 * Autoconsommation directe + via batterie × prix retail, injection × tarif rachat.
 */
export function estimateAnnualSavingsEurWithBattery(
  simulationResult: BatterySimulationResult,
  retailPriceEurPerKwh: number = DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH,
  feedInPriceEurPerKwh: number = DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH
): number {
  const selfKwh =
    simulationResult.selfConsumptionDirectKwh + simulationResult.selfConsumptionViaBatteryKwh;
  const savings = Math.round(
    selfKwh * retailPriceEurPerKwh + simulationResult.excessKwh * feedInPriceEurPerKwh
  );
  if (DEBUG_AUTOCONSO && process.env.NODE_ENV === "development") {
    const autoEur = selfKwh * retailPriceEurPerKwh;
    const injEur = simulationResult.excessKwh * feedInPriceEurPerKwh;
    console.log("[Autoconsommation] estimateAnnualSavingsEurWithBattery —", {
      autoconsommationKwh: selfKwh,
      autoconsommationEur: Math.round(autoEur),
      injectionKwh: simulationResult.excessKwh,
      injectionEur: Math.round(injEur),
      totalSavingsEur: savings,
    });
  }
  return savings;
}

/**
 * Calcule les économies annuelles en distinguant autoconsommation et injection.
 * - Autoconsommation : valorisée au prix de détail (économie sur la facture)
 * - Injection : valorisée au tarif de rachat (plus bas que le prix de détail)
 */
export function estimateAnnualSavingsEurWithBreakdown(
  annualProductionKwh: number,
  annualConsumptionKwh: number,
  retailPriceEurPerKwh: number = DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH,
  feedInPriceEurPerKwh: number = DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH
): SavingsBreakdown {
  const selfConsumptionKwh = Math.min(annualProductionKwh, annualConsumptionKwh);
  const excessKwh = Math.max(0, annualProductionKwh - annualConsumptionKwh);
  const annualSavingsEur = Math.round(
    selfConsumptionKwh * retailPriceEurPerKwh + excessKwh * feedInPriceEurPerKwh
  );
  return { selfConsumptionKwh, excessKwh, annualSavingsEur };
}

/**
 * Estime le coût d'installation en € (équipement : panneaux + onduleurs + batterie optionnelle)
 */
export function estimateInstallationPriceEur(
  panelCount: number,
  inverterCount: number,
  recommendedPanel?: PanelReference | null,
  recommendedInverter?: InverterReference | null,
  recommendedBattery?: BatteryReference | null,
  batteryCount: number = 1
): number {
  const panelCost = (recommendedPanel?.costEur ?? 150) * panelCount;
  const inverterCost = (recommendedInverter?.costEur ?? 2000) * inverterCount;
  const batteryCost = (recommendedBattery?.costEur ?? 0) * batteryCount;
  return Math.round(panelCost + inverterCost + batteryCost);
}

/**
 * Ordres de grandeur C&I toiture France 2024-2025 (BOS + projet).
 * BOS : 0,4–0,9 €/Wc (fourchette basse 0,4–0,6 ; haute 0,7–0,9).
 * Projet / MO : 10–20 % du coût total (équipement + BOS).
 */
const BOS_EUR_PER_WP_MIN = 0.4; // €/Wc (installations simples)
const BOS_EUR_PER_WP_MAX = 0.9; // €/Wc (toitures complexes)
const PROJECT_PERCENT_MIN = 0.1; // 10 % (projets standards)
const PROJECT_PERCENT_MAX = 0.2; // 20 % (projets complexes)

export interface EstimatedTotalPriceRange {
  /** Coût équipement seul (panneaux + onduleurs) */
  equipmentEur: number;
  /** Fourchette basse totale (équipement + BOS min + projet 10 %) */
  totalMinEur: number;
  /** Fourchette haute totale (équipement + BOS max + projet 20 %) */
  totalMaxEur: number;
}

/**
 * Estime la fourchette de coût total en € (équipement + BOS + projet).
 * @param totalPowerKW Puissance crête en kW
 * @param equipmentEur Coût équipement (panneaux + onduleurs) en €
 */
export function estimateTotalPriceRangeEur(
  totalPowerKW: number,
  equipmentEur: number
): EstimatedTotalPriceRange {
  const powerWp = totalPowerKW * 1000;
  const bosMinEur = BOS_EUR_PER_WP_MIN * powerWp;
  const bosMaxEur = BOS_EUR_PER_WP_MAX * powerWp;
  const afterBosMin = equipmentEur + bosMinEur;
  const afterBosMax = equipmentEur + bosMaxEur;
  const totalMinEur = Math.round(afterBosMin * (1 + PROJECT_PERCENT_MIN));
  const totalMaxEur = Math.round(afterBosMax * (1 + PROJECT_PERCENT_MAX));
  return {
    equipmentEur,
    totalMinEur,
    totalMaxEur,
  };
}

/**
 * Estime les économies annuelles en €.
 * Si annualConsumptionKwh est fourni, distingue autoconsommation (prix retail) et injection (tarif rachat).
 * Sinon, applique le prix retail sur toute la production (comportement legacy).
 */
export function estimateAnnualSavingsEur(
  annualProductionKWh: number,
  priceEurPerKwh: number = DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH,
  annualConsumptionKwh?: number
): number {
  if (annualConsumptionKwh != null && annualConsumptionKwh >= 0) {
    return estimateAnnualSavingsEurWithBreakdown(
      annualProductionKWh,
      annualConsumptionKwh,
      priceEurPerKwh
    ).annualSavingsEur;
  }
  return Math.round(annualProductionKWh * priceEurPerKwh);
}

/**
 * Estime la facture énergétique annuelle en € (consommation × prix du kWh).
 * Utilise le même prix du kWh que les économies, personnalisable plus tard.
 */
export function estimateEnergyBillEur(
  annualConsumptionKWh: number,
  priceEurPerKwh: number = DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH
): number {
  return Math.round(annualConsumptionKWh * priceEurPerKwh);
}

/**
 * Retourne le nombre d'années pour rentabiliser l'installation (break-even)
 */
export function getBreakEvenYears(
  estimatedPriceEur: number,
  annualSavingsEur: number
): number | null {
  if (annualSavingsEur <= 0) return null;
  const years = estimatedPriceEur / annualSavingsEur;
  return Math.round(years * 10) / 10;
}
