/**
 * Préparation et lecture des prospects pour Firestore.
 * Schéma minimal sans redondance (voir analyse des doublons dans le plan).
 */

import { Timestamp } from "firebase/firestore";
import { getSatelliteImageUrl } from "./satellite-image";
import { getMapboxStaticUrl, hasMapboxToken } from "./mapbox-static";
import type {
  Prospect,
  ProspectPipelineStatus,
  ProspectConfigurationMode,
  RoofSurface,
  SolarPotential,
  Contact,
  AddressCoordinates,
  Exposure,
  CommercialReferent,
} from "@/types";

/** Structure du document prospect stocké en Firestore (sans doublons) */
export interface ProspectDocument {
  name?: string;
  address: string;
  coordinates: AddressCoordinates;
  placeType: string;
  placeId?: string;
  poiCandidates?: Array<{
    name: string;
    placeId?: string;
    coordinates?: { lat: number; lng: number };
  }>;
  poiCandidateIndex?: number;
  poiCoordinates?: AddressCoordinates;
  roofSurfaces?: RoofSurface[];
  exposure?: Exposure;
  qualityScore: number;
  contact?: Contact;
  thumbnailUrl?: string;
  solarPotential?: Omit<
    SolarPotential,
    "maxArrayPanelsCount" | "maxSunshineHoursPerYear"
  >;
  pipelineStatus?: ProspectPipelineStatus;
  configurationMode?: ProspectConfigurationMode;
  priceRangeMinEur?: number;
  priceRangeMaxEur?: number;
  breakEvenMinYears?: number | null;
  breakEvenMaxYears?: number | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  siren?: string;
  siret?: string;
  companyLegalName?: string;
  companyManagerName?: string;
  companyAddress?: string;
  companyNaf?: string;
  companyEnrichmentApiUrl?: string;
  shareToken?: string;
  commercialReferent?: CommercialReferent;
  annualConsumptionKwhOverride?: number;
  userId?: string;
  /** Année de construction (BDNB) */
  anneeConstruction?: number | null;
  /** Override : inclure batterie pour ce prospect (si absent, réglage global) */
  includeBatteryOverride?: boolean;
  panelReferenceId?: string;
  inverterReferenceId?: string;
  batteryReferenceId?: string;
  batteryCount?: number;
}

/** Valeurs calculées par le drawer, stockées telles quelles (pas de recalcul) */
export interface PrepareProspectOptions {
  /** kWp affiché (effectiveConfig.effectiveKwp) */
  estimatedKwp?: number;
  /** Fourchette min prix projet (€) */
  priceRangeMinEur?: number;
  /** Fourchette max prix projet (€) */
  priceRangeMaxEur?: number;
  /** Break-even années (min) */
  breakEvenMinYears?: number | null;
  /** Break-even années (max) */
  breakEvenMaxYears?: number | null;
}

/**
 * Prépare un prospect pour l'enregistrement dans Firestore.
 * @param userId - UID du propriétaire (Firebase Auth), requis pour l'enregistrement
 * - Exclut roofSurface (redondant avec roofSurfaces)
 * - Exclut maxArrayPanelsCount, maxSunshineHoursPerYear, monthlyIrradiation
 * - Génère thumbnailUrl si coordonnées valides
 * - Stocke kWp, fourchette prix, break-even (passés par le drawer, pas de recalcul)
 */
export function prepareProspectForFirestore(
  prospect: Prospect,
  options?: PrepareProspectOptions,
  userId?: string
): ProspectDocument {
  const solarPotential = prospect.solarPotential;
  let solarPotentialFiltered: ProspectDocument["solarPotential"] = solarPotential
    ? {
        productionPerKwpAnnual: solarPotential.productionPerKwpAnnual,
        productionPerKwpMonthly: solarPotential.productionPerKwpMonthly,
        maxArrayAreaMeters2: solarPotential.maxArrayAreaMeters2,
        maxKwhPerYear: solarPotential.maxKwhPerYear,
        optimalInclination: solarPotential.optimalInclination,
        optimalAzimuth: solarPotential.optimalAzimuth,
        annualIrradiation: solarPotential.annualIrradiation,
        monthlyProduction: solarPotential.monthlyProduction,
        estimatedKwp: solarPotential.estimatedKwp,
        pvgisDataFetched: solarPotential.pvgisDataFetched,
      }
    : undefined;

  // Supprimer les champs undefined du solarPotential
  if (solarPotentialFiltered) {
    const sp = solarPotentialFiltered;
    (Object.keys(sp) as (keyof typeof sp)[]).forEach((key) => {
      if (sp[key] === undefined) {
        delete sp[key];
      }
    });
  }

  const roofSurfaces =
    prospect.roofSurfaces && prospect.roofSurfaces.length > 0
      ? prospect.roofSurfaces
      : prospect.roofSurface?.area > 0
        ? [prospect.roofSurface]
        : [];

  // Utiliser estimatedKwp passé par le drawer (même valeur affichée), pas de recalcul
  if (options?.estimatedKwp != null && options.estimatedKwp > 0) {
    if (solarPotentialFiltered) {
      solarPotentialFiltered.estimatedKwp = options.estimatedKwp;
      // Calculer et stocker la production annuelle (kWh) pour l'affichage dans le pipeline
      const prodPerKwp = solarPotentialFiltered.productionPerKwpAnnual ?? solarPotential?.productionPerKwpAnnual;
      if (prodPerKwp != null && prodPerKwp > 0 && (solarPotentialFiltered.maxKwhPerYear == null || solarPotentialFiltered.maxKwhPerYear === 0)) {
        solarPotentialFiltered.maxKwhPerYear = Math.round(prodPerKwp * options.estimatedKwp);
      }
    } else {
      const totalArea =
        roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ??
        solarPotential?.maxArrayAreaMeters2 ??
        0;
      solarPotentialFiltered = {
        maxArrayAreaMeters2: totalArea,
        maxKwhPerYear: solarPotential?.maxKwhPerYear ?? 0,
        estimatedKwp: options.estimatedKwp,
      };
    }
  }

  let thumbnailUrl = prospect.thumbnailUrl;
  if (!thumbnailUrl && prospect.coordinates?.lat != null && prospect.coordinates?.lng != null) {
    // Préférer Mapbox satellite pour la vignette de la home table (dispo en EEA)
    if (hasMapboxToken()) {
      thumbnailUrl = getMapboxStaticUrl(prospect.coordinates, 200, 160, 17, "satellite-v9") || undefined;
    }
    if (!thumbnailUrl) {
      thumbnailUrl =
        getSatelliteImageUrl(
          prospect.coordinates,
          prospect.address || "",
          200,
          160,
          17
        ) || undefined;
    }
  }

  const doc: ProspectDocument = {
    name: prospect.name,
    address: prospect.address,
    coordinates: prospect.coordinates,
    placeType: prospect.placeType,
    roofSurfaces,
    qualityScore: prospect.qualityScore,
    solarPotential: solarPotentialFiltered,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  if (prospect.placeId) doc.placeId = prospect.placeId;
  if (prospect.poiCandidates && prospect.poiCandidates.length > 0) {
    doc.poiCandidates = prospect.poiCandidates;
  }
  if (prospect.poiCandidateIndex != null) doc.poiCandidateIndex = prospect.poiCandidateIndex;
  if (prospect.poiCoordinates) doc.poiCoordinates = prospect.poiCoordinates;
  if (prospect.exposure) doc.exposure = prospect.exposure;
  if (prospect.contact) doc.contact = prospect.contact;
  if (thumbnailUrl) doc.thumbnailUrl = thumbnailUrl;

  doc.pipelineStatus = prospect.pipelineStatus ?? "nouveau";
  if (prospect.configurationMode) doc.configurationMode = prospect.configurationMode;

  // Stocker les valeurs passées par le drawer (même méthode que l'affichage, pas de recalcul)
  if (options?.priceRangeMinEur != null) doc.priceRangeMinEur = options.priceRangeMinEur;
  if (options?.priceRangeMaxEur != null) doc.priceRangeMaxEur = options.priceRangeMaxEur;
  if (options?.breakEvenMinYears != null) doc.breakEvenMinYears = options.breakEvenMinYears;
  if (options?.breakEvenMaxYears != null) doc.breakEvenMaxYears = options.breakEvenMaxYears;

  if (prospect.siren) doc.siren = prospect.siren;
  if (prospect.siret) doc.siret = prospect.siret;
  if (prospect.companyLegalName) doc.companyLegalName = prospect.companyLegalName;
  if (prospect.companyManagerName) doc.companyManagerName = prospect.companyManagerName;
  if (prospect.companyAddress) doc.companyAddress = prospect.companyAddress;
  if (prospect.companyNaf) doc.companyNaf = prospect.companyNaf;
  if (prospect.companyEnrichmentApiUrl) doc.companyEnrichmentApiUrl = prospect.companyEnrichmentApiUrl;
  if (prospect.shareToken) doc.shareToken = prospect.shareToken;
  if (prospect.commercialReferent) {
    const cr = prospect.commercialReferent as unknown as Record<string, unknown>;
    doc.commercialReferent = Object.fromEntries(
      Object.entries(cr).filter(([, v]) => v !== undefined)
    ) as unknown as CommercialReferent;
  }
  if (prospect.annualConsumptionKwhOverride != null) doc.annualConsumptionKwhOverride = prospect.annualConsumptionKwhOverride;
  if (userId) doc.userId = userId;
  if (prospect.anneeConstruction != null) doc.anneeConstruction = prospect.anneeConstruction;
  if (prospect.includeBatteryOverride != null) doc.includeBatteryOverride = prospect.includeBatteryOverride;
  if (prospect.panelReferenceId) doc.panelReferenceId = prospect.panelReferenceId;
  if (prospect.inverterReferenceId) doc.inverterReferenceId = prospect.inverterReferenceId;
  if (prospect.batteryReferenceId) doc.batteryReferenceId = prospect.batteryReferenceId;
  if (prospect.batteryCount != null && prospect.batteryCount >= 1) doc.batteryCount = prospect.batteryCount;

  return doc;
}

/** Données brutes Firestore (peut inclure roofSurface pour docs legacy) */
export type ProspectFirestoreData = ProspectDocument & { roofSurface?: RoofSurface };

/**
 * Convertit un document Firestore en Prospect (type applicatif).
 * - Reconstruit roofSurface à partir de roofSurfaces (ou roofSurface legacy)
 * - Dérive maxSunshineHoursPerYear de annualIrradiation
 */
export function prospectFromFirestore(
  id: string,
  data: ProspectFirestoreData
): Prospect {
  const roofSurfaces =
    data.roofSurfaces && data.roofSurfaces.length > 0
      ? data.roofSurfaces
      : data.roofSurface
        ? [data.roofSurface]
        : [];
  const roofSurface: RoofSurface =
    roofSurfaces.length > 0
      ? roofSurfaces[roofSurfaces.length - 1]
      : { area: 0, polygon: [] };

  const solarPotential: SolarPotential | undefined = data.solarPotential
    ? {
        ...data.solarPotential,
        maxArrayPanelsCount: 0,
        maxSunshineHoursPerYear: Math.round(
          data.solarPotential.annualIrradiation ?? 0
        ),
        productionPerKwpAnnual: data.solarPotential.productionPerKwpAnnual,
        productionPerKwpMonthly: data.solarPotential.productionPerKwpMonthly,
        maxArrayAreaMeters2: data.solarPotential.maxArrayAreaMeters2 ?? 0,
        maxKwhPerYear: data.solarPotential.maxKwhPerYear ?? 0,
      }
    : undefined;

  const result: Prospect = {
    id,
    name: data.name,
    address: data.address,
    coordinates: data.coordinates,
    roofSurface,
    roofSurfaces: roofSurfaces.length > 0 ? roofSurfaces : undefined,
    exposure: data.exposure,
    placeType: data.placeType,
    placeId: data.placeId,
    qualityScore: data.qualityScore,
    contact: data.contact,
    thumbnailUrl: data.thumbnailUrl,
    solarPotential,
    createdAt: data.createdAt?.toDate?.() ?? undefined,
    updatedAt: data.updatedAt?.toDate?.() ?? undefined,
  };
  if (data.poiCandidates?.length) result.poiCandidates = data.poiCandidates;
  if (data.poiCandidateIndex != null) result.poiCandidateIndex = data.poiCandidateIndex;
  if (data.poiCoordinates) result.poiCoordinates = data.poiCoordinates;
  if (data.pipelineStatus) result.pipelineStatus = data.pipelineStatus;
  if (data.configurationMode) result.configurationMode = data.configurationMode;
  if (data.priceRangeMinEur != null) result.priceRangeMinEur = data.priceRangeMinEur;
  if (data.priceRangeMaxEur != null) result.priceRangeMaxEur = data.priceRangeMaxEur;
  if (data.breakEvenMinYears != null) result.breakEvenMinYears = data.breakEvenMinYears;
  if (data.breakEvenMaxYears != null) result.breakEvenMaxYears = data.breakEvenMaxYears;
  if (data.siren) result.siren = data.siren;
  if (data.siret) result.siret = data.siret;
  if (data.companyLegalName) result.companyLegalName = data.companyLegalName;
  if (data.companyManagerName) result.companyManagerName = data.companyManagerName;
  if (data.companyAddress) result.companyAddress = data.companyAddress;
  if (data.companyNaf) result.companyNaf = data.companyNaf;
  if (data.companyEnrichmentApiUrl) result.companyEnrichmentApiUrl = data.companyEnrichmentApiUrl;
  if (data.shareToken) result.shareToken = data.shareToken;
  if (data.commercialReferent) result.commercialReferent = data.commercialReferent;
  if (data.annualConsumptionKwhOverride != null) result.annualConsumptionKwhOverride = data.annualConsumptionKwhOverride;
  if (data.userId) result.userId = data.userId;
  if (data.anneeConstruction != null) result.anneeConstruction = data.anneeConstruction;
  if (data.includeBatteryOverride != null) result.includeBatteryOverride = data.includeBatteryOverride;
  if (data.panelReferenceId) result.panelReferenceId = data.panelReferenceId;
  if (data.inverterReferenceId) result.inverterReferenceId = data.inverterReferenceId;
  if (data.batteryReferenceId) result.batteryReferenceId = data.batteryReferenceId;
  if (data.batteryCount != null && data.batteryCount >= 1) result.batteryCount = data.batteryCount;
  return result;
}
