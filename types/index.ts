export interface AddressCoordinates {
  lat: number;
  lng: number;
}

export interface RoofSurface {
  id?: string; // Identifiant unique pour la surface
  area: number; // en m²
  polygon: Array<{ lat: number; lng: number }>;
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
  maxArrayPanelsCount: number;
  maxArrayAreaMeters2: number;
  maxSunshineHoursPerYear: number;
  maxKwhPerYear: number;
  carbonOffsetFactorKgPerMwh?: number;
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
