/**
 * Préparation et lecture des prospects pour Firestore.
 * Schéma minimal sans redondance (voir analyse des doublons dans le plan).
 */

import { Timestamp } from "firebase/firestore";
import { getSatelliteImageUrl } from "./satellite-image";
import { getMapboxStaticUrl, hasMapboxToken } from "./mapbox-static";
import { normalizeProspectPipelineStatus } from "./prospect-pipeline-status";
import { getProductionFromPerKwp } from "./pvgis";
import type {
  Prospect,
  ProspectContact,
  ProspectContactOriginKind,
  ProspectPipelineStatus,
  ProspectConfigurationMode,
  RoofSurface,
  SolarPotential,
  Contact,
  AddressCoordinates,
  Exposure,
  CommercialReferent,
} from "@/types";

type ProspectContactFirestore = Omit<ProspectContact, "fetchedAt" | "createdAt" | "updatedAt"> & {
  fetchedAt?: Timestamp;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

function firestoreDateToDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof value === "object" && "toDate" in value) {
    const d = (value as { toDate: () => Date }).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : undefined;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

function dateToFirestoreTimestamp(value: Date | undefined): Timestamp | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return Timestamp.fromDate(d);
}

function parseProspectContactOriginKind(raw: unknown): ProspectContactOriginKind | undefined {
  if (raw === "poi" || raw === "parcelle" || raw === "etablissement" || raw === "autre") return raw;
  return undefined;
}

function parseProspectContactSource(raw: unknown): ProspectContact["source"] | undefined {
  if (raw === "apollo" || raw === "manual") return raw;
  return undefined;
}

function prospectContactFromFirestore(raw: unknown): ProspectContact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fullName = typeof r.fullName === "string" ? r.fullName.trim() : "";
  if (!fullName) return null;
  const source = parseProspectContactSource(r.source);
  if (!source) return null;

  const contact: ProspectContact = { fullName, source };
  if (typeof r.id === "string" && r.id.trim()) contact.id = r.id.trim();
  if (typeof r.poiKey === "string" && r.poiKey.trim()) contact.poiKey = r.poiKey.trim();
  const originKind = parseProspectContactOriginKind(r.originKind);
  if (originKind) contact.originKind = originKind;
  if (typeof r.originRef === "string" && r.originRef.trim()) contact.originRef = r.originRef.trim();
  if (typeof r.originLabel === "string" && r.originLabel.trim()) contact.originLabel = r.originLabel.trim();
  if (typeof r.firstName === "string" && r.firstName.trim()) contact.firstName = r.firstName.trim();
  if (typeof r.lastName === "string" && r.lastName.trim()) contact.lastName = r.lastName.trim();
  if (typeof r.title === "string" && r.title.trim()) contact.title = r.title.trim();
  if (typeof r.email === "string" && r.email.trim()) contact.email = r.email.trim();
  if (r.emailStatus === "verified" || r.emailStatus === "unverified" || r.emailStatus === "guessed") {
    contact.emailStatus = r.emailStatus;
  }
  if (typeof r.linkedinUrl === "string" && r.linkedinUrl.trim()) contact.linkedinUrl = r.linkedinUrl.trim();
  if (typeof r.phone === "string" && r.phone.trim()) contact.phone = r.phone.trim();
  if (typeof r.organizationName === "string" && r.organizationName.trim()) {
    contact.organizationName = r.organizationName.trim();
  }
  if (typeof r.organizationDomain === "string" && r.organizationDomain.trim()) {
    contact.organizationDomain = r.organizationDomain.trim();
  }
  const fetchedAt = firestoreDateToDate(r.fetchedAt);
  if (fetchedAt) contact.fetchedAt = fetchedAt;
  const createdAt = firestoreDateToDate(r.createdAt);
  if (createdAt) contact.createdAt = createdAt;
  const updatedAt = firestoreDateToDate(r.updatedAt);
  if (updatedAt) contact.updatedAt = updatedAt;
  return contact;
}

function prospectContactsFromFirestore(raw: unknown): ProspectContact[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const contacts = raw
    .map(prospectContactFromFirestore)
    .filter((c): c is ProspectContact => c !== null);
  return contacts.length > 0 ? contacts : [];
}

function prospectContactForFirestore(contact: ProspectContact): ProspectContactFirestore {
  const out: ProspectContactFirestore = {
    fullName: contact.fullName,
    source: contact.source,
  };
  if (contact.id) out.id = contact.id;
  if (contact.poiKey) out.poiKey = contact.poiKey;
  if (contact.originKind) out.originKind = contact.originKind;
  if (contact.originRef) out.originRef = contact.originRef;
  if (contact.originLabel) out.originLabel = contact.originLabel;
  if (contact.firstName) out.firstName = contact.firstName;
  if (contact.lastName) out.lastName = contact.lastName;
  if (contact.title) out.title = contact.title;
  if (contact.email) out.email = contact.email;
  if (contact.emailStatus) out.emailStatus = contact.emailStatus;
  if (contact.linkedinUrl) out.linkedinUrl = contact.linkedinUrl;
  if (contact.phone) out.phone = contact.phone;
  if (contact.organizationName) out.organizationName = contact.organizationName;
  if (contact.organizationDomain) out.organizationDomain = contact.organizationDomain;
  const fetchedAt = dateToFirestoreTimestamp(contact.fetchedAt);
  if (fetchedAt) out.fetchedAt = fetchedAt;
  const createdAt = dateToFirestoreTimestamp(contact.createdAt);
  if (createdAt) out.createdAt = createdAt;
  const updatedAt = dateToFirestoreTimestamp(contact.updatedAt);
  if (updatedAt) out.updatedAt = updatedAt;
  return out;
}

function prospectContactsForFirestore(
  contacts: ProspectContact[] | undefined
): ProspectContactFirestore[] | undefined {
  if (!contacts?.length) return undefined;
  return contacts.map(prospectContactForFirestore);
}

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
  companyTrancheEffectif?: string;
  companyEnrichmentApiUrl?: string;
  shareToken?: string;
  shareLinkCreatorIp?: string;
  shareSessionCount?: number;
  shareLastSessionAt?: Timestamp;
  commercialReferent?: CommercialReferent;
  annualConsumptionKwhOverride?: number;
  monthlyConsumptionKwhOverride?: number[];
  userId?: string;
  /** Année de construction (BDNB) */
  anneeConstruction?: number | null;
  /** Override : inclure batterie pour ce prospect (si absent, réglage global) */
  includeBatteryOverride?: boolean;
  panelReferenceId?: string;
  inverterReferenceId?: string;
  batteryReferenceId?: string;
  batteryCount?: number;
  pipelineEntrySource?: "discovery_v5";
  matchingV5RowId?: string;
  /** Clé combo Discovery (`combo:…`) — lookup strict inter-combos. */
  matchingV5ComboId?: string;
  /** Périmètre parcelles personnalisé (combo édité en Discovery). */
  matchingV5ParcelleIds?: string[];
  /** Bâtiments cochés (`bc:` / `osm:`) au moment de l’ajout pipeline. */
  matchingV5BuildingSelectionIds?: string[];
  /** Surface contour parcelle(s) (m²), Discovery. */
  parcelContourAreaM2?: number;
  /** Empreinte BDNB Σ (m²), Discovery. */
  bdnbFootprintSumM2?: number;
  /** Tag OSM activité principal (Discovery). */
  discoveryActivityZoneTag?: string;
  /** Contacts décisionnaires (Apollo + manuels), Discovery. */
  contacts?: ProspectContactFirestore[];
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
      const prodPerKwp =
        solarPotentialFiltered.productionPerKwpAnnual ?? solarPotential?.productionPerKwpAnnual;
      const prodPerKwpMonthly =
        solarPotentialFiltered.productionPerKwpMonthly ?? solarPotential?.productionPerKwpMonthly;
      if (prodPerKwp != null && prodPerKwp > 0) {
        if (prodPerKwpMonthly?.length === 12) {
          const { monthlyProduction } = getProductionFromPerKwp(
            prodPerKwp,
            prodPerKwpMonthly,
            options.estimatedKwp
          );
          solarPotentialFiltered.monthlyProduction = monthlyProduction;
          solarPotentialFiltered.maxKwhPerYear = monthlyProduction.reduce(
            (sum, m) => sum + m.production,
            0
          );
        } else {
          solarPotentialFiltered.maxKwhPerYear = Math.round(prodPerKwp * options.estimatedKwp);
        }
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

  doc.pipelineStatus = prospect.pipelineStatus ?? "cree";
  if (prospect.configurationMode) doc.configurationMode = prospect.configurationMode;

  // Stocker les valeurs passées par le drawer (même méthode que l'affichage, pas de recalcul)
  const priceRangeMinEur = options?.priceRangeMinEur ?? prospect.priceRangeMinEur;
  const priceRangeMaxEur = options?.priceRangeMaxEur ?? prospect.priceRangeMaxEur;
  const breakEvenMinYears = options?.breakEvenMinYears ?? prospect.breakEvenMinYears;
  const breakEvenMaxYears = options?.breakEvenMaxYears ?? prospect.breakEvenMaxYears;
  if (priceRangeMinEur != null) doc.priceRangeMinEur = priceRangeMinEur;
  if (priceRangeMaxEur != null) doc.priceRangeMaxEur = priceRangeMaxEur;
  if (breakEvenMinYears != null) doc.breakEvenMinYears = breakEvenMinYears;
  if (breakEvenMaxYears != null) doc.breakEvenMaxYears = breakEvenMaxYears;

  if (prospect.siren) doc.siren = prospect.siren;
  if (prospect.siret) doc.siret = prospect.siret;
  if (prospect.companyLegalName) doc.companyLegalName = prospect.companyLegalName;
  if (prospect.companyManagerName) doc.companyManagerName = prospect.companyManagerName;
  if (prospect.companyAddress) doc.companyAddress = prospect.companyAddress;
  if (prospect.companyNaf) doc.companyNaf = prospect.companyNaf;
  if (prospect.companyTrancheEffectif) doc.companyTrancheEffectif = prospect.companyTrancheEffectif;
  if (prospect.companyEnrichmentApiUrl) doc.companyEnrichmentApiUrl = prospect.companyEnrichmentApiUrl;
  if (prospect.shareToken) doc.shareToken = prospect.shareToken;
  if (prospect.shareLinkCreatorIp) doc.shareLinkCreatorIp = prospect.shareLinkCreatorIp;
  if (prospect.commercialReferent) {
    const cr = prospect.commercialReferent as unknown as Record<string, unknown>;
    doc.commercialReferent = Object.fromEntries(
      Object.entries(cr).filter(([, v]) => v !== undefined)
    ) as unknown as CommercialReferent;
  }
  if (prospect.annualConsumptionKwhOverride != null) doc.annualConsumptionKwhOverride = prospect.annualConsumptionKwhOverride;
  if (prospect.monthlyConsumptionKwhOverride && prospect.monthlyConsumptionKwhOverride.length === 12) {
    doc.monthlyConsumptionKwhOverride = prospect.monthlyConsumptionKwhOverride
      .map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0));
  }
  if (userId) doc.userId = userId;
  if (prospect.anneeConstruction != null) doc.anneeConstruction = prospect.anneeConstruction;
  if (prospect.includeBatteryOverride != null) doc.includeBatteryOverride = prospect.includeBatteryOverride;
  if (prospect.panelReferenceId) doc.panelReferenceId = prospect.panelReferenceId;
  if (prospect.inverterReferenceId) doc.inverterReferenceId = prospect.inverterReferenceId;
  if (prospect.batteryReferenceId) doc.batteryReferenceId = prospect.batteryReferenceId;
  if (prospect.batteryCount != null && prospect.batteryCount >= 1) doc.batteryCount = prospect.batteryCount;
  if (prospect.pipelineEntrySource) doc.pipelineEntrySource = prospect.pipelineEntrySource;
  if (prospect.matchingV5RowId) doc.matchingV5RowId = prospect.matchingV5RowId;
  if (prospect.matchingV5ComboId) doc.matchingV5ComboId = prospect.matchingV5ComboId.trim();
  if (prospect.matchingV5ParcelleIds?.length) {
    doc.matchingV5ParcelleIds = prospect.matchingV5ParcelleIds
      .map((id) => String(id).trim())
      .filter(Boolean);
  }
  if (prospect.matchingV5BuildingSelectionIds?.length) {
    doc.matchingV5BuildingSelectionIds = prospect.matchingV5BuildingSelectionIds
      .map((id) => String(id).trim())
      .filter(Boolean);
  }
  if (prospect.parcelContourAreaM2 != null && prospect.parcelContourAreaM2 > 0) {
    doc.parcelContourAreaM2 = Math.round(prospect.parcelContourAreaM2);
  }
  if (prospect.bdnbFootprintSumM2 != null && prospect.bdnbFootprintSumM2 > 0) {
    doc.bdnbFootprintSumM2 = Math.round(prospect.bdnbFootprintSumM2);
  }
  const discoveryActivityZoneTag = String(prospect.discoveryActivityZoneTag ?? "").trim().toLowerCase();
  if (discoveryActivityZoneTag) doc.discoveryActivityZoneTag = discoveryActivityZoneTag;
  const contacts = prospectContactsForFirestore(prospect.contacts);
  if (contacts?.length) doc.contacts = contacts;

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
  if (data.pipelineStatus) {
    result.pipelineStatus = normalizeProspectPipelineStatus(data.pipelineStatus);
  }
  if (data.shareLinkCreatorIp) result.shareLinkCreatorIp = data.shareLinkCreatorIp;
  if (typeof data.shareSessionCount === "number" && Number.isFinite(data.shareSessionCount)) {
    result.shareSessionCount = Math.max(0, Math.floor(data.shareSessionCount));
  }
  if (data.shareLastSessionAt?.toDate) {
    result.shareLastSessionAt = data.shareLastSessionAt.toDate();
  }
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
  if (data.companyTrancheEffectif) result.companyTrancheEffectif = data.companyTrancheEffectif;
  if (data.companyEnrichmentApiUrl) result.companyEnrichmentApiUrl = data.companyEnrichmentApiUrl;
  if (data.shareToken) result.shareToken = data.shareToken;
  if (data.commercialReferent) result.commercialReferent = data.commercialReferent;
  if (data.annualConsumptionKwhOverride != null) result.annualConsumptionKwhOverride = data.annualConsumptionKwhOverride;
  if (data.monthlyConsumptionKwhOverride?.length === 12) {
    result.monthlyConsumptionKwhOverride = data.monthlyConsumptionKwhOverride
      .map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0));
  }
  if (data.userId) result.userId = data.userId;
  if (data.anneeConstruction != null) result.anneeConstruction = data.anneeConstruction;
  if (data.includeBatteryOverride != null) result.includeBatteryOverride = data.includeBatteryOverride;
  if (data.panelReferenceId) result.panelReferenceId = data.panelReferenceId;
  if (data.inverterReferenceId) result.inverterReferenceId = data.inverterReferenceId;
  if (data.batteryReferenceId) result.batteryReferenceId = data.batteryReferenceId;
  if (data.batteryCount != null && data.batteryCount >= 1) result.batteryCount = data.batteryCount;
  if (data.pipelineEntrySource) result.pipelineEntrySource = data.pipelineEntrySource;
  if (data.matchingV5RowId) result.matchingV5RowId = data.matchingV5RowId;
  if (data.matchingV5ComboId) result.matchingV5ComboId = String(data.matchingV5ComboId).trim();
  if (data.matchingV5ParcelleIds?.length) {
    result.matchingV5ParcelleIds = data.matchingV5ParcelleIds
      .map((id) => String(id).trim())
      .filter(Boolean);
  }
  if (data.matchingV5BuildingSelectionIds?.length) {
    result.matchingV5BuildingSelectionIds = data.matchingV5BuildingSelectionIds
      .map((id) => String(id).trim())
      .filter(Boolean);
  }
  if (data.parcelContourAreaM2 != null && data.parcelContourAreaM2 > 0) {
    result.parcelContourAreaM2 = data.parcelContourAreaM2;
  }
  if (data.bdnbFootprintSumM2 != null && data.bdnbFootprintSumM2 > 0) {
    result.bdnbFootprintSumM2 = data.bdnbFootprintSumM2;
  }
  if (data.discoveryActivityZoneTag) {
    result.discoveryActivityZoneTag = String(data.discoveryActivityZoneTag).trim().toLowerCase();
  }
  const contacts = prospectContactsFromFirestore(data.contacts);
  if (contacts !== undefined) result.contacts = contacts;
  return result;
}
