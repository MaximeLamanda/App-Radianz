/**
 * Calcul du kWp (kilowatt-crête) à partir de la surface de toit dessinée
 *
 * RAISONNEMENT
 * ------------
 * 1. Surface de toit (m²)
 *    C’est l’aire du polygone dessiné sur la carte (formule de Shoelace sur
 *    des coordonnées projetées en mètres). Elle représente la surface du toit
 *    disponible pour des panneaux.
 *
 * 2. Surface réellement utilisable (m²)
 *    On ne peut pas couvrir 100 % du toit : obstacles (cheminées, velux),
 *    zones de circulation, espacement entre panneaux, orientation non idéale.
 *    On applique un coefficient d’utilisation typique :
 *      surface_utilisable = surface_toit × COEF_UTILISATION
 *    Valeur courante : 0,75 à 0,85 (on utilise 0,75 par défaut).
 *
 * 3. Puissance crête par m² de panneau (kWp/m²)
 *    Sous conditions STC (1000 W/m², 25 °C) :
 *      puissance_par_m² (Wp/m²) = rendement_panneau × 1000
 *    Ex. rendement 20 % → 200 Wp/m² = 0,2 kWp/m².
 *    Donc : powerPerM2Kw = (rendement / 100) × 1,0
 *
 * 4. Formule finale
 *    kWp = surface_toit (m²) × coef_utilisation × (rendement / 100)
 *    soit : kWp = surface_utilisable_m² × puissance_kWp_par_m²
 *
 * RÉSUMÉ
 * ------
 *   surface_dessinée (m²)  →  surface_utilisable  →  kWp
 *   avec surface_utilisable = surface × 0,75
 *   et kWp = surface_utilisable × (rendement/100)
 */

import {
  getSolarEquipmentSettings,
  DEFAULT_SOLAR_SETTINGS,
  PANEL_TYPE_CHARACTERISTICS,
} from "./solar-settings";
import type { SolarEquipmentSettings } from "@/types";

/** Coefficient d'utilisation du toit : part de la surface réellement couverte par les panneaux (0,75 = 75 %). */
export const DEFAULT_USABLE_ROOF_RATIO = 0.75;

/**
 * Calcule la puissance crête (kWp) à partir de la surface de toit en m².
 *
 * @param areaM2 - Surface du toit dessinée (m²)
 * @param settings - Paramètres panneaux (optionnel) ; sinon pris depuis localStorage ou défaut
 * @param usableRatio - Coefficient d'utilisation du toit (0 à 1) ; défaut 0,75
 * @returns kWp estimé (arrondi à 2 décimales)
 */
export function surfaceToKwp(
  areaM2: number,
  settings?: SolarEquipmentSettings | null,
  usableRatio: number = DEFAULT_USABLE_ROOF_RATIO
): number {
  if (areaM2 <= 0) return 0;

  const s = settings ?? (typeof window !== "undefined" ? getSolarEquipmentSettings() : DEFAULT_SOLAR_SETTINGS);
  const efficiency = s.panelEfficiency ?? PANEL_TYPE_CHARACTERISTICS[s.panelType].typicalEfficiency;
  const ratio = Math.max(0.01, Math.min(1, usableRatio));

  // surface utilisable (m²)
  const usableAreaM2 = areaM2 * ratio;
  // puissance crête par m² sous STC : (rendement % / 100) × 1 kW/m²
  const powerKwPerM2 = efficiency / 100;
  const kwp = usableAreaM2 * powerKwPerM2;

  return Math.round(kwp * 100) / 100;
}

/**
 * Retourne la surface utilisable (m²) à partir de la surface de toit et du coefficient.
 */
export function getUsableRoofAreaM2(
  areaM2: number,
  usableRatio: number = DEFAULT_USABLE_ROOF_RATIO
): number {
  if (areaM2 <= 0) return 0;
  const ratio = Math.max(0.01, Math.min(1, usableRatio));
  return Math.round((areaM2 * ratio) * 100) / 100;
}
