/** Statut du profil utilisateur pour les quotas API (BDNB, OSM) */
export type ProfileStatus = "admin" | "premium" | "starter" | "demo";

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
  /** Orientation du toit en degrés (azimut). 0 = Sud, 90 = Ouest, -90 = Est, 180 = Nord. Calculé depuis le polygone. */
  orientation?: number;
}

export interface Exposure {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Potentiel solaire d'un bâtiment
 * 
 * Source de vérité : productionPerKwpAnnual et productionPerKwpMonthly (données PVGIS pour 1 kWp).
 * La production affichée = productionPerKwp × kWp actuel (kWp = surfaceToKwp(surface)).
 * 
 * Les champs maxKwhPerYear, maxArrayAreaMeters2, monthlyProduction sont conservés pour migration
 * depuis les anciens prospects.
 */
export interface SolarPotential {
  maxArrayPanelsCount: number;
  maxArrayAreaMeters2?: number; // Déprécié, migration seulement
  maxSunshineHoursPerYear: number;
  maxKwhPerYear?: number; // Déprécié, migration seulement
  carbonOffsetFactorKgPerMwh?: number;
  
  /** Puissance crête estimée (kWp) à partir de la surface de toit dessinée. */
  estimatedKwp?: number;
  
  /** Production annuelle pour 1 kWp (kWh/kWp/an). Source de vérité PVGIS. */
  productionPerKwpAnnual?: number;
  /** Production mensuelle pour 1 kWp (kWh/kWp par mois). Source de vérité PVGIS. */
  productionPerKwpMonthly?: Array<{ month: number; production: number }>;
  
  optimalInclination?: number;
  optimalAzimuth?: number;
  annualIrradiation?: number;
  monthlyProduction?: Array<{ month: number; production: number }>; // Déprécié, migration
  monthlyIrradiation?: Array<{ month: number; irradiation: number }>;
  pvgisDataFetched?: boolean;
}

// Type de lieu : utilise les types natifs de Google Places API
// Exemples: "restaurant", "store", "supermarket", "gym", "office", "warehouse", etc.
export type PlaceType = string;

export interface Contact {
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
}

/** Référent commercial (personne qui a généré le lien / contact) */
export interface CommercialReferent {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  logoUrl?: string;
  /** Photo de profil du référent (utilisateur qui a généré le lien) */
  photoURL?: string;
  /** Lien Calendly / prise de RDV */
  calendlyUrl?: string;
}

/** Mode de configuration : Perfect fit (prod ≈ conso) ou Highest production (max surface) */
export type ProspectConfigurationMode = "perfect_fit" | "highest_production";

/** Statut du prospect dans le pipeline */
export type ProspectPipelineStatus =
  | "cree"
  | "envoye"
  | "ouvert"
  | "converti"
  | "perdu";

export interface Prospect {
  id?: string;
  name?: string;
  address: string;
  coordinates: AddressCoordinates;
  roofSurface: RoofSurface; // Pour compatibilité avec l'ancien code
  roofSurfaces?: RoofSurface[]; // Tableau de surfaces multiples
  exposure?: Exposure;
  placeType: PlaceType;
  placeId?: string; // Identifiant Google Places (pour recherche/détail)
  /** POI candidats (nearby Google) pour navigation précédent/suivant ; index courant = poiCandidateIndex */
  poiCandidates?: Array<{
    name: string;
    placeId?: string;
    coordinates?: { lat: number; lng: number };
  }>;
  poiCandidateIndex?: number;
  /** Position du POI sélectionné pour find-local-siren (le bâtiment reste dans coordinates) */
  poiCoordinates?: AddressCoordinates;
  qualityScore: number; // 0-100
  contact?: Contact;
  thumbnailUrl?: string;
  solarPotential?: SolarPotential;
  pipelineStatus?: ProspectPipelineStatus;
  configurationMode?: ProspectConfigurationMode;
  priceRangeMinEur?: number;
  priceRangeMaxEur?: number;
  breakEvenMinYears?: number | null;
  breakEvenMaxYears?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
  /** Données enrichies via API recherche-entreprises (api.gouv.fr) */
  siren?: string;
  siret?: string;
  companyLegalName?: string;
  companyManagerName?: string;
  companyAddress?: string;
  companyNaf?: string;
  /** Code tranche d’effectif INSEE (ex. 03), source API recherche-entreprises */
  companyTrancheEffectif?: string;
  companyPhone?: string;
  /** URL api.gouv directe qui a trouvé le résultat (pour affichage / test) */
  companyEnrichmentApiUrl?: string;
  /** Token pour lien partagé prospect */
  shareToken?: string;
  /** IP (telle que vue par le serveur) enregistrée quand le commercial génère / actualise le lien — pour détecter une ouverture « externe ». */
  shareLinkCreatorIp?: string;
  /** Nombre de sessions page partagée terminées (KPI lecture). */
  shareSessionCount?: number;
  /** Horodatage de la dernière session terminée. */
  shareLastSessionAt?: Date;
  /** Référent commercial (mock pour l'instant) */
  commercialReferent?: CommercialReferent;
  /** Consommation annuelle override saisie par le prospect (kWh) */
  annualConsumptionKwhOverride?: number;
  /** Consommations mensuelles override saisies par le prospect (kWh, Jan->Déc) */
  monthlyConsumptionKwhOverride?: number[];
  /** UID du propriétaire (Firebase Auth) */
  userId?: string;
  /** Année de construction du bâtiment (source BDNB), affichée quand disponible */
  anneeConstruction?: number | null;
  /** ID du bâtiment BDNB quand le prospect a été créé depuis un clic sur une tuile BDNB */
  bdnbBatimentId?: string;
  /** Override : inclure batterie pour ce prospect (si absent, réglage global settings.includeBattery). */
  includeBatteryOverride?: boolean;
  /** ID de la référence panneau sélectionnée pour ce prospect (sinon recommandé global) */
  panelReferenceId?: string;
  /** ID de la référence onduleur sélectionnée pour ce prospect */
  inverterReferenceId?: string;
  /** ID de la référence batterie sélectionnée pour ce prospect */
  batteryReferenceId?: string;
  /** Nombre de batteries (1 à maxBatteriesPerRack du modèle). Défaut 1 si absent. */
  batteryCount?: number;
  /** Prospect créé depuis la carte Discovery (matching V5) — seule source pipeline canonique. */
  pipelineEntrySource?: "discovery_v5";
  /** Identifiant de la ligne / cluster matching V5 à l’origine du prospect. */
  matchingV5RowId?: string;
  /** Aire approximative contour(s) parcelle(s) cadastrale(s) (m²), source Discovery. */
  parcelContourAreaM2?: number;
  /** Empreinte au sol bâtiments BDNB Σ (m²), source Discovery — aligné tiroir. */
  bdnbFootprintSumM2?: number;
}

export interface Lead {
  id: string;
  prospectId: string;
  name: string;
  qualityScore: number;
  contactName?: string;
  thumbnailUrl?: string;
  siren?: string;
  siret?: string;
  companyLegalName?: string;
  companyLegalForm?: string;
  companyAddress?: string;
  parcellesCount?: number;
  codeInsee?: string;
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
  /** Largeur d'un panneau en m (ex. 1). Utilisé avec lengthM pour le calcul du nombre de panneaux. */
  widthM?: number;
  /** Longueur d'un panneau en m (ex. 1.6). Utilisé avec widthM pour le calcul du nombre de panneaux. */
  lengthM?: number;
  /** URL ou chemin de la photo du panneau (ex. /DM450M10RT-B54HBB.jpeg) */
  imageUrl?: string;
  /** Garantie en années (ex. 25) */
  warrantyYears?: number;
  /** Badge "Recommandé" */
  recommended?: boolean;
  /**
   * Contrôle la visibilité côté prospect et l’inclusion dans les simulations.
   * Pour les panneaux : une seule ref doit être visible à la fois.
   */
  visible?: boolean;
}

/**
 * Référence d'onduleur (marque/modèle) pour les paramètres
 * Stockée dans Firebase Firestore
 */
export interface InverterReference {
  id: string;
  name: string;
  inverterType: InverterType;
  powerW: number; // Puissance maximale en W
  efficiencyPercent: number; // Rendement en %
  countryOfOrigin: string;
  /** Code pays ISO 3166-1 alpha-2 (ex. "de") pour afficher le drapeau via API */
  countryCode?: string;
  costEur: number; // coût en € par onduleur
  /** URL ou chemin de la photo de l'onduleur */
  imageUrl?: string;
  /** Garantie en années (ex. 10) */
  warrantyYears?: number;
  /** Badge "Recommandé" */
  recommended?: boolean;
  /** Contrôle la visibilité côté prospect et l’inclusion dans les simulations. */
  visible?: boolean;
}

/**
 * Référence de batterie (marque/modèle) pour les paramètres
 * Stockée dans Firebase Firestore : users/{userId}/battery_references
 */
export interface BatteryReference {
  id: string;
  name: string;
  capacityKwh: number;
  powerChargeKw: number;
  powerDischargeKw: number;
  roundTripEfficiencyPercent: number;
  costEur: number;
  countryOfOrigin: string;
  countryCode?: string;
  imageUrl?: string;
  warrantyYears?: number;
  recommended?: boolean;
  /** kWp max recommandé pour cette batterie (ex. 100 pour 215-2S10) */
  maxKwpRecommended?: number;
  /** Nombre max de batteries par rack pour ce modèle. Défaut 20 si absent. */
  maxBatteriesPerRack?: number;
  /** Contrôle la visibilité côté prospect et l’inclusion dans les simulations. */
  visible?: boolean;
}

/**
 * Configuration des équipements solaires
 */
export interface SolarEquipmentSettings {
  panelType: SolarPanelType;
  inverterType: InverterType;
  panelPowerW?: number; // Puissance d'un panneau en W (optionnel)
  panelEfficiency?: number; // Rendement du panneau en % (optionnel)
  /** Taux d'utilisation du toit (0–1) : part de la surface couverte par les panneaux. 0,75 = 75 %. */
  usableRoofRatio?: number;
  /** Inclure la batterie dans les calculs par défaut pour les nouveaux prospects. Défaut true. */
  includeBattery?: boolean;
}
