export interface AddressCoordinates {
  lat: number;
  lng: number;
}

export interface RoofSurface {
  id?: string; // Identifiant unique pour la surface
  area: number; // en m²
  polygon: Array<{ lat: number; lng: number }>;
  /** Pourcentage de surface disponible pour l'installation solaire (0-100). Défaut: 100% */
  availablePercentage?: number;
}

export interface Exposure {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Potentiel solaire d'un bâtiment
 */
export interface SolarPotential {
  // Champs existants
  maxArrayPanelsCount: number;
  maxArrayAreaMeters2: number;
  maxSunshineHoursPerYear: number;
  maxKwhPerYear: number;
  carbonOffsetFactorKgPerMwh?: number;
  
  /** Puissance crête estimée (kWp) à partir de la surface de toit dessinée (surface × coef. utilisation × rendement panneau). */
  estimatedKwp?: number;
  
  // Nouveaux champs pour données PVGIS
  optimalInclination?: number; // Angle d'inclinaison optimal en degrés
  optimalAzimuth?: number; // Orientation optimale (0=sud, 90=ouest, -90=est)
  annualIrradiation?: number; // Irradiation annuelle en kWh/m²
  monthlyProduction?: Array<{ month: number; production: number }>; // Production mensuelle
  monthlyIrradiation?: Array<{ month: number; irradiation: number }>; // Irradiation mensuelle
  pvgisDataFetched?: boolean; // Flag pour indiquer si les données PVGIS sont disponibles
}

// Type de lieu : utilise les types natifs de Google Places API
// Exemples: "restaurant", "store", "supermarket", "gym", "office", "warehouse", etc.
export type PlaceType = string;

export interface Contact {
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
}

export interface Prospect {
  id?: string;
  name?: string;
  address: string;
  coordinates: AddressCoordinates;
  roofSurface: RoofSurface; // Pour compatibilité avec l'ancien code
  roofSurfaces?: RoofSurface[]; // Tableau de surfaces multiples
  exposure?: Exposure;
  placeType: PlaceType;
  qualityScore: number; // 0-100
  contact?: Contact;
  thumbnailUrl?: string;
  solarPotential?: SolarPotential;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Lead {
  id: string;
  prospectId: string;
  name: string;
  qualityScore: number;
  contactName?: string;
  thumbnailUrl?: string;
  createdAt: Date;
}

/**
 * Types de lieux recherchables via Google Places API
 */
export type PlaceSearchType =
  | "factory" // Usine
  | "warehouse" // Entrepôt logistique
  | "industrial" // Zone industrielle
  | "storage" // Installation de stockage
  | "storage_facility" // Installation de stockage
  | "store" // Magasin
  | "supermarket" // Supermarché
  | "grocery_or_supermarket" // Supermarché
  | "office" // Bureau
  | "gym" // Salle de sport
  | "restaurant" // Restaurant
  | "shopping_mall"; // Centre commercial

/**
 * Résultat d'une recherche de lieu
 */
export interface PlaceSearchResult {
  placeId: string;
  name: string;
  address: string;
  coordinates: AddressCoordinates;
  placeType: string;
  rating?: number;
  userRatingsTotal?: number;
  types: string[];
  contact?: Contact;
}

/**
 * Types de panneaux solaires disponibles
 */
export type SolarPanelType = 
  | "monocrystalline" // Monocristallin
  | "polycrystalline" // Polycristallin
  | "thin_film" // Couche mince
  | "bifacial"; // Bifacial

/**
 * Types d'onduleurs/inverseurs disponibles
 */
export type InverterType =
  | "central_inverter" // Onduleur central
  | "string_inverter" // Onduleur string
  | "micro_inverter" // Micro-onduleur
  | "power_optimizer"; // Optimiseur de puissance

/**
 * Référence de panneau (marque/modèle) pour les paramètres
 * Stockée en localStorage pour l'instant ; migration Firestore prévue
 */
export interface PanelReference {
  id: string;
  name: string;
  panelType: SolarPanelType;
  powerW: number;
  efficiencyPercent: number;
  countryOfOrigin: string;
  /** Code pays ISO 3166-1 alpha-2 (ex. "cn") pour afficher le drapeau via API */
  countryCode?: string;
  costEur: number; // coût en € par panneau
  /** URL ou chemin de la photo du panneau (ex. /DM450M10RT-B54HBB.jpeg) */
  imageUrl?: string;
  /** Garantie en années (ex. 25) */
  warrantyYears?: number;
  /** Badge "Recommandé" */
  recommended?: boolean;
}

/**
 * Configuration des équipements solaires
 */
export interface SolarEquipmentSettings {
  panelType: SolarPanelType;
  inverterType: InverterType;
  panelPowerW?: number; // Puissance d'un panneau en W (optionnel)
  panelEfficiency?: number; // Rendement du panneau en % (optionnel)
}
