/**
 * Gestion de la persistance de la position de la carte dans localStorage
 * Sauvegarde la dernière position (centre et zoom) où l'utilisateur était
 */

import type { AddressCoordinates } from "@/types";

const STORAGE_KEY = "last_map_position";

export interface MapPosition {
  center: AddressCoordinates;
  zoom?: number;
  updatedAt: string;
}

const DEFAULT_POSITION: MapPosition = {
  center: { lat: 48.5311, lng: 2.0508 }, // Roinville par défaut
  zoom: 13,
  updatedAt: new Date().toISOString(),
};

/**
 * Sauvegarde la position actuelle de la carte dans localStorage
 */
export function saveMapPosition(center: AddressCoordinates, zoom?: number): void {
  if (typeof window === "undefined") return;

  try {
    const position: MapPosition = {
      center,
      zoom,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch (error) {
    console.error("Erreur lors de la sauvegarde de la position de la carte:", error);
  }
}

/**
 * Charge la dernière position sauvegardée depuis localStorage
 */
export function loadMapPosition(): MapPosition | null {
  if (typeof window === "undefined") return null;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;

    const position = JSON.parse(saved) as MapPosition;
    
    // Vérifier que les coordonnées sont valides
    if (
      position.center &&
      typeof position.center.lat === "number" &&
      typeof position.center.lng === "number" &&
      !isNaN(position.center.lat) &&
      !isNaN(position.center.lng)
    ) {
      return position;
    }
    
    return null;
  } catch (error) {
    console.error("Erreur lors du chargement de la position de la carte:", error);
    return null;
  }
}

/**
 * Récupère la position par défaut
 */
export function getDefaultMapPosition(): MapPosition {
  return DEFAULT_POSITION;
}
