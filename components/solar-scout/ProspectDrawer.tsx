"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, X, Loader2, AlertCircle, Zap, FileCheck, Info, Building2, MapPin, Hash, Tag, User, Phone, Maximize2, Link2, Eye, Map, PenTool, ExternalLink, Calendar } from "lucide-react";
import { addProspectToPipeline, createLeadFromProspect, updateProspectInPipeline, updateProspect } from "@/lib/firestore";
import { translatePlaceType } from "@/lib/place-types-translation";
import {
  Label,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  RadialBar,
  RadialBarChart,
} from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { getProspectImageCenter } from "@/lib/geometry";
import { SatelliteImage } from "./SatelliteImage";
import { MonthlyProductionChart } from "./MonthlyProductionChart";
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
} from "@/lib/pvgis";
import {
  getPanelReferences,
  getCountryFlagUrl,
  getRecommendedPanelReferenceSync,
  getRecommendedInverterReferenceSync,
  calculatePanelCount,
  calculateInverterCount,
  estimateInstallationPriceEur,
  estimateTotalPriceRangeEur,
  estimateAnnualSavingsEur,
  estimateEnergyBillEur,
  getBreakEvenYears,
} from "@/lib/solar-settings";
import { getPanelReferencesFromFirebase } from "@/lib/firestore-panel-references";
import { getInverterReferencesFromFirebase } from "@/lib/firestore-inverter-references";
import { fetchCompanyEnrichment, buildApiGouvSearchUrl } from "@/lib/recherche-entreprises";
import { getCommercialReferent, buildCommercialReferentFromUser } from "@/lib/commercial-mock";
import { useAuth } from "@/lib/auth-context";
import { getUserProfile } from "@/lib/firestore-user-profile";
import type { ScoredCandidate } from "@/lib/find-local-siren";
import type { Prospect, SolarPotential, PanelReference, InverterReference, CommercialReferent } from "@/types";

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

/** Détermine le niveau de confiance basé sur le score (0-1000) */
function getConfidenceLevel(score: number): "high" | "medium" | "low" {
  if (score >= 700) return "high";
  if (score >= 400) return "medium";
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
            ? "h-auto w-fit min-w-0 border-0 px-3 py-1.5 text-[10px] uppercase text-white/60 hover:text-white/80 [&>span]:text-white/60 [&>span]:uppercase [&>span]:text-[10px] bg-white/10 hover:bg-white/15 focus:ring-0 focus:ring-offset-0 [&_svg]:text-white/60 [&_svg]:opacity-80 [&_svg]:h-3 [&_svg]:w-3 placeholder:text-white/60 justify-start gap-1"
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
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToPipeline?: () => void;
  onSaveSuccess?: () => void;
  isDrawing?: boolean;
  onDrawingChange?: (isDrawing: boolean) => void;
  onSurfaceUpdate?: (surface: { area: number; polygon: Array<{ lat: number; lng: number }>; orientation?: number }) => void;
  onSurfaceDelete?: (surfaceId: string) => void;
  onProspectUpdate?: (prospect: Prospect) => void;
  onValidateDrawing?: () => void;
  voirHref?: (prospectId: string) => string;
}

export function ProspectDrawer({
  prospect,
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
  const [usedPanelRef, setUsedPanelRef] = useState<PanelReference | null>(null);
  const [usedInverterRef, setUsedInverterRef] = useState<InverterReference | null>(null);
  /** "highest_production" = max surface utilisée | "perfect_fit" = production ≈ consommation */
  const [configurationMode, setConfigurationMode] = useState<"highest_production" | "perfect_fit">("highest_production");
  const [companyEnrichmentLoading, setCompanyEnrichmentLoading] = useState(false);
  const [phase2Scoring, setPhase2Scoring] = useState<ScoredCandidate[] | null>(null);
  const [phase2ScoringLoading, setPhase2ScoringLoading] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"prospect" | "projet">("prospect");
  const [prospectDetailsOpen, setProspectDetailsOpen] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const { user } = useAuth();

  // Enrichissement entreprise (api.gouv) : une fois par prospect si pas déjà de SIREN (drawer ouvert)
  useEffect(() => {
    if (!isOpen || !prospect || !onProspectUpdate) return;
    const hasQuery = !!(prospect.name?.trim() || prospect.address?.trim());
    if (!hasQuery || prospect.siren) return;

    let cancelled = false;
    setCompanyEnrichmentLoading(true);
    fetchCompanyEnrichment(prospect)
      .then(({ enrichment, winningQuery }) => {
        if (cancelled || !enrichment || !onProspectUpdate) return;
        onProspectUpdate({
          ...prospect,
          siren: enrichment.siren ?? prospect.siren,
          siret: enrichment.siret ?? prospect.siret,
          companyLegalName: enrichment.companyLegalName ?? prospect.companyLegalName,
          companyManagerName: enrichment.companyManagerName ?? prospect.companyManagerName,
          companyAddress: enrichment.companyAddress ?? prospect.companyAddress,
          companyNaf: enrichment.companyNaf ?? prospect.companyNaf,
          companyEnrichmentApiUrl: winningQuery ? buildApiGouvSearchUrl(winningQuery) : undefined,
        });
      })
      .finally(() => {
        if (!cancelled) setCompanyEnrichmentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, prospect?.name, prospect?.address, prospect?.siren, onProspectUpdate]);

  // Scoring Phase 2 (find-local-siren) pour affichage sous le bloc API gouv
  useEffect(() => {
    if (!isOpen || !prospect) {
      setPhase2Scoring(null);
      return;
    }
    const name = prospect.name?.trim();
    const address = prospect.address?.trim();
    const coords = prospect.coordinates;
    if (!name || !address || coords?.lat == null || coords?.lng == null) {
      setPhase2Scoring(null);
      return;
    }
    let cancelled = false;
    setPhase2ScoringLoading(true);
    setPhase2Scoring(null);
    const params = new URLSearchParams({
      poiName: name,
      address,
      lat: String(coords.lat),
      lon: String(coords.lng),
      debug: "1",
    });
    fetch(`/api/find-local-siren?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.phase2Scoring) return;
        setPhase2Scoring(data.phase2Scoring);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPhase2ScoringLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, prospect?.name, prospect?.address, prospect?.coordinates?.lat, prospect?.coordinates?.lng]);

  // Recharger les références de panneaux quand le drawer s'ouvre pour avoir les dernières dimensions
  useEffect(() => {
    if (!isOpen) return;
    getPanelReferencesFromFirebase()
      .then((refs) => {
        const recommended = refs.find(r => r.recommended === true);
        setUsedPanelRef(recommended ?? refs[0] ?? null);
      })
      .catch(() => {
        const recommended = getRecommendedPanelReferenceSync();
        setUsedPanelRef(recommended ?? getPanelReferences()[0] ?? null);
      });
  }, [isOpen]);

  useEffect(() => {
    getInverterReferencesFromFirebase()
      .then((refs) => {
        const recommended = refs.find(r => r.recommended === true);
        setUsedInverterRef(recommended ?? refs[0] ?? null);
      })
      .catch(() => {
        setUsedInverterRef(getRecommendedInverterReferenceSync());
      });
  }, []);

  // Mettre à jour l'adresse et le mode de config quand le prospect change
  useEffect(() => {
    if (prospect?.address) {
      setAddress(prospect.address);
    }
    if (prospect?.configurationMode) {
      setConfigurationMode(prospect.configurationMode);
    } else {
      setConfigurationMode("highest_production");
    }
  }, [prospect]);

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

        onProspectUpdate({
          ...prospect,
          solarPotential: updatedSolarPotential,
        });
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
        const recommendedPanel = usedPanelRef ?? getRecommendedPanelReferenceSync();
        const recommendedInverter = usedInverterRef ?? getRecommendedInverterReferenceSync();
        const panelCount = effectiveConfig.effectivePanelCount;
        const totalPowerKW = effectiveConfig.effectiveKwp;
        const annualProductionKWh = effectiveConfig.effectiveAnnualProductionKwh;
        if (totalPowerKW > 0) {
          pipelineOptions.estimatedKwp = totalPowerKW;
          const inverterCount = calculateInverterCount(totalPowerKW, recommendedInverter);
          const equipmentEur = estimateInstallationPriceEur(
            panelCount,
            inverterCount,
            recommendedPanel,
            recommendedInverter
          );
          const priceRange = estimateTotalPriceRangeEur(totalPowerKW, equipmentEur);
          pipelineOptions.priceRangeMinEur = priceRange.totalMinEur;
          pipelineOptions.priceRangeMaxEur = priceRange.totalMaxEur;
          if (annualProductionKWh > 0) {
            const totalConsumptionKwh = totalArea > 0 ? getEnergyConsumption(prospect.placeType || "other") * totalArea : 0;
            const annualSavings = estimateAnnualSavingsEur(annualProductionKWh, undefined, totalConsumptionKwh);
            pipelineOptions.breakEvenMinYears = getBreakEvenYears(
              priceRange.totalMinEur,
              annualSavings
            );
            pipelineOptions.breakEvenMaxYears = getBreakEvenYears(
              priceRange.totalMaxEur,
              annualSavings
            );
          }
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
      if (totalArea > 0) {
        const recommendedPanel = usedPanelRef ?? getRecommendedPanelReferenceSync();
        const recommendedInverter = usedInverterRef ?? getRecommendedInverterReferenceSync();
        const panelCount = effectiveConfig.effectivePanelCount;
        const totalPowerKW = effectiveConfig.effectiveKwp;
        const annualProductionKWh = effectiveConfig.effectiveAnnualProductionKwh;
        if (totalPowerKW > 0) {
          pipelineOptions.estimatedKwp = totalPowerKW;
          const inverterCount = calculateInverterCount(totalPowerKW, recommendedInverter);
          const equipmentEur = estimateInstallationPriceEur(
            panelCount,
            inverterCount,
            recommendedPanel,
            recommendedInverter
          );
          const priceRange = estimateTotalPriceRangeEur(totalPowerKW, equipmentEur);
          pipelineOptions.priceRangeMinEur = priceRange.totalMinEur;
          pipelineOptions.priceRangeMaxEur = priceRange.totalMaxEur;
          if (annualProductionKWh > 0) {
            const totalConsumptionKwh = totalArea > 0 ? getEnergyConsumption(prospect.placeType || "other") * totalArea : 0;
            const annualSavings = estimateAnnualSavingsEur(annualProductionKWh, undefined, totalConsumptionKwh);
            pipelineOptions.breakEvenMinYears = getBreakEvenYears(
              priceRange.totalMinEur,
              annualSavings
            );
            pipelineOptions.breakEvenMaxYears = getBreakEvenYears(
              priceRange.totalMaxEur,
              annualSavings
            );
          }
        }
      }

      const updatedProspect: Prospect = {
        ...prospect,
        address: address || prospect.address,
        configurationMode,
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

  const handleGenerateLink = async () => {
    if (!prospect?.id) return;
    setIsGeneratingLink(true);
    try {
      const shareToken = prospect.shareToken ?? crypto.randomUUID();
      let commercialReferent: CommercialReferent;
      if (user) {
        const userProfile = await getUserProfile(user.uid);
        commercialReferent = buildCommercialReferentFromUser(user, userProfile);
      } else {
        commercialReferent = getCommercialReferent();
      }
      await updateProspect(prospect.id, {
        shareToken,
        commercialReferent,
      });
      if (onProspectUpdate) {
        onProspectUpdate({ ...prospect, shareToken, commercialReferent });
      }
      const url = `${typeof window !== "undefined" ? window.location.origin : ""}/p/${shareToken}`;
      await navigator.clipboard.writeText(url);
      toast.success("Lien copié", {
        description: "Le lien prospect a été copié dans le presse-papiers.",
      });
    } catch (error) {
      toast.error("Erreur lors de la génération du lien", {
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
    const consoAnnuelleKwh = getEnergyConsumption(placeType) * surfaceM2;
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
      return { perfectFit: { panelCount: 0, inverterCount: 0 }, highestProduction: { panelCount: 0, inverterCount: 0 } };
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
    const consoAnnuelleKwh = getEnergyConsumption(placeType) * surfaceM2;
    const targetKwp = productible > 0
      ? (consoAnnuelleKwh * PERFECT_FIT_SELF_CONSUMPTION_TARGET) / productible
      : 0;
    const cappedKwp = Math.min(targetKwp, fullKwp);
    const perfectFitPanelCount = panelCountFromKwp(cappedKwp);
    const perfectFitInverterCount = calculateInverterCount(cappedKwp, inverterRef);

    const config = {
      perfectFit: { panelCount: perfectFitPanelCount, inverterCount: perfectFitInverterCount },
      highestProduction: { panelCount: highestPanelCount, inverterCount: highestInverterCount },
    };
    if (process.env.NODE_ENV === "development") {
      console.log("[Production]", {
        highest_production: { panneaux: config.highestProduction.panelCount, onduleurs: config.highestProduction.inverterCount },
        perfect_fit: { panneaux: config.perfectFit.panelCount, onduleurs: config.perfectFit.inverterCount },
      });
    }
    return config;
  }, [prospect, usedPanelRef, usedInverterRef]);

  /** Nombre max d'onduleurs recommandé ; au-delà, le modèle n'est pas adapté */
  const MAX_INVERTER_COUNT = 8;
  const effectiveInverterCount = configurationMode === "perfect_fit"
    ? choiceCardsConfig.perfectFit.inverterCount
    : choiceCardsConfig.highestProduction.inverterCount;
  const inverterCountExceedsLimit = effectiveInverterCount > MAX_INVERTER_COUNT;

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
              {/* Score + Image satellite sur la même ligne */}
              <div className="flex gap-2">
                {/* Score de qualité - radial */}
                <div className="bg-gray-100 rounded-xl flex-1 min-w-0 flex flex-col items-center justify-center overflow-hidden py-1">
                  <span className="text-[10px] uppercase tracking-wide text-gray-500 self-start pl-3">Score</span>
                  <ChartContainer
                    config={{
                      score: { label: "Score", color: "hsl(var(--chart-2))" },
                    } satisfies ChartConfig}
                    className="aspect-square max-h-[140px] min-h-0! w-full max-w-[140px] h-[140px]"
                  >
                    <RadialBarChart
                      data={[{ score: prospect.qualityScore }]}
                      startAngle={90}
                      endAngle={90 - 360}
                      innerRadius={40}
                      outerRadius={48}
                    >
                      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                      <PolarGrid
                        gridType="circle"
                        radialLines={false}
                        stroke="none"
                        className="first:fill-muted last:fill-gray-100"
                        polarRadius={[41, 49]}
                      />
                      <RadialBar dataKey="score" background fill="var(--chart-2)" />
                      <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
                        <Label
                          content={({ viewBox }) => {
                            if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                              return (
                                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="central" className="fill-foreground text-xl font-bold">
                                  {prospect.qualityScore}
                                </text>
                              );
                            }
                          }}
                        />
                      </PolarRadiusAxis>
                    </RadialBarChart>
                  </ChartContainer>
                </div>

                {/* Image satellite */}
                {prospect.coordinates && (() => {
                  const imageCenter = getProspectImageCenter(prospect);
                  return (
                <div className="flex-1 min-w-0 overflow-hidden rounded-xl min-h-[140px] flex">
                  <SatelliteImage
                    key={`sat-${imageCenter.lat.toFixed(4)}-${imageCenter.lng.toFixed(4)}`}
                    coordinates={imageCenter}
                    address={prospect.address}
                    zoom={17}
                    width={220}
                    height={140}
                    className="rounded-xl border-0 w-full h-full flex-1"
                    showOverlays={false}
                  />
                </div>
                  );
                })()}
              </div>

              <Tabs value={drawerTab} onValueChange={(v) => setDrawerTab(v as "prospect" | "projet")} className="w-full">
                <TabsList className="grid w-full grid-cols-2 gap-1 rounded-xl p-1.5 my-2 bg-black h-auto!">
                  <TabsTrigger value="prospect" className="rounded-lg px-4 py-2 bg-transparent text-white/70 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=inactive]:hover:text-white data-[state=inactive]:hover:bg-white/10">Prospect</TabsTrigger>
                  <TabsTrigger value="projet" className="rounded-lg px-4 py-2 bg-transparent text-white/70 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=inactive]:hover:text-white data-[state=inactive]:hover:bg-white/10">Projet</TabsTrigger>
                </TabsList>

                <TabsContent value="prospect" className="mt-0 space-y-2">
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
                      <p className="text-xl font-medium truncate" title={prospect.name}>
                        {prospect.name}
                      </p>
                    )}
                    {prospect.address && (
                      <p className="text-xs text-white/80 truncate" title={prospect.address}>
                        {prospect.address}
                      </p>
                    )}
                    </div>

                    {/* Type + Surface + Orientation */}
                    <div className="rounded-lg px-3 py-2 bg-white/10 flex gap-4">
                      <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-white/60">Type</span>
                        <PlaceTypeSelect
                          variant="dark"
                          value={prospect.placeType}
                          onValueChange={(value) => {
                            if (onProspectUpdate) {
                              onProspectUpdate({ ...prospect, placeType: value });
                            }
                          }}
                          disabled={!onProspectUpdate}
                        />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-white/60">Surface</span>
                        <div className="px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors text-[10px] uppercase text-white/60 min-w-fit">
                          {(prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0).toFixed(0)} m²
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-white/60" title="Écart au Sud (0° = face sud)">Orientation</span>
                        <div className="px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors text-[10px] uppercase text-white/60 min-w-fit">
                          {(() => {
                            const surfaces = prospect.roofSurfaces ?? (prospect.roofSurface ? [prospect.roofSurface] : []);
                            const firstOrientation = surfaces[0]?.orientation;
                            return firstOrientation != null ? `${Math.abs(firstOrientation).toFixed(1)}°` : "—";
                          })()}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-white/60" title="Année de construction (BDNB)">Année</span>
                        <div className="px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors text-[10px] uppercase text-white/60 min-w-fit">
                          {prospect.anneeConstruction != null ? String(prospect.anneeConstruction) : "—"}
                        </div>
                      </div>
                    </div>

                    {/* Entreprise (api.gouv) */}
                    <div>
                      {companyEnrichmentLoading ? (
                        <div className="flex items-center gap-2 text-xs text-white/70">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Recherche entreprise…</span>
                        </div>
                      ) : prospect.siren || prospect.companyLegalName || prospect.companyManagerName || prospect.contact?.nationalPhoneNumber || prospect.contact?.internationalPhoneNumber ? (
                        <div className="space-y-3 text-xs pt-3">
                          {prospect.siren && (
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="flex shrink-0 items-center gap-1.5 text-white/70 w-[115px]">
                                <Hash className="h-3.5 w-3.5 opacity-70" />
                                <span>SIREN</span>
                              </div>
                              <span className="font-mono text-white truncate min-w-0 flex-1 text-left pl-1" title={prospect.siren}>{prospect.siren}</span>
                            </div>
                          )}
                          {prospect.siret && (
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="flex shrink-0 items-center gap-1.5 text-white/70 w-[115px]">
                                <Hash className="h-3.5 w-3.5 opacity-70" />
                                <span>SIRET</span>
                              </div>
                              <span className="font-mono text-white truncate min-w-0 flex-1 text-left pl-1" title={prospect.siret}>{prospect.siret}</span>
                            </div>
                          )}
                          {prospect.companyLegalName && (
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="flex shrink-0 items-center gap-1.5 text-white/70 w-[115px]">
                                <Building2 className="h-3.5 w-3.5 opacity-70" />
                                <span>Dénomination</span>
                              </div>
                              <span className="text-white truncate min-w-0 flex-1 text-left pl-1" title={prospect.companyLegalName}>{prospect.companyLegalName}</span>
                            </div>
                          )}
                          {prospect.companyAddress && (
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="flex shrink-0 items-center gap-1.5 text-white/70 w-[115px]">
                                <MapPin className="h-3.5 w-3.5 opacity-70" />
                                <span>Adresse siège</span>
                              </div>
                              <span className="text-white truncate min-w-0 flex-1 text-left pl-1" title={prospect.companyAddress}>{prospect.companyAddress}</span>
                            </div>
                          )}
                          {prospect.companyNaf && (
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="flex shrink-0 items-center gap-1.5 text-white/70 w-[115px]">
                                <Tag className="h-3.5 w-3.5 opacity-70" />
                                <span>Code NAF</span>
                              </div>
                              <span className="font-mono text-white truncate min-w-0 flex-1 text-left pl-1" title={prospect.companyNaf}>{prospect.companyNaf}</span>
                            </div>
                          )}
                          {prospect.companyManagerName && (
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="flex shrink-0 items-center gap-1.5 text-white/70 w-[115px]">
                                <User className="h-3.5 w-3.5 opacity-70" />
                                <span>Gérant</span>
                              </div>
                              <span className="text-white truncate min-w-0 flex-1 text-left pl-1" title={prospect.companyManagerName}>{prospect.companyManagerName}</span>
                            </div>
                          )}
                          {(prospect.contact?.nationalPhoneNumber || prospect.contact?.internationalPhoneNumber) && (
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="flex shrink-0 items-center gap-1.5 text-white/70 w-[115px]">
                                <Phone className="h-3.5 w-3.5 opacity-70" />
                                <span>Téléphone</span>
                              </div>
                              <a href={`tel:${(prospect.contact?.internationalPhoneNumber || prospect.contact?.nationalPhoneNumber || "").replace(/\s/g, "")}`} className="text-white truncate min-w-0 flex-1 text-left pl-1 hover:underline" title={prospect.contact?.nationalPhoneNumber || prospect.contact?.internationalPhoneNumber}>{prospect.contact?.nationalPhoneNumber || prospect.contact?.internationalPhoneNumber}</a>
                            </div>
                          )}
                          {prospect.anneeConstruction != null && (
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="flex shrink-0 items-center gap-1.5 text-white/70 w-[115px]">
                                <Calendar className="h-3.5 w-3.5 opacity-70" />
                                <span>Année construction</span>
                              </div>
                              <span className="text-white truncate min-w-0 flex-1 text-left pl-1">{prospect.anneeConstruction}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-white/60">Aucune entreprise trouvée</p>
                      )}
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
                                                ...prospect,
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
                        <p className="text-xl font-medium text-white" title={prospect.name}>{prospect.name}</p>
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
                    {(prospect.siren || prospect.companyLegalName || prospect.companyManagerName || prospect.companyAddress || prospect.companyNaf || prospect.contact?.nationalPhoneNumber || prospect.contact?.internationalPhoneNumber) && (
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
                      const usableArea = getUsableRoofAreaM2(surface.area);
                      const panelCount = calculatePanelCount(usableArea, undefined, usedPanelRef ?? getRecommendedPanelReferenceSync());
                      return (
                        <div
                          key={surfaceId}
                          className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-stretch gap-3"
                        >
                          <div className="shrink-0 flex items-center">
                            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <div className="font-semibold text-xs text-foreground">
                              Surface {index + 1}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                {surface.area.toFixed(2)} m²
                              </span>
                              <span className="text-muted-foreground/40 text-xs">|</span>
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600">
                                {surfaceKwp.toFixed(2)} kWp
                              </span>
                              <span className="text-muted-foreground/40 text-xs">|</span>
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                {panelCount} panneaux
                              </span>
                              <span className="text-muted-foreground/40 text-xs">|</span>
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={surface.orientation != null ? "Écart au Sud (0° = face sud)" : "Orientation non calculée"}>
                                {surface.orientation != null ? `${Math.abs(surface.orientation).toFixed(1)}°` : "—"}
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
                                      ...prospect,
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
                </TabsContent>

                <TabsContent value="projet" className="mt-0 space-y-2">
              {/* Choice cards : Perfect fit / Highest production — au-dessus de Production */}
              {(prospect.solarPotential?.productionPerKwpMonthly?.length || prospect.solarPotential?.monthlyProduction?.length) &&
               !isLoadingPVGIS &&
               ((prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0) > 0) && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setConfigurationMode("perfect_fit")}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      configurationMode === "perfect_fit"
                        ? "border-blue-500 bg-blue-50/80 shadow-xs"
                        : "border-border bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div className="text-sm font-semibold text-foreground">Perfect fit</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Badge
                        variant="secondary"
                        className={`text-xs font-medium ${configurationMode === "perfect_fit" ? "bg-blue-100 text-blue-800 border-blue-200" : "bg-gray-100 text-gray-700 border-gray-200"}`}
                      >
                        {choiceCardsConfig.perfectFit.panelCount} panneaux
                      </Badge>
                      <Badge
                        variant="secondary"
                        className={`text-xs font-medium ${configurationMode === "perfect_fit" ? "bg-blue-100 text-blue-800 border-blue-200" : "bg-gray-100 text-gray-700 border-gray-200"}`}
                      >
                        {choiceCardsConfig.perfectFit.inverterCount} onduleur{choiceCardsConfig.perfectFit.inverterCount > 1 ? "s" : ""}
                      </Badge>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfigurationMode("highest_production")}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      configurationMode === "highest_production"
                        ? "border-blue-500 bg-blue-50/80 shadow-xs"
                        : "border-border bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div className="text-sm font-semibold text-foreground">Highest production</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Badge
                        variant="secondary"
                        className={`text-xs font-medium ${configurationMode === "highest_production" ? "bg-blue-100 text-blue-800 border-blue-200" : "bg-gray-100 text-gray-700 border-gray-200"}`}
                      >
                        {choiceCardsConfig.highestProduction.panelCount} panneaux
                      </Badge>
                      <Badge
                        variant="secondary"
                        className={`text-xs font-medium ${configurationMode === "highest_production" ? "bg-blue-100 text-blue-800 border-blue-200" : "bg-gray-100 text-gray-700 border-gray-200"}`}
                      >
                        {choiceCardsConfig.highestProduction.inverterCount} onduleur{choiceCardsConfig.highestProduction.inverterCount > 1 ? "s" : ""}
                      </Badge>
                    </div>
                  </button>
                </div>
              )}

              {/* Production mensuelle : affiché uniquement si surface définie (kWp + consommation) */}
              {(prospect.solarPotential?.productionPerKwpMonthly?.length || prospect.solarPotential?.monthlyProduction?.length) &&
               !isLoadingPVGIS &&
               ((prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0) > 0) && (
                <>
                  <div className="bg-gray-100 rounded-xl py-3 px-4 pb-2">
                    <div className="flex items-start justify-between gap-2 mb-3">
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
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                  {fmt(dailyProductionKwh)} /j
                                </span>
                                <span className="text-xs text-gray-600 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" />
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
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                {productionGwh >= 0.001 ? productionGwh.toFixed(3) : productionGwh.toFixed(6)} GWh
                              </span>
                              <span className="text-xs text-gray-600 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" />
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
                    <div>
                      <MonthlyProductionChart
                        key={configurationMode}
                        viewMode={chartViewMode}
                        onViewModeChange={setChartViewMode}
                        data={(() => {
                          const surfaceM2 = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0;
                          const placeType = prospect.placeType || "other";
                          if (!effectiveConfig.productionPerKwp) return [];
                          const { monthlyProduction } = getProductionFromPerKwp(
                            effectiveConfig.productionPerKwp.productionPerKwpAnnual,
                            effectiveConfig.productionPerKwp.productionPerKwpMonthly,
                            effectiveConfig.effectiveKwp
                          );
                          return monthlyProduction.map((m) => ({
                            month: m.month,
                            production: m.production,
                            consumption: Math.round(getEnergyConsumptionForMonth(placeType, (m.month - 1) as MonthIndex) * surfaceM2),
                          }));
                        })()}
                        dailyData={(() => {
                          const surfaceM2 = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0;
                          if (surfaceM2 <= 0 || !effectiveConfig.productionPerKwp) return undefined;
                          const placeType = prospect.placeType || "other";
                          const { dailyTypical } = getProductionFromPerKwp(
                            effectiveConfig.productionPerKwp.productionPerKwpAnnual,
                            effectiveConfig.productionPerKwp.productionPerKwpMonthly,
                            effectiveConfig.effectiveKwp
                          );
                          const hourlyConsumptionPerM2 = getHourlyConsumptionProfileKwhPerM2(placeType);
                          return Array.from({ length: 24 }, (_, hour) => ({
                            hour,
                            production: dailyTypical[hour] ?? 0,
                            consumption: Math.round((hourlyConsumptionPerM2[hour] ?? 0) * surfaceM2),
                          }));
                        })()}
                      />
                    </div>
                  </div>
                  {/* Energy Bill + Savings + Estimated price (sous Production) */}
                  {(() => {
                    const totalArea = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0;
                    if (totalArea <= 0) return null;
                    const placeType = prospect.placeType || "other";
                    const surfaceM2 = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0;
                    const totalConsumptionKwh = surfaceM2 > 0 ? getEnergyConsumption(placeType) * surfaceM2 : 0;
                    const energyBillEur = estimateEnergyBillEur(totalConsumptionKwh);
                    const annualProductionKWh = effectiveConfig.effectiveAnnualProductionKwh;
                    const annualSavings = estimateAnnualSavingsEur(annualProductionKWh, undefined, totalConsumptionKwh);
                    const recommendedPanel = usedPanelRef ?? getRecommendedPanelReferenceSync();
                    const recommendedInverter = usedInverterRef ?? getRecommendedInverterReferenceSync();
                    const panelCount = effectiveConfig.effectivePanelCount;
                    const totalPowerKW = effectiveConfig.effectiveKwp;
                    const inverterCount = calculateInverterCount(totalPowerKW, recommendedInverter);
                    const equipmentEur = estimateInstallationPriceEur(panelCount, inverterCount, recommendedPanel, recommendedInverter);
                    const priceRange = estimateTotalPriceRangeEur(totalPowerKW, equipmentEur);
                    const breakEvenMin = getBreakEvenYears(priceRange.totalMinEur, annualSavings);
                    const breakEvenMax = getBreakEvenYears(priceRange.totalMaxEur, annualSavings);
                    const breakEvenLabel =
                      breakEvenMin != null && breakEvenMax != null
                        ? breakEvenMin === breakEvenMax
                          ? `${breakEvenMin} an${breakEvenMin > 1 ? "s" : ""}`
                          : `${breakEvenMin} – ${breakEvenMax} ans`
                        : "—";
                    return (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-xl px-4 py-4 min-h-[130px] flex flex-col justify-between bg-gray-100">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] uppercase tracking-wide text-gray-500">Energy Bill</span>
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" title="Facture énergétique annuelle estimée (consommation × prix du kWh). Le prix du kWh est personnalisable dans les paramètres." />
                            </div>
                            <div className="text-2xl font-normal text-gray-700">
                              {energyBillEur.toLocaleString("fr-FR")}
                              <span className="text-sm font-light text-gray-400 ml-0.5">€</span>
                            </div>
                          </div>
                          <div className="bg-gray-100 rounded-xl px-4 py-4 min-h-[130px] flex flex-col justify-between">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] uppercase tracking-wide text-gray-500">Savings</span>
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="Économies annuelles estimées (production × prix du kWh)." />
                            </div>
                            <div className="text-2xl font-normal text-gray-700">
                              {annualSavings.toLocaleString("fr-FR")}
                              <span className="text-sm font-light text-gray-400 ml-0.5">€</span>
                            </div>
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
                  {/* Équipement (Panneau + Onduleur) */}
                  {(usedPanelRef || usedInverterRef) && (
                  <div className="bg-gray-100 rounded-xl py-3 px-4">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-3">Équipement</div>
                    <div className="space-y-2">
                        {usedPanelRef && (
                          <div>
                            <div className="flex justify-end items-center gap-1.5 mb-1">
                              <span className="inline-flex items-center rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                              <span className="inline-flex items-center rounded-md bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">{effectiveConfig.effectivePanelCount}</span>
                            </div>
                            <div className="rounded-xl border border-border bg-white p-3 flex items-stretch gap-3">
                            <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gray-100">
                              {usedPanelRef.imageUrl ? (
                                <Image
                                  src={usedPanelRef.imageUrl}
                                  alt={usedPanelRef.name}
                                  width={48}
                                  height={48}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">—</div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                              <div className="font-semibold text-xs text-foreground truncate">{usedPanelRef.name}</div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">€{usedPanelRef.costEur}</span>
                                <span className="text-muted-foreground/40 text-xs">|</span>
                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  <Zap className="h-3 w-3 text-muted-foreground/80" />
                                  {usedPanelRef.powerW}W
                                </span>
                                {usedPanelRef.warrantyYears != null && (
                                  <>
                                    <span className="text-muted-foreground/40 text-xs">|</span>
                                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                      <FileCheck className="h-3 w-3 text-muted-foreground/80" />
                                      {usedPanelRef.warrantyYears}y
                                    </span>
                                  </>
                                )}
                                {usedPanelRef.countryCode && (
                                  <>
                                    <span className="text-muted-foreground/40 text-xs">|</span>
                                    <span className="inline-flex items-center shrink-0" title={usedPanelRef.countryOfOrigin}>
                                      <img
                                        src={getCountryFlagUrl(usedPanelRef.countryCode)}
                                        alt=""
                                        className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50"
                                        width={12}
                                        height={12}
                                      />
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                            </div>
                          </div>
                        )}
                        {usedInverterRef && (
                          <div>
                            <div className="flex justify-end items-center gap-1.5 mb-1">
                              {inverterCountExceedsLimit ? (
                                <span className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" title="Plus de 8 onduleurs : choisir un modèle plus puissant">
                                  Changer de modèle
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                              )}
                              <span className="inline-flex items-center rounded-md bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">{effectiveInverterCount}</span>
                            </div>
                            <div className="rounded-xl border border-border bg-white p-3 flex items-stretch gap-3">
                              <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gray-100">
                                {usedInverterRef.imageUrl ? (
                                  <Image
                                    src={usedInverterRef.imageUrl}
                                    alt={usedInverterRef.name}
                                    width={48}
                                    height={48}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">—</div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0 flex flex-col justify-center">
                                <div className="font-semibold text-xs text-foreground truncate">{usedInverterRef.name}</div>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">€{usedInverterRef.costEur}</span>
                                  <span className="text-muted-foreground/40 text-xs">|</span>
                                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                    <Zap className="h-3 w-3 text-muted-foreground/80" />
                                    {usedInverterRef.powerW}W
                                  </span>
                                  {usedInverterRef.warrantyYears != null && (
                                    <>
                                      <span className="text-muted-foreground/40 text-xs">|</span>
                                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                        <FileCheck className="h-3 w-3 text-muted-foreground/80" />
                                        {usedInverterRef.warrantyYears}y
                                      </span>
                                    </>
                                  )}
                                  {usedInverterRef.countryCode && (
                                    <>
                                      <span className="text-muted-foreground/40 text-xs">|</span>
                                      <span className="inline-flex items-center shrink-0" title={usedInverterRef.countryOfOrigin}>
                                        <img
                                          src={getCountryFlagUrl(usedInverterRef.countryCode)}
                                          alt=""
                                          className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50"
                                          width={12}
                                          height={12}
                                        />
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                  )}
                </>
              )}
                </TabsContent>
              </Tabs>

              {/* Données financières (en dernier) */}
              {(() => {
                const totalArea = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0;
                if (totalArea <= 0) return null;
                const recommendedPanel = usedPanelRef ?? getRecommendedPanelReferenceSync();
                const recommendedInverter = usedInverterRef ?? getRecommendedInverterReferenceSync();
                const panelCount = effectiveConfig.effectivePanelCount;
                const totalPowerKW = effectiveConfig.effectiveKwp;
                const inverterCount = calculateInverterCount(totalPowerKW, recommendedInverter);
                const annualProductionKWh = effectiveConfig.effectiveAnnualProductionKwh;
                const totalConsumptionKwh = getEnergyConsumption(prospect.placeType || "other") * totalArea;
                const equipmentEur = estimateInstallationPriceEur(panelCount, inverterCount, recommendedPanel, recommendedInverter);
                const priceRange = estimateTotalPriceRangeEur(totalPowerKW, equipmentEur);
                const annualSavings = estimateAnnualSavingsEur(annualProductionKWh, undefined, totalConsumptionKwh);
                const breakEvenMin = getBreakEvenYears(priceRange.totalMinEur, annualSavings);
                const breakEvenMax = getBreakEvenYears(priceRange.totalMaxEur, annualSavings);
                const breakEvenLabel =
                  breakEvenMin != null && breakEvenMax != null
                    ? breakEvenMin === breakEvenMax
                      ? `${breakEvenMin} an${breakEvenMin > 1 ? "s" : ""}`
                      : `${breakEvenMin} – ${breakEvenMax} ans`
                    : "—";
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
                  variant="secondary"
                  size="icon"
                  className="h-12 w-12 shrink-0"
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
                variant="secondary"
                size="icon"
                className="h-12 w-12 shrink-0"
                onClick={handleGenerateLink}
                disabled={isGeneratingLink}
                title={isGeneratingLink ? "Génération..." : "Générer le lien prospect et copier dans le presse-papiers"}
                aria-label={isGeneratingLink ? "Génération..." : "Lien prospect"}
              >
                {isGeneratingLink ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
              </Button>
              {prospect.shareToken && (
                <Link href={`/p/${prospect.shareToken}`} target="_blank" rel="noopener noreferrer">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-12 w-12 shrink-0"
                    title="Voir la page partagée"
                    aria-label="Voir la page partagée"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </Link>
              )}
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
                  className="h-12 w-12 shrink-0 border-0 bg-blue-500 hover:bg-blue-600 text-white"
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
