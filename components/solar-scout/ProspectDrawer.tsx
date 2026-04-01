"use client";

import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode, type ComponentType } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, X, Loader2, AlertCircle, Zap, FileCheck, Info, Building2, MapPin, Hash, Tag, User, Phone, Maximize2, Link2, Eye, Map, PenTool, ExternalLink, Calendar, Battery, ChevronLeft, ChevronRight } from "lucide-react";
import { addProspectToPipeline, createLeadFromProspect, updateProspectInPipeline, updateProspect } from "@/lib/firestore";
import { logPolygonDrawer } from "@/lib/debug-polygon-drawer";

/** Activer les logs détaillés d'autoconsommation. Désactivé par défaut. */
const DEBUG_AUTOCONSO = false;
import { translatePlaceType } from "@/lib/place-types-translation";
import { MonthlyProductionChart } from "./MonthlyProductionChart";
import { BatterySelectCard } from "./BatterySelectCard";
import { EquipmentSelectCard, EquipmentThumbnail } from "./EquipmentSelectCard";
import { surfaceToKwp, getUsableRoofAreaM2 } from "@/lib/surface-to-kwp";
import {
  BUILDING_ENERGY_CONSUMPTION_DATA,
  getEnergyConsumption,
  getEnergyConsumptionForMonth,
  getHourlyConsumptionProfileKwhPerM2,
  isKnownPlaceType,
  normalizePlaceTypeForConsumption,
  type MonthIndex,
} from "@/lib/building-energy-consumption";
import {
  getProductionFromPerKwp,
  getProductionPerKwpFromSolarPotential,
  buildTypicalDayForMonth,
} from "@/lib/pvgis";
import { buildTypicalConsumptionDayForMonth } from "@/lib/building-energy-consumption";
import { runProductionSimulation, runSimulationOneDayForChart, scaleBatteryForCount } from "@/lib/battery-simulation";
import { computeRecommendedBatteryTargetKwh } from "@/lib/recommended-battery-sizing";
import { usePanelReferences, useInverterReferences, useBatteryReferences } from "@/lib/swr-hooks";
import {
  getPanelReferences,
  getCountryFlagUrl,
  getRecommendedPanelReferenceSync,
  getRecommendedInverterReferenceSync,
  getSolarEquipmentSettings,
  calculatePanelCount,
  calculateInverterCount,
  estimateInstallationPriceEur,
  estimateTotalPriceRangeEur,
  estimateAnnualSavingsEur,
  estimateAnnualSavingsEurWithBattery,
  estimateEnergyBillEur,
  getBreakEvenYears,
  DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH,
  DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH,
} from "@/lib/solar-settings";
import {
  fetchCompanyEnrichment,
  buildApiGouvSearchUrl,
  type EnrichmentResult,
} from "@/lib/recherche-entreprises";
import { getCommercialReferent, buildCommercialReferentFromUser } from "@/lib/commercial-mock";
import { useAuth } from "@/lib/auth-context";
import { getUserProfile } from "@/lib/firestore-user-profile";
import { fetchWithAuth } from "@/lib/api-client";
import { getPlaceDetailsNew } from "@/lib/places-new-api";
import type { ScoredCandidate } from "@/lib/find-local-siren";
import type { Prospect, SolarPotential, PanelReference, InverterReference, BatteryReference, CommercialReferent } from "@/types";

/** Config des lignes données prospect : liste fixe, une entrée par ligne (skeleton / valeur / "No data"). */
function websiteHref(raw: string): string {
  const t = raw.trim();
  if (!t) return "#";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

const PROSPECT_DATA_ROWS: {
  label: string;
  icon: ComponentType<{ className?: string }>;
  getValue: (p: Prospect) => string | undefined;
  isBdnb: boolean;
  isPhone?: boolean;
  isWebsite?: boolean;
}[] = [
  { label: "SIREN", icon: Hash, getValue: (p) => p.siren ?? undefined, isBdnb: false },
  { label: "SIRET", icon: Hash, getValue: (p) => p.siret ?? undefined, isBdnb: false },
  { label: "Dénomination", icon: Building2, getValue: (p) => p.companyLegalName ?? undefined, isBdnb: false },
  { label: "Adresse siège", icon: MapPin, getValue: (p) => p.companyAddress ?? undefined, isBdnb: false },
  { label: "Code NAF", icon: Tag, getValue: (p) => p.companyNaf ?? undefined, isBdnb: false },
  { label: "Gérant", icon: User, getValue: (p) => p.companyManagerName ?? undefined, isBdnb: false },
  { label: "Téléphone", icon: Phone, getValue: (p) => (p.contact?.nationalPhoneNumber ?? p.contact?.internationalPhoneNumber) ?? undefined, isBdnb: false, isPhone: true },
  {
    label: "Site web",
    icon: ExternalLink,
    getValue: (p) => p.contact?.websiteUri ?? undefined,
    isBdnb: false,
    isWebsite: true,
  },
  { label: "Année construction", icon: Calendar, getValue: (p) => (p.anneeConstruction != null ? String(p.anneeConstruction) : undefined), isBdnb: true },
];

/** Options du select : types canoniques (sans doublons) + type actuel si inconnu */
function getPlaceTypeOptions(currentValue: string): { value: string; label: string }[] {
  const canonicalTypes = new Set<string>();
  const known = BUILDING_ENERGY_CONSUMPTION_DATA.filter((d) => {
    const canonical = normalizePlaceTypeForConsumption(d.googlePlaceType);
    if (canonicalTypes.has(canonical)) return false;
    canonicalTypes.add(canonical);
    return true;
  }).map((d) => ({
    value: d.googlePlaceType,
    label: translatePlaceType(d.googlePlaceType),
  }));
  if (!currentValue || isKnownPlaceType(currentValue)) return known;
  return [
    { value: currentValue, label: translatePlaceType(currentValue) || currentValue },
    ...known,
  ];
}

/** Détermine le niveau de confiance basé sur le score (0-1000), calibré après pondération adresse. */
function getConfidenceLevel(score: number): "high" | "medium" | "low" {
  if (score >= 600) return "high";
  if (score >= 350) return "medium";
  return "low";
}

/** Retourne les propriétés du badge de confiance */
function getConfidenceBadgeProps(level: "high" | "medium" | "low") {
  switch (level) {
    case "high":
      return {
        label: "High",
        className: "bg-emerald-100 text-emerald-800 border-emerald-200",
      };
    case "medium":
      return {
        label: "Medium",
        className: "bg-amber-100 text-amber-800 border-amber-200",
      };
    case "low":
      return {
        label: "Low",
        className: "bg-red-100 text-red-800 border-red-200",
      };
  }
}

function PlaceTypeSelect({
  value,
  onValueChange,
  disabled,
  variant = "default",
}: {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  variant?: "default" | "dark";
}) {
  const options = useMemo(() => getPlaceTypeOptions(value), [value]);
  const displayValue =
    value && options.some((o) => o.value === value)
      ? value
      : options.find((o) => normalizePlaceTypeForConsumption(o.value) === normalizePlaceTypeForConsumption(value))
          ?.value ?? value ?? "other";
  const contentClassName =
    variant === "dark"
      ? "bg-black text-white border-white/20 **:data-radix-select-viewport:bg-black [&_button]:text-white hover:[&_button]:bg-white/10"
      : undefined;
  const itemClassName =
    variant === "dark"
      ? "focus:bg-white/10 focus:text-white data-highlighted:bg-white/10 data-highlighted:text-white text-white/90"
      : undefined;

  return (
    <Select value={displayValue} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        className={
          variant === "dark"
            ? "h-auto w-fit min-w-0 max-w-[90px] border-0 px-3 py-1.5 text-[10px] uppercase text-white/60 hover:text-white/80 [&>span]:text-white/60 [&>span]:uppercase [&>span]:text-[10px] [&>span]:truncate [&>span]:block bg-white/10 hover:bg-white/15 focus:ring-0 focus:ring-offset-0 [&_svg]:text-white/60 [&_svg]:opacity-80 [&_svg]:h-3 [&_svg]:w-3 placeholder:text-white/60 justify-start gap-1"
            : "bg-white"
        }
      >
        <SelectValue placeholder="Choisir un type" />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className={itemClassName}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface ProspectDrawerProps {
  prospect: Prospect | null;
  /** Indique que le fetch BDNB est en cours (clic POI sans données pré-chargées) */
  bdnbLoading?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToPipeline?: () => void;
  onSaveSuccess?: () => void;
  isDrawing?: boolean;
  onDrawingChange?: (isDrawing: boolean) => void;
  onSurfaceUpdate?: (surface: { area: number; polygon: Array<{ lat: number; lng: number }>; orientation?: number }) => void;
  onSurfaceDelete?: (surfaceId: string) => void;
  /** Patch fusionné dans le state parent (éviter `...prospect` depuis une closure async). */
  onProspectUpdate?: (patch: Partial<Prospect>) => void;
  onValidateDrawing?: () => void;
  voirHref?: (prospectId: string) => string;
}

type NeonBdnbBatiment = {
  id: string;
  code_commune_insee: string | null;
  annee_construction: number | null;
  dpe_mix_arrete_classe: string | null;
  nb_logements: number | null;
  surface_habitable_logement: string | number | null;
  usage_principal_bdnb_open: string | null;
  geom_geojson_wgs84: string | null;
  distance_m: number | null;
};

type NeonBdnbResponse = { batiment: NeonBdnbBatiment | null };

export function ProspectDrawer({
  prospect,
  bdnbLoading = false,
  isOpen,
  onOpenChange,
  onAddToPipeline,
  onSaveSuccess,
  isDrawing = false,
  onDrawingChange,
  onSurfaceUpdate,
  onSurfaceDelete,
  onProspectUpdate,
  onValidateDrawing,
  voirHref = (id) => `/solar-scout?prospectId=${id}`,
}: ProspectDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isOnMap = pathname?.includes("/solar-scout") ?? false;
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [address, setAddress] = useState(prospect?.address || "");
  const [isLoadingPVGIS, setIsLoadingPVGIS] = useState(false);
  const [pvgisError, setPvgisError] = useState<string | null>(null);
  const [chartViewMode, setChartViewMode] = useState<"monthly" | "daily">("monthly");
  const [chartSelectedMonthIndex, setChartSelectedMonthIndex] = useState(0);
  const [usedPanelRef, setUsedPanelRef] = useState<PanelReference | null>(null);
  const [usedInverterRef, setUsedInverterRef] = useState<InverterReference | null>(null);
  const [usedBatteryRef, setUsedBatteryRef] = useState<BatteryReference | null>(null);
  const [batteryCount, setBatteryCount] = useState(() =>
    prospect?.batteryCount != null && prospect.batteryCount >= 1 ? prospect.batteryCount : 1
  );
  /** "highest_production" = max surface utilisée | "perfect_fit" = production ≈ consommation */
  const [configurationMode, setConfigurationMode] = useState<"highest_production" | "perfect_fit">("highest_production");
  const [companyEnrichmentLoading, setCompanyEnrichmentLoading] = useState(false);
  const [phase2Scoring, setPhase2Scoring] = useState<ScoredCandidate[] | null>(null);
  const [phase2ScoringLoading, setPhase2ScoringLoading] = useState(false);
  const [prospectDetailsOpen, setProspectDetailsOpen] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const { user } = useAuth();
  const [neonBdnbLoading, setNeonBdnbLoading] = useState(false);
  const [neonBdnbError, setNeonBdnbError] = useState<string | null>(null);
  const [neonBdnb, setNeonBdnb] = useState<NeonBdnbBatiment | null>(null);

  /** Mis à true uniquement au clic sur Perfect fit / Highest production — resync batterie quand la cible kWh change. */
  const pendingBatteryResyncAfterModeChangeRef = useRef(false);

  const handlePoiNavigate = useCallback(
    async (delta: -1 | 1) => {
      if (!onProspectUpdate || !prospect?.poiCandidates?.length) return;
      const candidates = prospect.poiCandidates;
      const n = candidates.length;
      const idx = prospect.poiCandidateIndex ?? 0;
      const next = idx + delta;
      if (next < 0 || next >= n) return;
      const c = candidates[next]!;
      const poiCoordinates =
        c.coordinates != null
          ? { lat: c.coordinates.lat, lng: c.coordinates.lng }
          : undefined;
      const clearCompany: Partial<Prospect> = {
        siren: undefined,
        siret: undefined,
        companyLegalName: undefined,
        companyManagerName: undefined,
        companyAddress: undefined,
        companyNaf: undefined,
        companyEnrichmentApiUrl: undefined,
        companyPhone: undefined,
      };
      if (!c.placeId) {
        onProspectUpdate({
          ...clearCompany,
          name: c.name,
          placeId: c.placeId,
          poiCandidateIndex: next,
          poiCoordinates,
        });
        return;
      }
      const placeDetails = await getPlaceDetailsNew(c.placeId);
      if (!placeDetails) {
        onProspectUpdate({
          ...clearCompany,
          name: c.name,
          placeId: c.placeId,
          poiCandidateIndex: next,
          poiCoordinates,
        });
        return;
      }
      const fullAddress = placeDetails.formattedAddress;
      const displayName = placeDetails.displayName ?? c.name;
      const placeType = (placeDetails.primaryTypeDisplayName ?? "other") as Prospect["placeType"];
      const contact =
        placeDetails.nationalPhoneNumber || placeDetails.internationalPhoneNumber
          ? {
              nationalPhoneNumber: placeDetails.nationalPhoneNumber ?? undefined,
              internationalPhoneNumber: placeDetails.internationalPhoneNumber ?? undefined,
              websiteUri: placeDetails.websiteURI ?? undefined,
            }
          : undefined;
      onProspectUpdate({
        ...clearCompany,
        name: displayName,
        placeId: c.placeId,
        placeType,
        poiCandidateIndex: next,
        poiCoordinates,
        contact,
        ...(fullAddress != null ? { address: fullAddress } : {}),
      });
    },
    [onProspectUpdate, prospect]
  );

  // Enrichissement api.gouv : un seul appel find-local-siren si GPS + nom + adresse, sinon recherche-entreprises (priorité rue).
  useEffect(() => {
    if (!isOpen || !prospect) {
      setPhase2Scoring(null);
      return;
    }
    if (!onProspectUpdate) return;

    const hasQuery = !!(prospect.name?.trim() || prospect.address?.trim());
    if (!hasQuery || prospect.siren) return;

    const name = prospect.name?.trim();
    const address = prospect.address?.trim();
    const lat = prospect.poiCoordinates?.lat ?? prospect.coordinates?.lat;
    const lng = prospect.poiCoordinates?.lng ?? prospect.coordinates?.lng;
    const canResolveLocal = !!(
      name &&
      address &&
      lat != null &&
      lng != null &&
      Number.isFinite(lat) &&
      Number.isFinite(lng)
    );

    let cancelled = false;
    setCompanyEnrichmentLoading(true);
    setPhase2ScoringLoading(canResolveLocal);
    setPhase2Scoring(null);

    const applyEnrichment = (enrichment: EnrichmentResult, winningQuery: string | null) => {
      if (cancelled || !onProspectUpdate) return;
      logPolygonDrawer("drawer:applyEnrichment", {
        closureSurfaces: prospect.roofSurfaces?.length ?? 0,
        closureRoofArea: prospect.roofSurface?.area,
        siren: enrichment.siren,
      });
      // Ne pas spread `prospect` : la closure peut être périmée et réécraser adresse / POI.
      onProspectUpdate({
        siren: enrichment.siren ?? prospect.siren,
        siret: enrichment.siret ?? prospect.siret,
        companyLegalName: enrichment.companyLegalName ?? prospect.companyLegalName,
        companyManagerName: enrichment.companyManagerName ?? prospect.companyManagerName,
        companyAddress: enrichment.companyAddress ?? prospect.companyAddress,
        companyNaf: enrichment.companyNaf ?? prospect.companyNaf,
        companyEnrichmentApiUrl: winningQuery ? buildApiGouvSearchUrl(winningQuery) : undefined,
      });
    };

    const run = async () => {
      if (canResolveLocal) {
        const params = new URLSearchParams({
          poiName: name!,
          address: address!,
          lat: String(lat!),
          lon: String(lng!),
        });
        const res = await fetch(`/api/find-local-siren?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          enrichment: EnrichmentResult | null;
          winningQuery: string | null;
          phase2Scoring: ScoredCandidate[] | null;
        };
        if (cancelled) return;
        if (data.enrichment) {
          applyEnrichment(data.enrichment, data.winningQuery ?? null);
        }
        setPhase2Scoring(data.phase2Scoring ?? null);
        return;
      }

      const { enrichment, winningQuery } = await fetchCompanyEnrichment(prospect);
      if (cancelled || !enrichment) return;
      applyEnrichment(enrichment, winningQuery);
      setPhase2Scoring(null);
    };

    run()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setCompanyEnrichmentLoading(false);
          setPhase2ScoringLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prospect utilisé dans applyEnrichment ; deps granulaires pour éviter re-fetch inutile
  }, [
    isOpen,
    prospect?.id,
    prospect?.name,
    prospect?.address,
    prospect?.siren,
    prospect?.coordinates?.lat,
    prospect?.coordinates?.lng,
    prospect?.poiCoordinates?.lat,
    prospect?.poiCoordinates?.lng,
    prospect?.placeId,
    prospect?.poiCandidateIndex,
    onProspectUpdate,
  ]);

  // Test BDNB depuis Neon (lookup nearest par coordonnées)
  useEffect(() => {
    if (!isOpen || !prospect?.coordinates?.lat || !prospect?.coordinates?.lng) {
      setNeonBdnb(null);
      setNeonBdnbError(null);
      setNeonBdnbLoading(false);
      return;
    }

    let cancelled = false;
    setNeonBdnbLoading(true);
    setNeonBdnbError(null);

    const run = async () => {
      const url = `/api/bdnb-neon?lat=${encodeURIComponent(String(prospect.coordinates.lat))}&lng=${encodeURIComponent(
        String(prospect.coordinates.lng)
      )}`;
      const res = await fetchWithAuth(url);
      if (cancelled) return;
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json?.error || `Erreur ${res.status}`);
      }
      const data = (await res.json()) as NeonBdnbResponse;
      if (cancelled) return;
      setNeonBdnb(data?.batiment ?? null);
    };

    run()
      .catch((e) => {
        if (!cancelled) setNeonBdnbError(e instanceof Error ? e.message : "Erreur Neon inconnue");
      })
      .finally(() => {
        if (!cancelled) setNeonBdnbLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, prospect?.coordinates?.lat, prospect?.coordinates?.lng]);

  const { data: panelsData } = usePanelReferences(user?.uid ?? null);
  const { data: invertersData } = useInverterReferences(user?.uid ?? null);
  const { data: batteriesData } = useBatteryReferences(user?.uid ?? null);

  // Équipement propre au prospect : initialiser depuis prospect.panelReferenceId / etc. ou recommandé global
  useEffect(() => {
    if (!isOpen || !panelsData) return;
    // Panneaux : un seul modèle "visible" doit être utilisé. Compat legacy : si `visible` est absent partout,
    // on retombe sur la logique recommended/premier.
    const visible = panelsData.find((r) => r.visible === true);
    const legacyPick =
      (prospect?.panelReferenceId ? panelsData.find((r) => r.id === prospect.panelReferenceId) : null) ??
      panelsData.find((r) => r.recommended === true) ??
      panelsData[0] ??
      getPanelReferences()[0] ??
      null;
    setUsedPanelRef(visible ?? legacyPick);
  }, [isOpen, panelsData, prospect?.panelReferenceId]);

  useEffect(() => {
    if (!invertersData) return;
    const visibleInverters = invertersData.filter((r) => r.visible !== false);
    const byId =
      prospect?.inverterReferenceId ? visibleInverters.find((r) => r.id === prospect.inverterReferenceId) : null;
    const recommended = visibleInverters.find((r) => r.recommended === true);
    setUsedInverterRef(byId ?? recommended ?? visibleInverters[0] ?? null);
  }, [invertersData, prospect?.inverterReferenceId]);

  // Adresse : suivre le prospect courant
  useEffect(() => {
    if (prospect?.address) {
      setAddress(prospect.address);
    }
  }, [prospect?.address]);

  // Mode Perfect fit / Highest production : ne dépendre que de l'id et du champ persisté.
  // Avant : [prospect] réexécutait l'effet à chaque merge (batterie, PVGIS…) et le `else` forçait
  // "highest_production" quand configurationMode était encore absent du document — les boutons ne suivaient pas le clic.
  useEffect(() => {
    if (!isOpen || !prospect) return;
    if (prospect.configurationMode) {
      setConfigurationMode(prospect.configurationMode);
    } else {
      setConfigurationMode("highest_production");
    }
  }, [isOpen, prospect?.id, prospect?.configurationMode]);

  useEffect(() => {
    logPolygonDrawer("drawer:prospect-sync", {
      isOpen,
      roofSurfacesCount: prospect?.roofSurfaces?.length ?? 0,
      roofSurfaceArea: prospect?.roofSurface?.area,
      addressPreview: prospect?.address?.slice(0, 36),
    });
  }, [prospect, isOpen]);

  // Clé stable : inclure la surface pour re-fetcher quand elle change (données PVGIS dépendent du kWp)
  const totalAreaForKey =
    prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
  const pvgisFetchKey =
    isOpen && prospect?.coordinates && !prospect.solarPotential?.pvgisDataFetched && totalAreaForKey > 0
      ? `${prospect.id ?? "noid"}-${prospect.coordinates.lat}-${prospect.coordinates.lng}-${Math.round(totalAreaForKey)}`
      : null;
  const pvgisFetchInProgressRef = useRef(false);

  // Récupérer les données PVGIS une seule fois à l'ouverture du drawer pour ce prospect
  useEffect(() => {
    if (!pvgisFetchKey || !prospect || !prospect.coordinates || !onProspectUpdate) return;
    if (pvgisFetchInProgressRef.current) return;

    const fetchPVGISData = async () => {
      pvgisFetchInProgressRef.current = true;
      setIsLoadingPVGIS(true);
      setPvgisError(null);

      try {
        const surfaces = prospect.roofSurfaces ||
          (prospect.roofSurface?.area > 0 ? [prospect.roofSurface] : []);
        const firstSurface = surfaces[0];
        const orientation = firstSurface?.orientation;

        const requestBody: {
          lat: number;
          lon: number;
          peakpower: number;
          loss: number;
          azimuth?: number;
          slope?: number;
        } = {
          lat: prospect.coordinates.lat,
          lon: prospect.coordinates.lng,
          peakpower: 1,
          loss: 14,
        };

        if (orientation != null) {
          requestBody.azimuth = orientation;
          requestBody.slope = 30;
        }

        const response = await fetch("/api/pvgis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Erreur ${response.status}`);
        }

        const pvgisData = await response.json();

        if (!pvgisData || typeof pvgisData.annualProduction !== "number") {
          throw new Error("Données PVGIS invalides reçues");
        }

        const productionPerKwpAnnual = Math.round(pvgisData.annualProduction * 100) / 100;
        const productionPerKwpMonthly = Array.isArray(pvgisData.monthlyProduction)
          ? pvgisData.monthlyProduction.map((m: { month: number; production: number }) => ({
              month: m.month,
              production: Math.round((m.production || 0) * 100) / 100,
            }))
          : [];

        const updatedSolarPotential: SolarPotential = {
          ...prospect.solarPotential,
          productionPerKwpAnnual,
          productionPerKwpMonthly,
          maxSunshineHoursPerYear: pvgisData.sunshineHoursEquivalent,
          optimalInclination: pvgisData.optimalInclination,
          optimalAzimuth: pvgisData.optimalAzimuth,
          annualIrradiation: pvgisData.annualIrradiation,
          monthlyIrradiation: Array.isArray(pvgisData.monthlyIrradiation)
            ? pvgisData.monthlyIrradiation
            : [],
          pvgisDataFetched: true,
          maxArrayPanelsCount: prospect.solarPotential?.maxArrayPanelsCount || 0,
        };

        logPolygonDrawer("drawer:pvgis-complete", {
          closureSurfaces: prospect.roofSurfaces?.length ?? 0,
          closureRoofArea: prospect.roofSurface?.area,
        });
        // Uniquement solarPotential : le `prospect` de cette closure peut dater d'avant geocode/POI.
        onProspectUpdate({ solarPotential: updatedSolarPotential });
      } catch (error) {
        console.error("Erreur lors de la récupération des données PVGIS:", error);
        setPvgisError(
          error instanceof Error ? error.message : "Erreur lors de la récupération des données d'ensoleillement"
        );
      } finally {
        pvgisFetchInProgressRef.current = false;
        setIsLoadingPVGIS(false);
      }
    };

    fetchPVGISData();
  }, [pvgisFetchKey]); // prospect et onProspectUpdate lus dans la closure, pas en deps pour éviter re-jeux infinis

  const handleAddToPipeline = async () => {
    if (!prospect || !onAddToPipeline) return;

    setIsAdding(true);
    try {
      // Calculer les mêmes valeurs que l'affichage (même méthode) pour les stocker en Firestore
      const totalArea =
        prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ??
        prospect.roofSurface?.area ??
        0;
      let pipelineOptions: {
        estimatedKwp?: number;
        priceRangeMinEur?: number;
        priceRangeMaxEur?: number;
        breakEvenMinYears?: number | null;
        breakEvenMaxYears?: number | null;
      } = {};
      if (totalArea > 0) {
        if (financialSummary && effectiveConfig.effectiveKwp > 0) {
          pipelineOptions.estimatedKwp = effectiveConfig.effectiveKwp;
          pipelineOptions.priceRangeMinEur = financialSummary.priceRange.totalMinEur;
          pipelineOptions.priceRangeMaxEur = financialSummary.priceRange.totalMaxEur;
          pipelineOptions.breakEvenMinYears = financialSummary.breakEvenMin;
          pipelineOptions.breakEvenMaxYears = financialSummary.breakEvenMax;
        }
      }

      const prospectId = await addProspectToPipeline(
        {
          ...prospect,
          address: address || prospect.address,
          configurationMode,
        },
        pipelineOptions,
        user?.uid
      );

      // Créer un lead à partir du prospect
      await createLeadFromProspect(
        prospectId,
        address || prospect.address,
        prospect.contact?.websiteUri
      );

      // Réinitialiser le formulaire
      onAddToPipeline();
      onOpenChange(false);

      toast.success("Lead ajouté au pipeline", {
        description: prospect.name || address || prospect.address,
        action: {
          label: "Ouvrir le pipeline",
          onClick: () => router.push("/"),
        },
      });
    } catch (error) {
      toast.error("Erreur lors de l'ajout au pipeline", {
        description: "Veuillez réessayer.",
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleSave = async () => {
    if (!prospect?.id) return;

    setIsSaving(true);
    try {
      const totalArea =
        prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ??
        prospect.roofSurface?.area ??
        0;
      let pipelineOptions: {
        estimatedKwp?: number;
        priceRangeMinEur?: number;
        priceRangeMaxEur?: number;
        breakEvenMinYears?: number | null;
        breakEvenMaxYears?: number | null;
      } = {};
      if (totalArea > 0 && financialSummary && effectiveConfig.effectiveKwp > 0) {
        pipelineOptions.estimatedKwp = effectiveConfig.effectiveKwp;
        pipelineOptions.priceRangeMinEur = financialSummary.priceRange.totalMinEur;
        pipelineOptions.priceRangeMaxEur = financialSummary.priceRange.totalMaxEur;
        pipelineOptions.breakEvenMinYears = financialSummary.breakEvenMin;
        pipelineOptions.breakEvenMaxYears = financialSummary.breakEvenMax;
      }

      const updatedProspect: Prospect = {
        ...prospect,
        address: address || prospect.address,
        configurationMode,
        ...(usedPanelRef?.id && { panelReferenceId: usedPanelRef.id }),
        ...(usedInverterRef?.id && { inverterReferenceId: usedInverterRef.id }),
        ...(usedBatteryRef?.id && { batteryReferenceId: usedBatteryRef.id }),
        ...(usedBatteryRef && { batteryCount: Math.max(1, Math.min(usedBatteryRef.maxBatteriesPerRack ?? 20, batteryCount)) }),
        ...(pipelineOptions.estimatedKwp != null && {
          solarPotential: {
            ...prospect.solarPotential,
            maxArrayPanelsCount: prospect.solarPotential?.maxArrayPanelsCount ?? 0,
            maxArrayAreaMeters2: prospect.solarPotential?.maxArrayAreaMeters2 ?? 0,
            maxSunshineHoursPerYear: prospect.solarPotential?.maxSunshineHoursPerYear ?? 0,
            maxKwhPerYear: prospect.solarPotential?.maxKwhPerYear ?? 0,
            estimatedKwp: pipelineOptions.estimatedKwp,
          },
        }),
        ...(pipelineOptions.priceRangeMinEur != null && { priceRangeMinEur: pipelineOptions.priceRangeMinEur }),
        ...(pipelineOptions.priceRangeMaxEur != null && { priceRangeMaxEur: pipelineOptions.priceRangeMaxEur }),
        ...(pipelineOptions.breakEvenMinYears !== undefined && { breakEvenMinYears: pipelineOptions.breakEvenMinYears }),
        ...(pipelineOptions.breakEvenMaxYears !== undefined && { breakEvenMaxYears: pipelineOptions.breakEvenMaxYears }),
      };

      await updateProspectInPipeline(
        prospect.id,
        updatedProspect,
        pipelineOptions
      );

      onProspectUpdate?.(updatedProspect);
      toast.success("Enregistré");
      onSaveSuccess?.();
    } catch (error) {
      alert("Erreur lors de l'enregistrement. Veuillez réessayer.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenSharePage = async () => {
    if (!prospect?.id) return;

    const open = (shareToken: string) => {
      if (typeof window === "undefined") return;
      const w = window.open(`/p/${shareToken}`, "_blank", "noopener,noreferrer");
      if (w) w.opener = null;
    };

    // Si déjà généré, on ouvre directement (pas de loading inutile)
    if (prospect.shareToken) {
      open(prospect.shareToken);
      return;
    }

    setIsGeneratingLink(true);
    try {
      const shareToken = crypto.randomUUID();
      let commercialReferent: CommercialReferent;
      if (user) {
        const userProfile = await getUserProfile(user.uid);
        const fromUser = buildCommercialReferentFromUser(user, userProfile);
        const fromSettings = getCommercialReferent();
        commercialReferent = {
          ...fromUser,
          calendlyUrl: fromSettings.calendlyUrl || fromUser.calendlyUrl,
        };
      } else {
        commercialReferent = getCommercialReferent();
      }

      await updateProspect(prospect.id, { shareToken, commercialReferent });
      onProspectUpdate?.({ shareToken, commercialReferent });

      open(shareToken);
    } catch {
      toast.error("Erreur lors de l’ouverture de la page partagée", {
        description: "Veuillez réessayer.",
      });
    } finally {
      setIsGeneratingLink(false);
    }
  };

  /** Valeurs effectives selon le mode (Perfect fit vs Highest production).
   * Source : productionPerKwp (PVGIS) × kWp actuel. kWp = surfaceToKwp(surface). */
  const effectiveConfig = useMemo(() => {
    const surfaceM2 = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    const panelRef = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const legacyKwp = (prospect?.solarPotential?.maxArrayAreaMeters2 ?? 0) > 0
      ? surfaceToKwp(prospect!.solarPotential!.maxArrayAreaMeters2!, undefined, undefined, panelRef)
      : undefined;
    const perKwp = getProductionPerKwpFromSolarPotential(prospect?.solarPotential, legacyKwp);

    if (!prospect || surfaceM2 <= 0 || !panelRef || !perKwp) {
      return {
        scaleFactor: 1,
        effectiveKwp: 0,
        effectivePanelCount: 0,
        effectiveAnnualProductionKwh: 0,
        kwpAtFetch: 0,
        productionPerKwp: null,
      };
    }

    const fullKwp = surfaceToKwp(surfaceM2, undefined, undefined, panelRef);
    const productible = perKwp.productionPerKwpAnnual;
    const usableArea = getUsableRoofAreaM2(surfaceM2);
    const maxPanelCount = calculatePanelCount(usableArea, undefined, panelRef);
    const panelPowerW = panelRef.powerW;

    const panelCountFromKwp = (kwp: number) =>
      Math.min(Math.floor((kwp * 1000) / panelPowerW), maxPanelCount);

    if (configurationMode === "highest_production") {
      const effectiveKwp = fullKwp;
      const effectiveAnnualProductionKwh = Math.round(productible * fullKwp);
      return {
        scaleFactor: 1,
        effectiveKwp,
        effectivePanelCount: panelCountFromKwp(fullKwp),
        effectiveAnnualProductionKwh,
        kwpAtFetch: fullKwp,
        productionPerKwp: perKwp,
      };
    }

    const PERFECT_FIT_SELF_CONSUMPTION_TARGET = 0.7;
    const placeType = prospect.placeType || "other";
    const consoFromType = getEnergyConsumption(placeType) * surfaceM2;
    const consoAnnuelleKwh = prospect.annualConsumptionKwhOverride ?? consoFromType;
    const targetKwp = productible > 0
      ? (consoAnnuelleKwh * PERFECT_FIT_SELF_CONSUMPTION_TARGET) / productible
      : 0;
    const effectiveKwp = Math.min(targetKwp, fullKwp);
    const effectiveAnnualProductionKwh = Math.round(productible * effectiveKwp);
    return {
      scaleFactor: 1,
      effectiveKwp,
      effectivePanelCount: panelCountFromKwp(effectiveKwp),
      effectiveAnnualProductionKwh,
      kwpAtFetch: fullKwp,
      productionPerKwp: perKwp,
    };
  }, [prospect, configurationMode, usedPanelRef]);

  /** Config pour les choice cards : panneaux + onduleurs. production = productionPerKwp × kWp. */
  const choiceCardsConfig = useMemo(() => {
    const surfaceM2 = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    const panelRef = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const inverterRef = usedInverterRef ?? getRecommendedInverterReferenceSync();
    const legacyKwp = (prospect?.solarPotential?.maxArrayAreaMeters2 ?? 0) > 0
      ? surfaceToKwp(prospect!.solarPotential!.maxArrayAreaMeters2!, undefined, undefined, panelRef)
      : undefined;
    const perKwp = getProductionPerKwpFromSolarPotential(prospect?.solarPotential, legacyKwp);

    if (!prospect || surfaceM2 <= 0 || !panelRef || !perKwp) {
      return { perfectFit: { panelCount: 0, inverterCount: 0, kwp: 0 }, highestProduction: { panelCount: 0, inverterCount: 0, kwp: 0 } };
    }

    const fullKwp = surfaceToKwp(surfaceM2, undefined, undefined, panelRef);
    const productible = perKwp.productionPerKwpAnnual;
    const usableArea = getUsableRoofAreaM2(surfaceM2);
    const maxPanelCount = calculatePanelCount(usableArea, undefined, panelRef);

    const panelCountFromKwp = (kwp: number) =>
      Math.min(Math.floor((kwp * 1000) / panelRef.powerW), maxPanelCount);

    const highestPanelCount = panelCountFromKwp(fullKwp);
    const highestInverterCount = calculateInverterCount(fullKwp, inverterRef);

    const PERFECT_FIT_SELF_CONSUMPTION_TARGET = 0.7;
    const placeType = prospect.placeType || "other";
    const consoFromType = getEnergyConsumption(placeType) * surfaceM2;
    const consoAnnuelleKwh = prospect.annualConsumptionKwhOverride ?? consoFromType;
    const targetKwp = productible > 0
      ? (consoAnnuelleKwh * PERFECT_FIT_SELF_CONSUMPTION_TARGET) / productible
      : 0;
    const cappedKwp = Math.min(targetKwp, fullKwp);
    const perfectFitPanelCount = panelCountFromKwp(cappedKwp);
    const perfectFitInverterCount = calculateInverterCount(cappedKwp, inverterRef);

    const config = {
      perfectFit: { panelCount: perfectFitPanelCount, inverterCount: perfectFitInverterCount, kwp: cappedKwp },
      highestProduction: { panelCount: highestPanelCount, inverterCount: highestInverterCount, kwp: fullKwp },
    };
    return config;
  }, [prospect, usedPanelRef, usedInverterRef]);

  /**
   * Taille batterie recommandée (kWh) :
   * - Avec profils PVGIS (12 mois) : simulation sans batterie → surplus = injection réseau annuelle ;
   *   capacité ≈ (surplus journalier moyen) / η (0,9).
   * - Sinon : repli sur bilan annuel prod − conso (historique), puis règle kWh/kWc si pas de surplus.
   */
  const recommendedBatteryKwh = useMemo(() => {
    const totalArea = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    if (!prospect || totalArea <= 0) return null;
    const effectiveKwp = effectiveConfig.effectiveKwp;
    const hasProductionData = effectiveConfig.productionPerKwp != null;
    if (!hasProductionData || effectiveKwp <= 0) return null;
    const placeType = prospect.placeType || "other";
    const annualConsumptionKwh =
      prospect.annualConsumptionKwhOverride ?? getEnergyConsumption(placeType) * totalArea;
    const annualProductionKwh = effectiveConfig.effectiveAnnualProductionKwh;
    const monthly = effectiveConfig.productionPerKwp?.productionPerKwpMonthly;

    return computeRecommendedBatteryTargetKwh({
      productionPerKwpMonthly: monthly,
      effectiveKwp,
      annualProductionKwh,
      annualConsumptionKwh,
      placeType,
      surfaceM2: totalArea,
    });
  }, [prospect, effectiveConfig.effectiveAnnualProductionKwh, effectiveConfig.effectiveKwp, effectiveConfig.productionPerKwp]);

  /**
   * Composition recommandée :
   * - Cible haute (>= plus grosse batterie) : on part de la plus grosse, on optimise le count.
   *   Ex. 100 kWh, modèles 25 et 75 → 75×1=75 (écart 25) vs 75×2=150 (écart 50) → 1×75 kWh.
   * - Cible basse (< plus grosse batterie) : meilleur match parmi tous les modèles.
   *   Ex. 13,7 kWh, modèles 105 et 215 → 105×1 plus proche que 215×1 → 1×105 kWh.
   */
  const recommendedBatteryComposition = useMemo(() => {
    const visibleBatteries = (batteriesData ?? []).filter((b) => b.visible !== false);
    if (!visibleBatteries.length || recommendedBatteryKwh == null) return null;
    const sortedByCapacity = [...visibleBatteries].sort((a, b) => b.capacityKwh - a.capacityKwh);
    const largestModel = sortedByCapacity[0];
    if (!largestModel) return null;

    const target = recommendedBatteryKwh;

    if (target >= largestModel.capacityKwh) {
      // Cible haute : plus grosse batterie, optimiser le count
      const maxPerRack = largestModel.maxBatteriesPerRack ?? 20;
      let bestCount = 1;
      let bestEcart = Math.abs(largestModel.capacityKwh - target);
      for (let c = 2; c <= maxPerRack; c++) {
        const totalKwh = largestModel.capacityKwh * c;
        const ecart = Math.abs(totalKwh - target);
        if (ecart < bestEcart) {
          bestEcart = ecart;
          bestCount = c;
        }
      }
      return { model: largestModel, count: bestCount };
    }

    // Cible basse : meilleur match parmi tous les modèles
    let best: { model: BatteryReference; count: number; ecart: number } | null = null;
    for (const model of visibleBatteries) {
      const maxPerRack = model.maxBatteriesPerRack ?? 20;
      for (let c = 1; c <= maxPerRack; c++) {
        const totalKwh = model.capacityKwh * c;
        const ecart = Math.abs(totalKwh - target);
        const isBetter =
          best == null ||
          ecart < best.ecart ||
          (ecart === best.ecart && c < best.count) ||
          (ecart === best.ecart && c === best.count && model.capacityKwh > best.model.capacityKwh);
        if (isBetter) best = { model, count: c, ecart };
      }
    }
    return best ? { model: best.model, count: best.count } : null;
  }, [batteriesData, recommendedBatteryKwh]);

  useEffect(() => {
    if (recommendedBatteryKwh != null && DEBUG_AUTOCONSO && process.env.NODE_ENV === "development") {
      console.log("[Batterie] Dimensionnement calculé:", {
        recommendedBatteryKwh,
        composition: recommendedBatteryComposition ? `${recommendedBatteryComposition.count}× ${recommendedBatteryComposition.model.name}` : null,
      });
    }
  }, [recommendedBatteryKwh, recommendedBatteryComposition]);

  useEffect(() => {
    pendingBatteryResyncAfterModeChangeRef.current = false;
  }, [prospect?.id]);

  // Batterie : toujours une ref issue de batteriesData. Par défaut : choix prospect → composition recommandée → premier avec flag recommandé → premier de la liste.
  // Après clic Perfect fit / Highest production : réaligner modèle + nombre sur recommendedBatteryComposition (y compris quand PVGIS / composition arrive après le clic).
  // Si le prospect a un batteryCount persisté, il prime sinon ; hors resync explicite au changement de mode.
  useEffect(() => {
    if (!isOpen || !prospect) return;
    const visibleBatteries = (batteriesData ?? []).filter((b) => b.visible !== false);
    if (!visibleBatteries.length) {
      setUsedBatteryRef(null);
      setBatteryCount(1);
      return;
    }

    if (pendingBatteryResyncAfterModeChangeRef.current && recommendedBatteryComposition != null) {
      const { model, count } = recommendedBatteryComposition;
      setUsedBatteryRef(model);
      setBatteryCount(count);
      pendingBatteryResyncAfterModeChangeRef.current = false;
      // Patch partiel uniquement : ne pas spread `prospect` (closure périmée → réécrase configurationMode après clic mode).
      onProspectUpdate?.({
        batteryReferenceId: model.id,
        batteryCount: count,
      });
      return;
    }

    const byId = prospect.batteryReferenceId ? visibleBatteries.find((r) => r.id === prospect.batteryReferenceId) : null;
    const chosen =
      byId ??
      recommendedBatteryComposition?.model ??
      visibleBatteries.find((r) => r.recommended === true) ??
      visibleBatteries[0];
    setUsedBatteryRef(chosen);
    const countFromProspect = prospect.batteryCount != null && prospect.batteryCount >= 1 ? prospect.batteryCount : null;
    const countFromRec = recommendedBatteryComposition?.model?.id === chosen?.id ? recommendedBatteryComposition.count : null;
    setBatteryCount(countFromProspect ?? countFromRec ?? 1);
  }, [isOpen, batteriesData, prospect, recommendedBatteryComposition, configurationMode, onProspectUpdate]);

  /** Nombre max d'onduleurs recommandé ; au-delà, le modèle n'est pas adapté */
  const MAX_INVERTER_COUNT = 8;
  const effectiveInverterCount = configurationMode === "perfect_fit"
    ? choiceCardsConfig.perfectFit.inverterCount
    : choiceCardsConfig.highestProduction.inverterCount;
  const inverterCountExceedsLimit = effectiveInverterCount > MAX_INVERTER_COUNT;

  const includeBatteryEffective = prospect?.includeBatteryOverride ?? getSolarEquipmentSettings().includeBattery ?? true;

  /** Résumé financier (équipement, fourchette prix, économies, break-even) avec ou sans batterie */
  const financialSummary = useMemo(() => {
    const totalArea = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    if (!prospect || totalArea <= 0) return null;
    const recommendedPanel = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const recommendedInverter = usedInverterRef ?? getRecommendedInverterReferenceSync();
    const panelCount = effectiveConfig.effectivePanelCount;
    const totalPowerKW = effectiveConfig.effectiveKwp;
    const inverterCount = calculateInverterCount(totalPowerKW, recommendedInverter);
    const placeType = prospect.placeType || "other";
    const totalConsumptionKwh =
      prospect.annualConsumptionKwhOverride ?? getEnergyConsumption(placeType) * totalArea;

    let equipmentEur: number;
    let annualSavings: number;

    let batteryByMonth: { selfConsumptionDirectKwh: number; selfConsumptionViaBatteryKwh: number; injectionBatteryKwh: number; injectionReseauKwh: number; excessKwh: number; gridDrawKwh: number }[] | undefined;
    let breakdownFromHourlySim = false;
    let selfConsumptionDirectKwhTotal = 0;
    let selfConsumptionViaBatteryKwhTotal = 0;
    let injectionReseauKwhTotal = 0;
    const canUseProfiles = effectiveConfig.productionPerKwp?.productionPerKwpMonthly?.length === 12;
    const annualProductionKWh = effectiveConfig.effectiveAnnualProductionKwh;

    if (canUseProfiles && annualProductionKWh > 0 && totalConsumptionKwh > 0) {
      breakdownFromHourlySim = true;
      const productionPerKwpMonthly = effectiveConfig.productionPerKwp!.productionPerKwpMonthly;
      const kwp = effectiveConfig.effectiveKwp;
      const productionTypicalDayByMonth = Array.from({ length: 12 }, (_, m) =>
        buildTypicalDayForMonth(productionPerKwpMonthly, m, kwp)
      );
      const consumptionTypicalDayByMonth = Array.from({ length: 12 }, (_, m) =>
        buildTypicalConsumptionDayForMonth(placeType, m, totalArea)
      );
      const scaledBattery = includeBatteryEffective && usedBatteryRef
        ? scaleBatteryForCount(usedBatteryRef, batteryCount)
        : null;
      if (DEBUG_AUTOCONSO && process.env.NODE_ENV === "development" && scaledBattery) {
        console.log("[Autoconsommation] ProspectDrawer — simulation avec", usedBatteryRef!.name, "×", batteryCount, "→ capacité totale:", scaledBattery.capacityKwh, "kWh");
      }
      const simulationResult = runProductionSimulation({
        productionTypicalDayByMonth,
        consumptionTypicalDayByMonth,
        battery: scaledBattery,
      });
      annualSavings = estimateAnnualSavingsEurWithBattery(simulationResult);
      equipmentEur = estimateInstallationPriceEur(
        panelCount,
        inverterCount,
        recommendedPanel,
        recommendedInverter,
        includeBatteryEffective && usedBatteryRef ? usedBatteryRef : undefined,
        batteryCount
      );
      batteryByMonth = simulationResult.byMonth;
      selfConsumptionDirectKwhTotal = simulationResult.selfConsumptionDirectKwh;
      selfConsumptionViaBatteryKwhTotal = simulationResult.selfConsumptionViaBatteryKwh;
      injectionReseauKwhTotal = simulationResult.excessKwh;
    } else {
      annualSavings = estimateAnnualSavingsEur(annualProductionKWh, undefined, totalConsumptionKwh);
      equipmentEur = estimateInstallationPriceEur(
        panelCount,
        inverterCount,
        recommendedPanel,
        recommendedInverter
      );
    }

    const priceRange = estimateTotalPriceRangeEur(totalPowerKW, equipmentEur);
    const breakEvenMin = getBreakEvenYears(priceRange.totalMinEur, annualSavings);
    const breakEvenMax = getBreakEvenYears(priceRange.totalMaxEur, annualSavings);
    return {
      equipmentEur,
      priceRange,
      annualSavings,
      breakEvenMin,
      breakEvenMax,
      batteryByMonth,
      breakdownFromHourlySim,
      selfConsumptionDirectKwhTotal,
      selfConsumptionViaBatteryKwhTotal,
      injectionReseauKwhTotal,
    };
  }, [
    prospect,
    configurationMode,
    effectiveConfig,
    usedPanelRef,
    usedInverterRef,
    usedBatteryRef,
    batteryCount,
    includeBatteryEffective,
  ]);

  const chartData = useMemo(() => {
    const surfaceM2 = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    const placeType = prospect?.placeType || "other";
    if (!prospect || !effectiveConfig.productionPerKwp) return [];
    const { monthlyProduction } = getProductionFromPerKwp(
      effectiveConfig.productionPerKwp.productionPerKwpAnnual,
      effectiveConfig.productionPerKwp.productionPerKwpMonthly,
      effectiveConfig.effectiveKwp
    );
    const byMonth = financialSummary?.batteryByMonth;
    return monthlyProduction.map((m) => {
      const base = {
        month: m.month,
        production: m.production,
        consumption: Math.round(getEnergyConsumptionForMonth(placeType, (m.month - 1) as MonthIndex) * surfaceM2),
      };
      if (byMonth?.[m.month - 1]) {
        const b = byMonth[m.month - 1]!;
        return {
          ...base,
          selfConsumptionDirect: b.selfConsumptionDirectKwh,
          selfConsumptionViaBattery: b.selfConsumptionViaBatteryKwh,
          injectionBattery: b.injectionBatteryKwh,
          excess: b.injectionReseauKwh,
          gridDraw: b.gridDrawKwh,
        };
      }
      return base;
    });
  }, [prospect, effectiveConfig, financialSummary?.batteryByMonth]);

  const chartDailyData = useMemo(() => {
    const surfaceM2 = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    if (!prospect || surfaceM2 <= 0 || !effectiveConfig.productionPerKwp) return undefined;
    const placeType = prospect.placeType || "other";
    const prodDay = buildTypicalDayForMonth(
      effectiveConfig.productionPerKwp.productionPerKwpMonthly,
      chartSelectedMonthIndex,
      effectiveConfig.effectiveKwp
    );
    const consDay = buildTypicalConsumptionDayForMonth(placeType, chartSelectedMonthIndex, surfaceM2);
    const batteryForChart = includeBatteryEffective && usedBatteryRef
      ? scaleBatteryForCount(usedBatteryRef, batteryCount)
      : null;
    const hourly = runSimulationOneDayForChart(prodDay, consDay, batteryForChart);
    return hourly.map((h, hour) => ({
      hour,
      production: prodDay[hour] ?? 0,
      consumption: consDay[hour] ?? 0,
      selfConsumptionDirect: h.selfConsumptionDirectKwh,
      selfConsumptionViaBattery: h.selfConsumptionViaBatteryKwh,
      injectionBattery: h.injectionBatteryKwh,
      excess: h.injectionReseauKwh,
      gridDraw: h.gridDrawKwh,
    }));
  }, [
    prospect,
    effectiveConfig,
    chartSelectedMonthIndex,
    includeBatteryEffective,
    usedBatteryRef,
    batteryCount,
  ]);

  return (
    <div className="h-full w-full bg-white border border-border shadow-xl flex flex-col rounded-2xl overflow-hidden">
        <div className="p-4 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold leading-none tracking-tight">Informations du prospect</h2>
            <Button
              variant="outline"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8"
              title="Fermer"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto px-4 space-y-2">
          {false ? (
            <>
              {/* Skeleton pour le score de qualité */}
              <div className="bg-gray-100 rounded-xl py-3 px-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                  <Skeleton className="h-2 w-full" />
                </div>
              </div>

              {/* Skeleton pour l’aperçu carte */}
              <div className="bg-gray-100 rounded-xl py-3 px-4">
                <Skeleton className="h-4 w-28 mb-2" />
                <Skeleton className="h-48 w-full rounded-md" />
              </div>

              {/* Skeleton pour le nom */}
              <Skeleton className="h-12 w-full rounded-md" />

              {/* Skeleton pour l'adresse */}
              <Skeleton className="h-12 w-full rounded-md" />

              {/* Skeleton pour le type de lieu */}
              <Skeleton className="h-12 w-full rounded-md" />

              {/* Skeleton pour les coordonnées */}
              <div className="flex gap-2">
                <Skeleton className="h-12 flex-1 rounded-md" />
                <Skeleton className="h-12 flex-1 rounded-md" />
              </div>
            </>
          ) : prospect ? (
            <>
              {/* Score en tag */}
              <div className="flex gap-2">
                <Badge
                  variant="secondary"
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-gray-100 text-gray-800 border-gray-200 h-5"
                >
                  Score {prospect.qualityScore}
                </Badge>
              </div>

              <div className="w-full space-y-2">
                <div className="space-y-2">
              {/* Bloc prospect : nom, adresse, type, lat/lon */}
              <Card className="bg-black border-0 text-white overflow-hidden rounded-xl">
                <CardContent className="py-3 px-4">
                  <div className="flex flex-col gap-3 relative">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] uppercase tracking-wide text-white/70">Prospect</span>
                      <button
                        type="button"
                        onClick={() => setProspectDetailsOpen(true)}
                        className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                        title="Voir plus de détails"
                        aria-label="Voir plus de détails"
                      >
                        <Maximize2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="space-y-0 [&>p]:m-0 [&>p]:leading-tight">
                    {prospect.name && (
                      <div className="flex items-center gap-1 min-w-0">
                        <p className="text-xl font-medium truncate flex-1 min-w-0" title={prospect.name}>
                          {prospect.name}
                        </p>
                        {prospect.poiCandidates && prospect.poiCandidates.length > 1 && onProspectUpdate && (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 shrink-0"
                              disabled={
                                companyEnrichmentLoading || (prospect.poiCandidateIndex ?? 0) <= 0
                              }
                              onClick={() => void handlePoiNavigate(-1)}
                              aria-label="POI précédent"
                              title="POI précédent"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 shrink-0"
                              disabled={
                                companyEnrichmentLoading ||
                                (prospect.poiCandidateIndex ?? 0) >= prospect.poiCandidates.length - 1
                              }
                              onClick={() => void handlePoiNavigate(1)}
                              aria-label="POI suivant"
                              title="POI suivant"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    {prospect.address && (
                      <p className="text-xs text-white/80 truncate" title={prospect.address}>
                        {prospect.address}
                      </p>
                    )}
                    </div>

                    <Separator className="bg-white/20 my-2" />

                    {/* Type | Surface | Année (séparateurs verticaux) */}
                    <div className="rounded-lg px-3 py-2 bg-white/10 flex items-stretch gap-0">
                      <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-1">
                        <span className="text-[10px] uppercase tracking-wide text-white/60">Type</span>
                        <PlaceTypeSelect
                          variant="dark"
                          value={prospect.placeType}
                          onValueChange={(value) => {
                            if (onProspectUpdate) {
                              onProspectUpdate({ placeType: value });
                            }
                          }}
                          disabled={!onProspectUpdate}
                        />
                      </div>
                      <Separator orientation="vertical" className="bg-white/20 h-auto my-1" />
                      <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-1">
                        <span className="text-[10px] uppercase tracking-wide text-white/60">Surface</span>
                        {bdnbLoading ? (
                          <Skeleton className="h-6 w-12 bg-white/20 rounded" />
                        ) : (
                          <div className="px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors text-[10px] uppercase text-white/60 min-w-fit">
                            {(prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0).toFixed(0)} m²
                          </div>
                        )}
                      </div>
                      <Separator orientation="vertical" className="bg-white/20 h-auto my-1" />
                      <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-1">
                        <span className="text-[10px] uppercase tracking-wide text-white/60" title="Année de construction (BDNB)">Année</span>
                        {bdnbLoading ? (
                          <Skeleton className="h-6 w-10 bg-white/20 rounded" />
                        ) : (
                          <div className="px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors text-[10px] uppercase text-white/60 min-w-fit">
                            {prospect.anneeConstruction != null ? String(prospect.anneeConstruction) : "—"}
                          </div>
                        )}
                      </div>
                    </div>

                    <Separator className="bg-white/20 my-2" />

                    {/* Entreprise (api.gouv) — liste fixe : skeleton / valeur / "No data" par ligne */}
                    <div className="space-y-3 text-xs pt-3">
                      {PROSPECT_DATA_ROWS.map((row) => {
                        const Icon = row.icon;
                        const isLoading = row.isBdnb ? bdnbLoading : companyEnrichmentLoading;
                        const value = row.getValue(prospect);
                        return (
                          <div key={row.label} className="flex items-center gap-4 min-w-0">
                            <div className="flex shrink-0 items-center gap-1.5 text-white/70 w-[115px]">
                              <Icon className="h-3.5 w-3.5 opacity-70" />
                              <span>{row.label}</span>
                            </div>
                            {isLoading ? (
                              <Skeleton className="h-3.5 flex-1 bg-white/20" />
                            ) : value ? (
                              row.isPhone ? (
                                <a href={`tel:${value.replace(/\s/g, "")}`} className="text-white truncate min-w-0 flex-1 text-left pl-1 hover:underline" title={value}>{value}</a>
                              ) : row.isWebsite ? (
                                <a
                                  href={websiteHref(value)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-white truncate min-w-0 flex-1 text-left pl-1 hover:underline inline-flex items-center gap-1"
                                  title={value}
                                >
                                  <span className="truncate">{value}</span>
                                </a>
                              ) : (
                                <span className={`truncate min-w-0 flex-1 text-left pl-1 ${row.label === "SIREN" || row.label === "SIRET" || row.label === "Code NAF" ? "font-mono text-white" : "text-white"}`} title={value}>{value}</span>
                              )
                            ) : (
                              <span className="text-white/50 min-w-0 flex-1 text-left pl-1">No data</span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Ligne Lat/Lon (gauche) + Badge (droite) - en bas */}
                    <div className="flex items-center justify-between gap-2 pt-1 mt-auto">
                      <div className="flex gap-3 text-[11px] text-white/60 shrink-0">
                        <span>Lat {prospect.coordinates.lat.toFixed(5)}</span>
                        <span>Lon {prospect.coordinates.lng.toFixed(5)}</span>
                      </div>
                      <div className="shrink-0">
                        {phase2ScoringLoading && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-white/70" />
                        )}
                        {!phase2ScoringLoading && phase2Scoring && phase2Scoring.filter((p) => p.score > 0).length > 0 && (() => {
                          const filteredScoring = phase2Scoring.filter((p) => p.score > 0);
                          const bestScore = filteredScoring[0]?.score ?? 0;
                          const confidenceLevel = getConfidenceLevel(bestScore);
                          const badgeProps = getConfidenceBadgeProps(confidenceLevel);
                          return (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="cursor-pointer">
                                  <Badge variant="outline" className={`text-xs font-semibold ${badgeProps.className} cursor-pointer hover:opacity-80 transition-opacity border-white/30`}>
                                    {badgeProps.label}
                                  </Badge>
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-96 p-3" align="end">
                                <div className="space-y-2">
                                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">
                                    Établissements scorés ({filteredScoring.length})
                                  </div>
                                  <div className="max-h-64 space-y-1.5 overflow-y-auto">
                                    {filteredScoring.map((p) => {
                                      const pConfidence = getConfidenceLevel(p.score);
                                      const pBadge = getConfidenceBadgeProps(pConfidence);
                                      return (
                                        <div
                                          key={p.siret}
                                          onClick={() => {
                                            if (onProspectUpdate && prospect) {
                                              onProspectUpdate({
                                                siren: p.siren,
                                                siret: p.siret,
                                                companyLegalName: p.nom_complet,
                                                companyAddress: p.adresse,
                                              });
                                              toast.success("Informations mises à jour", {
                                                description: `Établissement ${p.nom_complet} sélectionné`,
                                                className: "bg-emerald-50 border-emerald-200 [&>div]:text-sm [&>div]:font-semibold [&>div]:text-gray-700",
                                                descriptionClassName: "text-sm text-gray-600",
                                              });
                                            }
                                          }}
                                          className="flex items-start justify-between gap-2 rounded bg-gray-50 px-2 py-2 hover:bg-gray-100 cursor-pointer transition-colors text-xs"
                                        >
                                          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="font-mono text-muted-foreground">#{p.rank}</span>
                                              <span className="font-semibold text-gray-800">score: {p.score}/1000</span>
                                            </div>
                                            <span className="truncate font-medium text-gray-700" title={p.nom_complet}>{p.nom_complet}</span>
                                            <span className="truncate font-mono text-muted-foreground text-[10px]" title={p.siret}>SIRET: {p.siret}</span>
                                            <span className="truncate text-muted-foreground text-[10px]" title={p.adresse}>{p.code_postal} - {p.adresse}</span>
                                          </div>
                                          <Badge variant="outline" className={`text-xs shrink-0 ${pBadge.className}`}>
                                            {pBadge.label}
                                          </Badge>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Test: données BDNB depuis Neon */}
              <Card className="bg-black border-0 text-white overflow-hidden rounded-xl">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] uppercase tracking-wide text-white/70">From Neon (test)</span>
                    {neonBdnbLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/70" />}
                  </div>

                  {neonBdnbError ? (
                    <div className="text-xs text-red-200 break-words">
                      Erreur: {neonBdnbError}
                    </div>
                  ) : neonBdnbLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-3.5 w-40 bg-white/20" />
                      <Skeleton className="h-3.5 w-64 bg-white/20" />
                      <Skeleton className="h-16 w-full bg-white/20" />
                    </div>
                  ) : neonBdnb ? (
                    <div className="space-y-2 text-xs">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-white/80">
                        <span className="font-mono text-white">id: {neonBdnb.id}</span>
                        <span>dist: {neonBdnb.distance_m != null ? `${Math.round(neonBdnb.distance_m)} m` : "—"}</span>
                        <span>commune: {neonBdnb.code_commune_insee ?? "—"}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-white/70">
                        <div>Année: <span className="text-white/90">{neonBdnb.annee_construction ?? "—"}</span></div>
                        <div>DPE: <span className="text-white/90">{neonBdnb.dpe_mix_arrete_classe ?? "—"}</span></div>
                        <div>Logements: <span className="text-white/90">{neonBdnb.nb_logements ?? "—"}</span></div>
                        <div>Surf hab: <span className="text-white/90">{neonBdnb.surface_habitable_logement ?? "—"}</span></div>
                        <div className="col-span-2">Usage: <span className="text-white/90">{neonBdnb.usage_principal_bdnb_open ?? "—"}</span></div>
                      </div>

                      <div className="pt-1">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] uppercase tracking-wide text-white/60">GeoJSON (WGS84)</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[10px] bg-white/0 border-white/20 text-white/80 hover:bg-white/10 hover:text-white"
                            onClick={async () => {
                              const g = neonBdnb.geom_geojson_wgs84;
                              if (!g) return;
                              try {
                                await navigator.clipboard.writeText(g);
                                toast.success("GeoJSON copié");
                              } catch {
                                toast.error("Impossible de copier");
                              }
                            }}
                            disabled={!neonBdnb.geom_geojson_wgs84}
                            title={neonBdnb.geom_geojson_wgs84 ? "Copier GeoJSON" : "Aucune géométrie"}
                          >
                            Copier
                          </Button>
                        </div>
                        <pre className="max-h-28 overflow-auto rounded-md bg-white/10 p-2 text-[10px] leading-snug text-white/80 whitespace-pre-wrap break-words">
                          {(neonBdnb.geom_geojson_wgs84 ?? "—").slice(0, 800)}
                          {(neonBdnb.geom_geojson_wgs84 && neonBdnb.geom_geojson_wgs84.length > 800) ? "\n…(tronqué)" : ""}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-white/60">
                      Aucun bâtiment trouvé (base Neon limitée à Bordeaux pour l’instant).
                    </div>
                  )}
                </CardContent>
              </Card>

              <Dialog open={prospectDetailsOpen} onOpenChange={setProspectDetailsOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0 bg-black border-0 [&>button]:text-white [&>button]:right-4 [&>button]:top-4 hover:[&>button]:bg-white/10 hover:[&>button]:text-white">
                  <DialogHeader className="px-4 md:px-5 pt-4 md:pt-5 pb-2">
                    <DialogTitle className="text-white text-lg font-semibold">
                      {prospect.name || "Détails du prospect"}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="flex-1 overflow-y-auto px-4 md:px-5 pb-4 md:pb-5 space-y-4">
                    <div className="space-y-0 [&>p]:m-0 [&>p]:leading-tight">
                      {prospect.name && (
                        <div className="flex items-center gap-1 min-w-0">
                          <p className="text-xl font-medium text-white truncate flex-1 min-w-0" title={prospect.name}>
                            {prospect.name}
                          </p>
                          {prospect.poiCandidates && prospect.poiCandidates.length > 1 && onProspectUpdate && (
                            <div className="flex shrink-0 items-center gap-0.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 shrink-0"
                                disabled={
                                  companyEnrichmentLoading || (prospect.poiCandidateIndex ?? 0) <= 0
                                }
                                onClick={() => void handlePoiNavigate(-1)}
                                aria-label="POI précédent"
                                title="POI précédent"
                              >
                                <ChevronLeft className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 shrink-0"
                                disabled={
                                  companyEnrichmentLoading ||
                                  (prospect.poiCandidateIndex ?? 0) >= prospect.poiCandidates.length - 1
                                }
                                onClick={() => void handlePoiNavigate(1)}
                                aria-label="POI suivant"
                                title="POI suivant"
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      {prospect.address && (
                        <p className="text-sm text-white/80 mt-1 wrap-break-word" title={prospect.address}>{prospect.address}</p>
                      )}
                    </div>
                    <div className="rounded-lg px-4 py-3 bg-white/10 flex gap-6 flex-wrap">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-white/60">Type</span>
                        <span className="text-sm text-white">{translatePlaceType(prospect.placeType) || prospect.placeType || "—"}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-white/60">Surface</span>
                        <span className="text-sm text-white">{(prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0).toFixed(0)} m²</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-white/60">Orientation</span>
                        <span className="text-sm text-white">
                          {(() => {
                            const surfaces = prospect.roofSurfaces ?? (prospect.roofSurface ? [prospect.roofSurface] : []);
                            const firstOrientation = surfaces[0]?.orientation;
                            return firstOrientation != null ? `${Math.abs(firstOrientation).toFixed(1)}°` : "—";
                          })()}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-white/60">Année</span>
                        <span className="text-sm text-white">{prospect.anneeConstruction != null ? String(prospect.anneeConstruction) : "—"}</span>
                      </div>
                    </div>
                    {(prospect.siren || prospect.companyLegalName || prospect.companyManagerName || prospect.companyAddress || prospect.companyNaf || prospect.contact?.nationalPhoneNumber || prospect.contact?.internationalPhoneNumber || prospect.contact?.websiteUri) && (
                      <div className="space-y-3 text-sm">
                        <div className="text-[10px] uppercase tracking-wide text-white/60">Entreprise</div>
                        <div className="space-y-2">
                          {prospect.siren && (
                            <div className="flex gap-3"><span className="text-white/70 w-24 shrink-0">SIREN</span><span className="text-white font-mono break-all">{prospect.siren}</span></div>
                          )}
                          {prospect.siret && (
                            <div className="flex gap-3"><span className="text-white/70 w-24 shrink-0">SIRET</span><span className="text-white font-mono break-all">{prospect.siret}</span></div>
                          )}
                          {prospect.companyLegalName && (
                            <div className="flex gap-3"><span className="text-white/70 w-24 shrink-0">Dénomination</span><span className="text-white wrap-break-word">{prospect.companyLegalName}</span></div>
                          )}
                          {prospect.companyAddress && (
                            <div className="flex gap-3"><span className="text-white/70 w-24 shrink-0">Adresse siège</span><span className="text-white wrap-break-word">{prospect.companyAddress}</span></div>
                          )}
                          {prospect.companyNaf && (
                            <div className="flex gap-3"><span className="text-white/70 w-24 shrink-0">Code NAF</span><span className="text-white font-mono">{prospect.companyNaf}</span></div>
                          )}
                          {prospect.companyManagerName && (
                            <div className="flex gap-3"><span className="text-white/70 w-24 shrink-0">Gérant</span><span className="text-white wrap-break-word">{prospect.companyManagerName}</span></div>
                          )}
                          {(prospect.contact?.nationalPhoneNumber || prospect.contact?.internationalPhoneNumber) && (
                            <div className="flex gap-3">
                              <span className="text-white/70 w-24 shrink-0">Téléphone</span>
                              <a href={`tel:${(prospect.contact?.internationalPhoneNumber || prospect.contact?.nationalPhoneNumber || "").replace(/\s/g, "")}`} className="text-white hover:underline">{prospect.contact?.nationalPhoneNumber || prospect.contact?.internationalPhoneNumber}</a>
                            </div>
                          )}
                          {prospect.contact?.websiteUri && (
                            <div className="flex gap-3 min-w-0">
                              <span className="text-white/70 w-24 shrink-0">Site web</span>
                              <a
                                href={websiteHref(prospect.contact.websiteUri)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-white hover:underline truncate min-w-0"
                                title={prospect.contact.websiteUri}
                              >
                                {prospect.contact.websiteUri}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {prospect.coordinates && (
                      <div className="flex gap-4 text-xs text-white/60 pt-2 border-t border-white/20">
                        <span>Lat {prospect.coordinates.lat.toFixed(5)}</span>
                        <span>Lon {prospect.coordinates.lng.toFixed(5)}</span>
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>

              {/* Section des surfaces */}
              <div className="bg-gray-100 rounded-xl py-3 px-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Surfaces</div>
                  {!isDrawing && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        if (onDrawingChange) {
                          onDrawingChange(true);
                        }
                      }}
                      className="h-8 w-8"
                      title="Ajouter une surface"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {/* Liste des surfaces */}
                <div className="space-y-2">
                  {(() => {
                    // Utiliser roofSurfaces si disponible, sinon utiliser roofSurface pour compatibilité
                    const surfaces = prospect.roofSurfaces || 
                      (prospect.roofSurface.area > 0 ? [prospect.roofSurface] : []);
                    
                    
                    if (surfaces.length === 0) {
                      return (
                        <div className="text-sm text-muted-foreground text-center py-2">
                          Aucune surface définie
                        </div>
                      );
                    }

                    return surfaces.map((surface, index) => {
                      const surfaceId = surface.id || `surface-${index}`;
                      const surfaceKwp = surfaceToKwp(surface.area);
                      return (
                        <div
                          key={surfaceId}
                          className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-stretch gap-3"
                        >
                          <div className="shrink-0 flex items-center">
                            <div className="w-2.5 h-2.5 rounded-full bg-[#E4FE55]" />
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <div className="font-semibold text-xs text-foreground">
                              Surface {index + 1}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                {surface.area.toFixed(2)} m²
                              </span>
                            </div>
                          </div>
                          {/* Bouton de suppression */}
                            {!isDrawing && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  if (onSurfaceDelete) {
                                    onSurfaceDelete(surfaceId);
                                  } else if (onProspectUpdate && prospect) {
                                    // Fallback: supprimer directement depuis le prospect
                                    const surfaces = prospect.roofSurfaces || 
                                      (prospect.roofSurface.area > 0 ? [prospect.roofSurface] : []);
                                    const updatedSurfaces = surfaces.filter((s, idx) => 
                                      (s.id || `surface-${idx}`) !== surfaceId
                                    );
                                    
                                    // Calculer la surface totale
                                    const totalArea = updatedSurfaces.reduce((sum, s) => sum + s.area, 0);
                                    
                                    onProspectUpdate({
                                      roofSurfaces: updatedSurfaces,
                                      roofSurface: updatedSurfaces.length > 0 
                                        ? updatedSurfaces[0] 
                                        : { area: 0, polygon: [] },
                                    });
                                  }
                                }}
                                className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                                title="Supprimer cette surface"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {prospect.exposure && (
                <div className="bg-gray-100 rounded-xl py-3 px-4">
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>Nord: {prospect.exposure.north}%</div>
                    <div>Sud: {prospect.exposure.south}%</div>
                    <div>Est: {prospect.exposure.east}%</div>
                    <div>Ouest: {prospect.exposure.west}%</div>
                  </div>
                </div>
              )}

              {/* Chargement / erreur PVGIS */}
              {isLoadingPVGIS && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2 bg-gray-100 rounded-xl px-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Chargement des données d&apos;ensoleillement...</span>
                </div>
              )}
              {pvgisError && !isLoadingPVGIS && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{pvgisError}</span>
                </div>
              )}
                </div>

                <div className="space-y-2">
              {/* Choice cards : Perfect fit / Highest production — au-dessus de Production */}
              {(prospect.solarPotential?.productionPerKwpMonthly?.length || prospect.solarPotential?.monthlyProduction?.length) &&
               !isLoadingPVGIS &&
               ((prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0) > 0) && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      pendingBatteryResyncAfterModeChangeRef.current = true;
                      setConfigurationMode("perfect_fit");
                      if (prospect && onProspectUpdate) {
                        onProspectUpdate({ configurationMode: "perfect_fit" });
                      }
                    }}
                    className={`cursor-pointer rounded-xl px-4 py-4 text-left transition-colors h-full flex flex-col justify-between overflow-hidden ${
                      configurationMode === "perfect_fit"
                        ? "border border-[#0000FF33] bg-[#0000FF0D] shadow-xs"
                        : "border border-transparent bg-gray-100 hover:bg-gray-200/80"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-gray-500">Perfect fit</span>
                    </div>
                    <div className="mt-auto">
                      <div className={`text-sm font-normal ${configurationMode === "perfect_fit" ? "text-[#0000FF]" : "text-gray-700"}`}>
                        {choiceCardsConfig.perfectFit.kwp.toFixed(2)}
                        <span className={`text-xs font-light ml-0.5 ${configurationMode === "perfect_fit" ? "text-[#0000FF]" : "text-gray-400"}`}>kWp</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <span className="text-[10px] text-muted-foreground">{choiceCardsConfig.perfectFit.panelCount} panneaux</span>
                        <span className="text-[10px] text-muted-foreground">·</span>
                        <span className="text-[10px] text-muted-foreground">{choiceCardsConfig.perfectFit.inverterCount} onduleur{choiceCardsConfig.perfectFit.inverterCount > 1 ? "s" : ""}</span>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      pendingBatteryResyncAfterModeChangeRef.current = true;
                      setConfigurationMode("highest_production");
                      if (prospect && onProspectUpdate) {
                        onProspectUpdate({ configurationMode: "highest_production" });
                      }
                    }}
                    className={`cursor-pointer rounded-xl px-4 py-4 text-left transition-colors h-full flex flex-col justify-between overflow-hidden ${
                      configurationMode === "highest_production"
                        ? "border border-[#0000FF33] bg-[#0000FF0D] shadow-xs"
                        : "border border-transparent bg-gray-100 hover:bg-gray-200/80"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-gray-500">Highest production</span>
                    </div>
                    <div className="mt-auto">
                      <div className={`text-sm font-normal ${configurationMode === "highest_production" ? "text-[#0000FF]" : "text-gray-700"}`}>
                        {choiceCardsConfig.highestProduction.kwp.toFixed(2)}
                        <span className={`text-xs font-light ml-0.5 ${configurationMode === "highest_production" ? "text-[#0000FF]" : "text-gray-400"}`}>kWp</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <span className="text-[10px] text-muted-foreground">{choiceCardsConfig.highestProduction.panelCount} panneaux</span>
                        <span className="text-[10px] text-muted-foreground">·</span>
                        <span className="text-[10px] text-muted-foreground">{choiceCardsConfig.highestProduction.inverterCount} onduleur{choiceCardsConfig.highestProduction.inverterCount > 1 ? "s" : ""}</span>
                      </div>
                    </div>
                  </button>
                </div>
              )}

              {/* Production mensuelle : affiché uniquement si surface définie (kWp + consommation) */}
              {(prospect.solarPotential?.productionPerKwpMonthly?.length || prospect.solarPotential?.monthlyProduction?.length) &&
               !isLoadingPVGIS &&
               ((prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0) > 0) && (
                <>
                  <div className="flex flex-col bg-gray-100 rounded-xl py-3 px-4 pb-2">
                    <div className="flex shrink-0 items-start justify-between gap-2 mb-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] uppercase tracking-wide text-gray-500">Production</span>
                        {(() => {
                          const surfaceM2 =
                            prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ??
                            prospect.roofSurface?.area ??
                            0;
                          const placeType = prospect.placeType || "other";

                          if (chartViewMode === "daily" && effectiveConfig.productionPerKwp) {
                            const { dailyTypical } = getProductionFromPerKwp(
                              effectiveConfig.productionPerKwp.productionPerKwpAnnual,
                              effectiveConfig.productionPerKwp.productionPerKwpMonthly,
                              effectiveConfig.effectiveKwp
                            );
                            const dailyProductionKwh = dailyTypical.reduce((s, v) => s + (v ?? 0), 0);
                            const hourlyConsumptionPerM2 = getHourlyConsumptionProfileKwhPerM2(placeType);
                            const dailyConsumptionKwh =
                              surfaceM2 * (hourlyConsumptionPerM2?.reduce((s, v) => s + (v ?? 0), 0) ?? 0);
                            const fmt = (kwh: number) =>
                              kwh >= 1000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${Math.round(kwh)} kWh`;
                            return (
                              <>
                                <span className="text-xs text-gray-600 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-black shrink-0" />
                                  {fmt(dailyProductionKwh)} /j
                                </span>
                                <span className="text-xs text-gray-600 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[hsl(0,0%,72%)]" />
                                  {fmt(dailyConsumptionKwh)} /j
                                </span>
                              </>
                            );
                          }

                          const totalConsumptionKwh = getEnergyConsumption(placeType) * surfaceM2;
                          const consumptionGwh = totalConsumptionKwh / 1_000_000;
                          const productionKwh = effectiveConfig.effectiveAnnualProductionKwh;
                          const productionGwh = productionKwh / 1_000_000;
                          return (
                            <>
                              <span className="text-xs text-gray-600 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-black shrink-0" />
                                {productionGwh >= 0.001 ? productionGwh.toFixed(3) : productionGwh.toFixed(6)} GWh
                              </span>
                              <span className="text-xs text-gray-600 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[hsl(0,0%,72%)]" />
                                {consumptionGwh >= 0.001 ? consumptionGwh.toFixed(3) : consumptionGwh.toFixed(6)} GWh
                              </span>
                            </>
                          );
                        })()}
                      </div>
                      <div
                        role="tablist"
                        className="inline-flex rounded-md border border-border bg-muted/50 p-0.5 shrink-0"
                        aria-label="Vue du graphique"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={chartViewMode === "monthly"}
                          onClick={() => setChartViewMode("monthly")}
                          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                            chartViewMode === "monthly"
                              ? "bg-background text-foreground shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Mensuel
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={chartViewMode === "daily"}
                          onClick={() => setChartViewMode("daily")}
                          className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            chartViewMode === "daily"
                              ? "bg-background text-foreground shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Journalier
                        </button>
                      </div>
                    </div>
                    <div className="h-[260px] min-w-0 w-full">
                      <MonthlyProductionChart
                        key={configurationMode}
                        viewMode={chartViewMode}
                        onViewModeChange={setChartViewMode}
                        selectedMonthIndex={chartSelectedMonthIndex}
                        onSelectedMonthIndexChange={setChartSelectedMonthIndex}
                        data={chartData}
                        dailyData={chartDailyData}
                      />
                    </div>
                  </div>

                  {/* Switch batterie : valeur effective = prospect.includeBatteryOverride ?? settings.includeBattery (défaut true) */}
                  {(prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0) > 0 && (
                    <div className="flex items-center justify-between rounded-xl border border-border bg-white p-3">
                      <div className="flex items-center gap-2">
                        <Battery className="h-4 w-4 text-muted-foreground" />
                        <Label htmlFor="include-battery" className="text-sm font-medium cursor-pointer">Inclure batterie</Label>
                      </div>
                      <Switch
                        id="include-battery"
                        className="data-[state=checked]:bg-[#0000FF]"
                        checked={prospect.includeBatteryOverride ?? getSolarEquipmentSettings().includeBattery ?? true}
                        onCheckedChange={(checked) => {
                          if (onProspectUpdate) {
                            onProspectUpdate({ includeBatteryOverride: checked });
                          }
                        }}
                      />
                    </div>
                  )}

                  {/* Bloc finance (même que page partagée) + Estimated price */}
                  {(() => {
                    const totalArea = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0;
                    if (totalArea <= 0 || !financialSummary) return null;
                    const placeType = prospect.placeType || "other";
                    const totalConsumptionKwh = totalArea > 0 ? getEnergyConsumption(placeType) * totalArea : 0;
                    const energyBillEur = estimateEnergyBillEur(totalConsumptionKwh);
                    const {
                      priceRange,
                      annualSavings,
                      breakEvenMin,
                      breakEvenMax,
                      breakdownFromHourlySim,
                      selfConsumptionDirectKwhTotal,
                      selfConsumptionViaBatteryKwhTotal,
                      injectionReseauKwhTotal,
                    } = financialSummary;
                    const breakEvenLabel =
                      breakEvenMin != null && breakEvenMax != null
                        ? breakEvenMin === breakEvenMax
                          ? `${breakEvenMin} an${breakEvenMin > 1 ? "s" : ""}`
                          : `${breakEvenMin} – ${breakEvenMax} ans`
                        : "—";
                    const fmtPart = (eur: number) =>
                      eur >= 1000 ? `${Math.round(eur / 100) / 10} k€` : `${Math.round(eur)} €`;
                    const directEur = (selfConsumptionDirectKwhTotal ?? 0) * DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH;
                    const viaBatteryEur = (selfConsumptionViaBatteryKwhTotal ?? 0) * DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH;
                    const injectionReseauEur = (injectionReseauKwhTotal ?? 0) * DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH;
                    const totalSavings = directEur + viaBatteryEur + injectionReseauEur;
                    const savingsPctRaw = energyBillEur > 0 ? (annualSavings / energyBillEur) * 100 : 0;
                    const savingsPct = Math.min(100, savingsPctRaw);
                    const pctBattery = totalSavings > 0 ? (viaBatteryEur / totalSavings) * 100 : 0;
                    const pctDirect = totalSavings > 0 ? (directEur / totalSavings) * 100 : 0;
                    const productionKwh = effectiveConfig.effectiveAnnualProductionKwh;
                    const autoKwh = (selfConsumptionDirectKwhTotal ?? 0) + (selfConsumptionViaBatteryKwhTotal ?? 0);
                    const autoPct = productionKwh > 0 ? Math.round((autoKwh / productionKwh) * 100) : 0;
                    const row = (key: string, label: ReactNode, value: ReactNode, valueSmall?: boolean) => (
                      <div key={key} className="flex items-center justify-between gap-2 min-w-0 py-0 first:pt-0 last:pb-0">
                        <span className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide truncate min-w-0">{label}</span>
                        <span className={`font-normal text-gray-500 shrink-0 tabular-nums ${valueSmall ? "text-[10px] sm:text-xs" : "text-xs sm:text-sm"}`}>{value}</span>
                      </div>
                    );
                    return (
                      <>
                        <div className="rounded-xl px-3 py-3 sm:px-4 sm:py-4 min-h-0 flex flex-col justify-center bg-gray-100 overflow-y-auto overflow-x-hidden">
                          <div className="flex items-center justify-between gap-1 mb-1.5 sm:mb-2">
                            <span className="text-[10px] uppercase tracking-wide text-gray-500">Financial yearly</span>
                          </div>
                          <div className="flex flex-col gap-y-1 sm:gap-y-1.5 text-xs">
                            {energyBillEur > 0 && (
                              <div className="w-full mb-1.5 shrink-0">
                                <div className="flex justify-between items-center mb-0.5">
                                  {annualSavings > 0 && (
                                    <span className="text-[9px] text-gray-400 tabular-nums" title="Économies en % de la facture énergétique">
                                      {Math.round(savingsPctRaw)}%
                                    </span>
                                  )}
                                  {productionKwh > 0 && (
                                    <span className="text-[9px] text-gray-400 tabular-nums" title="Taux d'autoconsommation">
                                      {autoPct}%
                                    </span>
                                  )}
                                </div>
                                <div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden flex">
                                  {savingsPct > 0 && breakdownFromHourlySim && totalSavings > 0 ? (
                                    <div className="h-full flex shrink-0" style={{ width: `${savingsPct}%` }}>
                                      <div className="h-full bg-[#0000FF] shrink-0" style={{ width: `${pctBattery}%` }} title="Autoconsommation batterie" />
                                      <div className="h-full bg-[#4B5563] shrink-0" style={{ width: `${pctDirect}%` }} title="Autoconsommation directe" />
                                      <div className="h-full bg-[#32F490] shrink-0 flex-1" title="Injection réseau" />
                                    </div>
                                  ) : savingsPct > 0 ? (
                                    <div className="h-full rounded-l-full bg-gray-600" style={{ width: `${savingsPct}%` }} />
                                  ) : null}
                                </div>
                              </div>
                            )}
                            {row("energy-bill", "Est. Energy bill", <>{energyBillEur.toLocaleString("fr-FR")}<span className="text-gray-400 ml-0.5 font-light">€</span></>)}
                            {row("savings", "Savings", <>{annualSavings.toLocaleString("fr-FR")}<span className="text-gray-400 ml-0.5 font-light">€</span></>)}
                            {breakdownFromHourlySim ? (
                              <>
                                {row(
                                  "battery",
                                  <span className="flex items-center gap-1.5 truncate text-[9px] sm:text-[10px]"><span className="w-2 h-2 rounded-[2px] bg-[#0000FF] shrink-0" />Autoconsommation batterie</span>,
                                  fmtPart(viaBatteryEur),
                                  true
                                )}
                                {row(
                                  "direct",
                                  <span className="flex items-center gap-1.5 truncate text-[9px] sm:text-[10px]"><span className="w-2 h-2 rounded-[2px] bg-[#4B5563] shrink-0" />Autoconsommation directe</span>,
                                  fmtPart(directEur),
                                  true
                                )}
                                {row(
                                  "injection",
                                  <span className="flex items-center gap-1.5 truncate text-[9px] sm:text-[10px]"><span className="w-2 h-2 rounded-[2px] bg-[#32F490] shrink-0" />Injection réseau</span>,
                                  fmtPart(injectionReseauEur),
                                  true
                                )}
                              </>
                            ) : (
                              <p className="text-[10px] text-gray-500 py-0">Répartition non disponible sans données mensuelles</p>
                            )}
                          </div>
                        </div>
                        <div className="rounded-xl px-4 py-4 min-h-[130px] flex flex-col justify-between bg-gray-100">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] uppercase tracking-wide text-gray-500">Estimated project price</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" title="Fourchette du coût total d'installation (équipement, BOS et maîtrise d'œuvre)." />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <div className="text-sm text-gray-500">{breakEvenLabel}</div>
                            <div className="text-2xl font-normal text-gray-700">
                              {priceRange.totalMinEur.toLocaleString("fr-FR")} – {priceRange.totalMaxEur.toLocaleString("fr-FR")}
                              <span className="text-sm font-light text-gray-400 ml-0.5">€</span>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                  {/* Équipement (Panneau + Onduleur + Batterie) */}
                  {(usedPanelRef || usedInverterRef || usedBatteryRef || includeBatteryEffective) && (
                  <div className="bg-gray-100 rounded-xl py-3 px-4">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-3">Équipement</div>
                    <div className="space-y-2">
                        {panelsData && panelsData.length > 0 && (
                          <div>
                            <EquipmentSelectCard<PanelReference>
                              value={usedPanelRef}
                              options={
                                panelsData.filter((p) => p.visible === true).length > 0
                                  ? panelsData.filter((p) => p.visible === true)
                                  : panelsData
                              }
                              onChange={setUsedPanelRef}
                              getItemId={(p) => p.id}
                              showRecommendedBadge={!!usedPanelRef?.recommended}
                              rightBadge={usedPanelRef ? String(effectiveConfig.effectivePanelCount) : undefined}
                              placeholder={
                                <span className="flex items-center gap-2">
                                  <Zap className="h-5 w-5" />
                                  Choisir un panneau
                                </span>
                              }
                              renderTriggerContent={(p, { badges }) => (
                                <>
                                  <EquipmentThumbnail imageUrl={p.imageUrl} alt={p.name} fallback={<span className="text-muted-foreground text-xs">—</span>} />
                                  <div className="flex-1 min-w-0 flex flex-col justify-center text-left">
                                    <div className="flex w-full items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0 font-semibold text-xs text-foreground truncate">{p.name}</div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {badges}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">€{p.costEur}</span>
                                      <span className="text-muted-foreground/40 text-xs">|</span>
                                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                        <Zap className="h-3 w-3 text-muted-foreground/80" />
                                        {p.powerW}W
                                      </span>
                                      {p.warrantyYears != null && (
                                        <>
                                          <span className="text-muted-foreground/40 text-xs">|</span>
                                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                            <FileCheck className="h-3 w-3 text-muted-foreground/80" />
                                            {p.warrantyYears}y
                                          </span>
                                        </>
                                      )}
                                      {p.countryCode && (
                                        <>
                                          <span className="text-muted-foreground/40 text-xs">|</span>
                                          <span className="inline-flex shrink-0" title={p.countryOfOrigin}>
                                            <img src={getCountryFlagUrl(p.countryCode)} alt="" className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50" width={12} height={12} />
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                              renderOptionContent={(p, selected) => (
                                <>
                                  <EquipmentThumbnail imageUrl={p.imageUrl} alt="" fallback={<span className="text-muted-foreground text-xs">—</span>} size="sm" />
                                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <div className="font-medium text-xs text-foreground truncate">{p.name}</div>
                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] text-muted-foreground">
                                      <span>€{p.costEur}</span>
                                      <span>·</span>
                                      <span>{p.powerW}W</span>
                                      {p.recommended && (
                                        <span className="inline-flex items-center rounded bg-gray-900 px-1 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                            />
                          </div>
                        )}
                        {invertersData && invertersData.length > 0 && (
                          <div>
                            <EquipmentSelectCard<InverterReference>
                              value={usedInverterRef}
                              options={invertersData.filter((i) => i.visible !== false)}
                              onChange={setUsedInverterRef}
                              getItemId={(i) => i.id}
                              showRecommendedBadge={!!usedInverterRef?.recommended && !inverterCountExceedsLimit}
                              warningBadge={inverterCountExceedsLimit ? (
                                <span className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" title="Plus de 8 onduleurs : choisir un modèle plus puissant">
                                  Changer de modèle
                                </span>
                              ) : undefined}
                              rightBadge={usedInverterRef ? String(effectiveInverterCount) : undefined}
                              placeholder={
                                <span className="flex items-center gap-2">
                                  <Zap className="h-5 w-5" />
                                  Choisir un onduleur
                                </span>
                              }
                              renderTriggerContent={(i, { badges }) => (
                                <>
                                  <EquipmentThumbnail imageUrl={i.imageUrl} alt={i.name} fallback={<span className="text-muted-foreground text-xs">—</span>} />
                                  <div className="flex-1 min-w-0 flex flex-col justify-center text-left">
                                    <div className="flex w-full items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0 font-semibold text-xs text-foreground truncate">{i.name}</div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {badges}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">€{i.costEur}</span>
                                      <span className="text-muted-foreground/40 text-xs">|</span>
                                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                        <Zap className="h-3 w-3 text-muted-foreground/80" />
                                        {i.powerW}W
                                      </span>
                                      {i.warrantyYears != null && (
                                        <>
                                          <span className="text-muted-foreground/40 text-xs">|</span>
                                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                            <FileCheck className="h-3 w-3 text-muted-foreground/80" />
                                            {i.warrantyYears}y
                                          </span>
                                        </>
                                      )}
                                      {i.countryCode && (
                                        <>
                                          <span className="text-muted-foreground/40 text-xs">|</span>
                                          <span className="inline-flex shrink-0" title={i.countryOfOrigin}>
                                            <img src={getCountryFlagUrl(i.countryCode)} alt="" className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50" width={12} height={12} />
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                              renderOptionContent={(i) => (
                                <>
                                  <EquipmentThumbnail imageUrl={i.imageUrl} alt="" fallback={<span className="text-muted-foreground text-xs">—</span>} size="sm" />
                                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <div className="font-medium text-xs text-foreground truncate">{i.name}</div>
                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] text-muted-foreground">
                                      <span>€{i.costEur}</span>
                                      <span>·</span>
                                      <span>{i.powerW}W</span>
                                      {i.recommended && (
                                        <span className="inline-flex items-center rounded bg-gray-900 px-1 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                            />
                          </div>
                        )}
                        {includeBatteryEffective && (
                          <div className="space-y-1.5">
                            {recommendedBatteryKwh != null && (
                              <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5">
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Cible batterie</span>
                                <span className="text-xs font-semibold tabular-nums">{recommendedBatteryKwh} kWh</span>
                              </div>
                            )}
                            {batteriesData && batteriesData.filter((b) => b.visible !== false).length > 0 ? (
                              <BatterySelectCard
                                value={usedBatteryRef}
                                onChange={(b) => {
                                  setUsedBatteryRef(b);
                                  const maxForNew = b?.maxBatteriesPerRack ?? 20;
                                  const clampedCount = b ? Math.min(maxForNew, Math.max(1, batteryCount)) : 1;
                                  setBatteryCount(clampedCount);
                                  if (b && prospect && onProspectUpdate) {
                                    onProspectUpdate({ batteryReferenceId: b.id, batteryCount: clampedCount });
                                  }
                                }}
                                count={batteryCount}
                                onCountChange={(n) => {
                                  setBatteryCount(n);
                                  if (prospect && onProspectUpdate) {
                                    onProspectUpdate({ batteryCount: n });
                                  }
                                }}
                                maxCount={usedBatteryRef?.maxBatteriesPerRack ?? 20}
                                batteries={batteriesData.filter((b) => b.visible !== false)}
                                isRecommendedForProspect={
                                  !!recommendedBatteryComposition &&
                                  usedBatteryRef?.id === recommendedBatteryComposition.model.id &&
                                  batteryCount === recommendedBatteryComposition.count
                                }
                                recommendedBatteryIdForProspect={recommendedBatteryComposition?.model.id ?? null}
                              />
                            ) : (
                              <p className="text-xs text-muted-foreground">Aucune batterie configurée. Ajoutez-en dans Paramètres.</p>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                  )}
                </>
              )}
                </div>
              </div>

              {/* Données financières (en dernier) */}
              {(() => {
                const totalArea = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0;
                if (totalArea <= 0 || !financialSummary) return null;
                return null;
              })()}
            </>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">
              Cliquez sur la carte pour obtenir les informations d&apos;un lieu
            </div>
          )}
        </div>

        <div className="p-4 mt-auto bg-white space-y-2 rounded-b-2xl">
          {prospect?.id && (
            <div className="flex flex-wrap gap-2">
              <Link href={voirHref(prospect.id)}>
                <Button
                  variant="default"
                  size="icon"
                  className="h-12 w-12 shrink-0 border-0 bg-gray-100 hover:bg-gray-200 text-gray-700"
                  title={isOnMap ? "Voir" : "Voir sur la carte"}
                  aria-label={isOnMap ? "Voir" : "Voir sur la carte"}
                >
                  {isOnMap ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <Map className="h-4 w-4" />
                  )}
                </Button>
              </Link>
              <Button
                variant="default"
                size="icon"
                className="h-12 w-12 shrink-0 border-0 bg-gray-100 hover:bg-gray-200 text-gray-700"
                onClick={handleOpenSharePage}
                disabled={isGeneratingLink}
                title={isGeneratingLink ? "Ouverture..." : "Voir la page partagée"}
                aria-label={isGeneratingLink ? "Ouverture..." : "Voir la page partagée"}
              >
                {isGeneratingLink ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
              </Button>
              <Button
                onClick={handleSave}
                className="flex-1 min-w-0"
                size="lg"
                disabled={isSaving}
              >
                {isSaving ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </div>
          )}
          {prospect && onAddToPipeline && !prospect.id && (
            <div className="flex gap-2">
              {onDrawingChange && (
                <Button
                  variant="default"
                  size="icon"
                  className="h-12 w-12 shrink-0 border-0 bg-gray-100 hover:bg-gray-200 text-gray-700"
                  onClick={() => onDrawingChange(!isDrawing)}
                  title={isDrawing ? "Quitter l'édition" : "Surface"}
                  aria-label={isDrawing ? "Quitter l'édition" : "Surface"}
                >
                  {isDrawing ? (
                    <X className="h-4 w-4" />
                  ) : (
                    <PenTool className="h-4 w-4" />
                  )}
                </Button>
              )}
              <Button
                variant={(prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0) > 0 ? "default" : "secondary"}
                onClick={handleAddToPipeline}
                className="flex-1"
                size="lg"
                disabled={isAdding}
              >
                {isAdding ? "Ajout en cours..." : "Ajouter au pipeline"}
              </Button>
            </div>
          )}
        </div>
    </div>
  );
}
