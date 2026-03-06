/**
 * Gestion de la persistance des prospects dans localStorage
 * Sauvegarde les surfaces de toit associées à chaque prospect (adresse + POI)
 */

import type { Prospect, RoofSurface } from "@/types";

const STORAGE_KEY_PREFIX = "prospect_surfaces_";

/**
 * Génère une clé unique pour un prospect basée sur son adresse et son nom
 */
function getProspectStorageKey(prospect: Prospect): string {
  // Utiliser l'adresse et le nom pour créer une clé unique
  const address = prospect.address || "";
  const name = prospect.name || "";
  // Créer un hash simple basé sur l'adresse et le nom
  const key = `${address}_${name}`.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  return `${STORAGE_KEY_PREFIX}${key}`;
}

/**
 * Sauvegarde les surfaces d'un prospect dans localStorage
 */
export function saveProspectSurfaces(prospect: Prospect): void {
  if (typeof window === "undefined") return;
  if (!prospect.address) return; // Pas de sauvegarde si pas d'adresse

  try {
    const surfaces = prospect.roofSurfaces || 
      (prospect.roofSurface.area > 0 ? [prospect.roofSurface] : []);
    
    // Ne sauvegarder que si on a des surfaces
    if (surfaces.length === 0) return;

    const storageKey = getProspectStorageKey(prospect);
    const data = {
      address: prospect.address,
      name: prospect.name || "",
      coordinates: prospect.coordinates,
      surfaces: surfaces.map(s => ({
        id: s.id,
        area: s.area,
        polygon: s.polygon,
        availablePercentage: s.availablePercentage,
        orientation: s.orientation,
      })),
      updatedAt: new Date().toISOString(),
    };

    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des surfaces du prospect:", error);
  }
}

/**
 * Charge les surfaces sauvegardées pour un prospect depuis localStorage
 */
export function loadProspectSurfaces(prospect: Prospect): RoofSurface[] {
  if (typeof window === "undefined") return [];
  if (!prospect.address) return [];

  try {
    const storageKey = getProspectStorageKey(prospect);
    const saved = localStorage.getItem(storageKey);
    
    if (!saved) return [];

    const data = JSON.parse(saved);
    
    // Vérifier que l'adresse correspond (au cas où il y aurait un conflit)
    if (data.address !== prospect.address) return [];

    return data.surfaces || [];
  } catch (error) {
    console.error("Erreur lors du chargement des surfaces du prospect:", error);
    return [];
  }
}

/**
 * Supprime les surfaces sauvegardées pour un prospect
 */
export function deleteProspectSurfaces(prospect: Prospect): void {
  if (typeof window === "undefined") return;
  if (!prospect.address) return;

  try {
    const storageKey = getProspectStorageKey(prospect);
    localStorage.removeItem(storageKey);
  } catch (error) {
    console.error("Erreur lors de la suppression des surfaces du prospect:", error);
  }
}

/**
 * Récupère tous les prospects sauvegardés dans localStorage
 */
export function getAllSavedProspects(): Array<{
  address: string;
  name: string;
  coordinates: { lat: number; lng: number };
  surfaces: RoofSurface[];
  updatedAt: string;
}> {
  if (typeof window === "undefined") return [];

  try {
    const prospects: Array<{
      address: string;
      name: string;
      coordinates: { lat: number; lng: number };
      surfaces: RoofSurface[];
      updatedAt: string;
    }> = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        try {
          const saved = localStorage.getItem(key);
          if (saved) {
            const data = JSON.parse(saved);
            prospects.push(data);
          }
        } catch (e) {
          // Ignorer les clés invalides
        }
      }
    }

    return prospects;
  } catch (error) {
    console.error("Erreur lors de la récupération des prospects sauvegardés:", error);
    return [];
  }
}
