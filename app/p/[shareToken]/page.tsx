"use client";

import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { shouldClearBillMonthToBaseline } from "@/lib/prospect-share-bill-input";
import { BRAND_INK, BRAND_LIME, BRAND_LINE } from "@/lib/brand-colors";
import {
  RadianzLimeDotOverlay,
  radianzCardBorderStyle,
  radianzDefaultCardClass,
  radianzLimeCardRootClass,
  radianzLimeCardStyle,
  radianzMonoLabelClass,
} from "@/lib/radianz-card-primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { User, Phone, Mail, Building2, Loader2, ArrowLeft, Link2, Battery, Zap, FileCheck, ArrowUpRight, Info, Calendar } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  usePanelReferences,
  useInverterReferences,
  useBatteryReferences,
  useProspectByShareToken,
} from "@/lib/swr-hooks";
import { getProspectImageCenter } from "@/lib/geometry";
import { SatelliteImage } from "@/components/solar-scout/SatelliteImage";
import { getCountryFlagUrl } from "@/lib/solar-settings";
import {
  getEnergyConsumption,
  getEnergyConsumptionForMonth,
  getHourlyConsumptionProfileKwhPerM2,
  monthlyConsumptionKwhFromAnnualProfile,
  type MonthIndex,
} from "@/lib/building-energy-consumption";
import {
  getProductionFromPerKwp,
  getProductionPerKwpFromSolarPotential,
  buildTypicalDayForMonth,
} from "@/lib/pvgis";
import { buildTypicalConsumptionDayForMonth } from "@/lib/building-energy-consumption";
import { runProductionSimulation, runSimulationOneDayForChart, scaleBatteryForCount } from "@/lib/battery-simulation";
import {
  surfaceToKwp,
  getUsableRoofAreaM2,
} from "@/lib/surface-to-kwp";
import {
  avoidedCo2TonnesPerYearGridFr,
  co2AvoidanceHasDataForDisplay,
} from "@/lib/co2-avoidance-fr";
import {
  getRecommendedPanelReferenceSync,
  getRecommendedInverterReferenceSync,
  getRecommendedBatteryReferenceSync,
  getSolarEquipmentSettings,
  calculatePanelCount,
  calculateInverterCount,
  estimateInstallationPriceEur,
  estimateTotalPriceRangeEur,
  estimateAnnualSavingsEurWithBattery,
  DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH,
  estimateAnnualSavingsEurWithBreakdown,
  estimateEnergyBillEur,
  getBreakEvenYears,
  DEFAULT_ANNUAL_ELECTRICITY_PRICE_ESCALATION,
  effectiveRetailPriceEurPerKwhFromBill,
  projectedAnnualGridBillEur,
} from "@/lib/solar-settings";
import { computeRecommendedBatteryTargetKwh } from "@/lib/recommended-battery-sizing";
import { ProspectEnergyChartsPanel } from "@/components/solar-scout/ProspectEnergyChartsPanel";
import { MonthlyConsumptionOnlyChart } from "@/components/solar-scout/MonthlyConsumptionOnlyChart";
import { EquipmentSelectCard, EquipmentThumbnail } from "@/components/solar-scout/EquipmentSelectCard";
import { BatterySelectCard } from "@/components/solar-scout/BatterySelectCard";
import type {
  Prospect,
  PanelReference,
  InverterReference,
  BatteryReference,
  ProspectConfigurationMode,
} from "@/types";
import { toast } from "sonner";
import {
  registerProspectSharePageView,
  startProspectShareSession,
} from "@/lib/prospect-share-client";
import { RoiComboChart, getRoiCumulativeNetEurAfterHorizon } from "@/components/solar-scout/RoiChart";
import { ElectricityTariffEscalationChart } from "@/components/solar-scout/ElectricityTariffEscalationChart";
import { RadianzBillReductionCard } from "@/components/solar-scout/RadianzBillReductionCard";
import { RadianzCo2AvoidanceRadial } from "@/components/solar-scout/RadianzCo2AvoidanceRadial";

type FinancingMode = "capex" | "lease" | "ppa";

const BILL_MONTH_LABELS_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
] as const;

/** Abrégés 3 lettres (alignés graphique consommation). */
const BILL_MONTH_ABBREV_FR = [
  "JAN",
  "FÉV",
  "MAR",
  "AVR",
  "MAI",
  "JUN",
  "JUL",
  "AOÛ",
  "SEP",
  "OCT",
  "NOV",
  "DÉC",
] as const;

function normalizeBillInputRaw(raw: string) {
  return raw.trim().replace(/\s/g, "").replace(",", ".");
}

const KWH_PER_MWH = 1000;

/** Affichage saisie / placeholder en MWh (données internes toujours en kWh). */
function formatKwhAsMwhForBillInput(kwh: number) {
  const mwh = (Number.isFinite(kwh) ? kwh : 0) / KWH_PER_MWH;
  return mwh.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatKwhAsEurForBillInput(kwh: number, retailPriceEurPerKwh: number) {
  const eur = Math.max(0, kwh) * Math.max(0, retailPriceEurPerKwh);
  return Math.round(eur).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function areMonthlyValuesEqual(a: number[] | null | undefined, b: number[] | null | undefined) {
  if (!a || !b) return false;
  if (a.length !== 12 || b.length !== 12) return false;
  for (let i = 0; i < 12; i++) {
    if (Math.round(a[i] ?? 0) !== Math.round(b[i] ?? 0)) return false;
  }
  return true;
}

/** Initiales pour l’avatar texte (design system Radianz, carte contact). */
function referentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const a = parts[0][0] ?? "";
  const b = parts[parts.length - 1][0] ?? "";
  return `${a}${b}`.toUpperCase();
}

function SharePortalInstallationCard({
  priceKMin,
  priceKMax,
  className,
}: {
  priceKMin: string;
  priceKMax: string;
  className?: string;
}) {
  return (
    <Card
      className={cn(radianzLimeCardRootClass, "shadow-none flex h-full min-h-0 flex-col", className)}
      style={radianzLimeCardStyle}
    >
      <RadianzLimeDotOverlay />
      <CardHeader className="relative shrink-0 space-y-1 pb-2 pt-5">
        <div className={cn(radianzMonoLabelClass, "flex justify-between gap-2")}>
          <span>Installation</span>
          <span className="font-normal opacity-70">TTC est.</span>
        </div>
      </CardHeader>
      <CardContent className="relative mt-auto pb-5 pt-0">
        <p className="font-sans text-3xl font-light tabular-nums tracking-tight sm:text-[2rem] sm:leading-none">
          {priceKMin}
          <span className="mx-1 font-light text-lg text-foreground/50">–</span>
          {priceKMax}
          <sup className="ml-0.5 align-top text-base font-normal">k€</sup>
        </p>
      </CardContent>
    </Card>
  );
}

export default function ProspectSharePage() {
  const params = useParams();
  const { user } = useAuth();
  const shareToken = (params?.shareToken as string) ?? null;
  useEffect(() => {
    if (!shareToken) return;
    void registerProspectSharePageView(shareToken);
    try {
      const storageKey = `radianzShareSession:${shareToken}`;
      let sessionId = sessionStorage.getItem(storageKey);
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        sessionStorage.setItem(storageKey, sessionId);
      }
      void startProspectShareSession(shareToken, sessionId);
    } catch {
      void startProspectShareSession(shareToken, crypto.randomUUID());
    }
  }, [shareToken]);
  const { data: prospectData } = useProspectByShareToken(shareToken);
  const prospect = prospectData ?? null;
  const ownerUserId = prospect?.userId ?? null;
  const [financingMode, setFinancingMode] = useState<FinancingMode>("capex");
  const { data: panelsData } = usePanelReferences(ownerUserId);
  const { data: invertersData } = useInverterReferences(ownerUserId);
  const { data: batteriesData } = useBatteryReferences(ownerUserId);
  const loading = prospectData === undefined && shareToken != null;
  /**
   * Lien partagé : toujours démarrer sur Perfect fit (ne pas lire prospect.configurationMode, souvent highest_production en base).
   * null = Perfect fit par défaut ; valeur = onglet choisi par le visiteur (pas de PATCH mode sur cette page).
   */
  const [configurationModeUserOverride, setConfigurationModeUserOverride] = useState<ProspectConfigurationMode | null>(null);
  useEffect(() => {
    setConfigurationModeUserOverride(null);
  }, [prospect?.id]);
  const configurationMode: ProspectConfigurationMode = configurationModeUserOverride ?? "perfect_fit";
  const [annualConsumptionOverride, setAnnualConsumptionOverride] = useState<number | undefined>(undefined);
  const [chartViewMode, setChartViewMode] = useState<"monthly" | "daily">("monthly");
  const [chartSelectedMonthIndex, setChartSelectedMonthIndex] = useState(6);
  const [includeBatteryLocal, setIncludeBatteryLocal] = useState<boolean>(true);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [selectedInverterId, setSelectedInverterId] = useState<string | null>(null);
  const [selectedBatteryId, setSelectedBatteryId] = useState<string | null>(null);
  const [selectedBatteryCount, setSelectedBatteryCount] = useState(1);
  const [energyBillEurOverride, setEnergyBillEurOverride] = useState<number | undefined>(undefined);
  const [energyBillDialogOpen, setEnergyBillDialogOpen] = useState(false);
  const [financeChartView, setFinanceChartView] = useState<"roi" | "tariff">("roi");

  const pendingBatteryResyncAfterModeChangeRef = useRef(false);
  /** Après application de recommendedBatteryComposition au chargement (même règle que changement d'onglet). */
  const initialBatteryAppliedForProspectRef = useRef<string | null>(null);

  const visiblePanels = useMemo(() => {
    const withVisible = panelsData?.filter((p) => p.visible === true) ?? [];
    if (withVisible.length > 0) return withVisible;
    // Fallback legacy : aucun panneau n'a visible=true (ex. données anciennes), utiliser recommandé ou premier
    if (panelsData && panelsData.length > 0) {
      const fallback = panelsData.find((p) => p.recommended === true) ?? panelsData[0];
      return fallback ? [fallback] : [];
    }
    return [];
  }, [panelsData]);
  const visibleInverters = useMemo(() => {
    const withVisible = invertersData?.filter((i) => i.visible === true) ?? [];
    if (withVisible.length > 0) return withVisible;
    if (invertersData && invertersData.length > 0) {
      const fallback = invertersData.find((i) => i.visible !== false) ?? invertersData.find((i) => i.recommended === true) ?? invertersData[0];
      return fallback ? [fallback] : [];
    }
    return [];
  }, [invertersData]);
  const visibleBatteries = useMemo(() => {
    const withVisible = batteriesData?.filter((b) => b.visible === true) ?? [];
    if (withVisible.length > 0) return withVisible;
    if (batteriesData && batteriesData.length > 0) {
      const fallback = batteriesData.find((b) => b.visible !== false) ?? batteriesData.find((b) => b.recommended === true) ?? batteriesData[0];
      return fallback ? [fallback] : [];
    }
    return [];
  }, [batteriesData]);

  const usedPanelRef: PanelReference | null =
    (selectedPanelId ? visiblePanels.find((r) => r.id === selectedPanelId) ?? null : null) ??
    visiblePanels.find((r) => r.recommended) ??
    visiblePanels[0] ??
    null;
  const usedInverterRef: InverterReference | null =
    (selectedInverterId ? visibleInverters.find((r) => r.id === selectedInverterId) ?? null : null) ??
    visibleInverters.find((r) => r.recommended) ??
    visibleInverters[0] ??
    null;
  const usedBatteryRef: BatteryReference | null =
    (selectedBatteryId ? visibleBatteries.find((r) => r.id === selectedBatteryId) ?? null : null) ??
    visibleBatteries.find((r) => r.recommended) ??
    visibleBatteries[0] ??
    null;
  const includeBatteryEffective = includeBatteryLocal;

  useEffect(() => {
    if (prospect?.annualConsumptionKwhOverride != null) setAnnualConsumptionOverride(prospect.annualConsumptionKwhOverride);
    if (prospect != null) setIncludeBatteryLocal(prospect.includeBatteryOverride ?? getSolarEquipmentSettings().includeBattery ?? true);
  }, [prospect?.annualConsumptionKwhOverride, prospect?.includeBatteryOverride, prospect]);

  const surfaceM2 =
    prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
  const placeType = prospect?.placeType || "other";
  const consoFromType = getEnergyConsumption(placeType) * surfaceM2;

  const baselineBillMonthlyKwh = useMemo(
    () => monthlyConsumptionKwhFromAnnualProfile(placeType, surfaceM2, annualConsumptionOverride ?? consoFromType),
    [placeType, surfaceM2, annualConsumptionOverride, consoFromType]
  );

  const [editedBillMonthlyKwh, setEditedBillMonthlyKwh] = useState<number[]>([]);
  const [billChartHighlightedMonth, setBillChartHighlightedMonth] = useState<number | null>(null);
  /** Après saisie validée au blur : chiffre en noir ; sinon reste gris (estimation). */
  const [billMonthUserEdited, setBillMonthUserEdited] = useState<boolean[]>(() =>
    Array.from({ length: 12 }, () => false)
  );
  const [billValueMode, setBillValueMode] = useState<"mwh" | "eur">("mwh");
  /** Saisie contrôlée : un seul mois focalisé à la fois (brouillon vs placeholder valeur de base). */
  const [billFocusedMonthIndex, setBillFocusedMonthIndex] = useState<number | null>(null);
  const [billFocusedDraft, setBillFocusedDraft] = useState("");
  const billInputsGridRef = useRef<HTMLDivElement>(null);
  const billMonthFocusValueRef = useRef<string[]>(Array.from({ length: 12 }, () => ""));
  const monthlySaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monthlySaveLastPayloadRef = useRef<string>("");

  useEffect(() => {
    if (!prospect || surfaceM2 <= 0) return;
    const monthlyOverride = prospect.monthlyConsumptionKwhOverride;
    if (monthlyOverride?.length === 12) {
      setEditedBillMonthlyKwh(
        monthlyOverride.map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0))
      );
      setBillMonthUserEdited(Array.from({ length: 12 }, () => true));
    } else {
      const next = monthlyConsumptionKwhFromAnnualProfile(
        placeType,
        surfaceM2,
        annualConsumptionOverride ?? consoFromType
      );
      setEditedBillMonthlyKwh([...next]);
      setBillMonthUserEdited(Array.from({ length: 12 }, () => false));
    }
    setBillFocusedMonthIndex(null);
    setBillFocusedDraft("");
  }, [prospect?.id, prospect?.monthlyConsumptionKwhOverride, surfaceM2, placeType, annualConsumptionOverride, consoFromType]);

  useEffect(() => {
    if (!shareToken || !prospect?.id || editedBillMonthlyKwh.length !== 12) return;
    const hasManualEdits = billMonthUserEdited.some(Boolean);
    const normalizedMonthly = hasManualEdits
      ? editedBillMonthlyKwh.map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0))
      : null;

    const initialMonthly = prospect.monthlyConsumptionKwhOverride?.length === 12
      ? prospect.monthlyConsumptionKwhOverride
      : null;

    if (
      (normalizedMonthly == null && initialMonthly == null) ||
      (normalizedMonthly != null && areMonthlyValuesEqual(normalizedMonthly, initialMonthly))
    ) {
      return;
    }

    const payload = JSON.stringify({ monthlyConsumptionKwhOverride: normalizedMonthly });
    if (payload === monthlySaveLastPayloadRef.current) return;
    monthlySaveLastPayloadRef.current = payload;

    if (monthlySaveTimeoutRef.current) {
      clearTimeout(monthlySaveTimeoutRef.current);
    }
    monthlySaveTimeoutRef.current = setTimeout(() => {
      fetch(`/api/prospect-view/${encodeURIComponent(shareToken)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: payload,
      })
        .then((response) => {
          if (!response.ok) {
            monthlySaveLastPayloadRef.current = "";
          }
        })
        .catch((error) => {
          monthlySaveLastPayloadRef.current = "";
          console.error("Erreur sauvegarde consommation mensuelle:", error);
        });
    }, 700);

    return () => {
      if (monthlySaveTimeoutRef.current) {
        clearTimeout(monthlySaveTimeoutRef.current);
        monthlySaveTimeoutRef.current = null;
      }
    };
  }, [
    shareToken,
    prospect?.id,
    prospect?.monthlyConsumptionKwhOverride,
    editedBillMonthlyKwh,
    billMonthUserEdited,
  ]);

  const liveAnnualConsumptionKwh = useMemo(() => {
    if (editedBillMonthlyKwh.length !== 12) return annualConsumptionOverride ?? consoFromType;
    const s = editedBillMonthlyKwh.reduce((a, b) => a + b, 0);
    return s > 0 ? s : annualConsumptionOverride ?? consoFromType;
  }, [editedBillMonthlyKwh, annualConsumptionOverride, consoFromType]);

  /** production = productionPerKwp × kWp. kWp = surfaceToKwp(surface). */
  const effectiveConfig = useMemo(() => {
    const panelRef = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const legacyKwp = (prospect?.solarPotential?.maxArrayAreaMeters2 ?? 0) > 0
      ? surfaceToKwp(prospect!.solarPotential!.maxArrayAreaMeters2!, undefined, undefined, panelRef)
      : undefined;
    const perKwp = getProductionPerKwpFromSolarPotential(prospect?.solarPotential, legacyKwp);
    const consoAnnuelleKwh = liveAnnualConsumptionKwh;

    if (!prospect || surfaceM2 <= 0 || !panelRef || !perKwp) {
      return { scaleFactor: 1, effectiveKwp: 0, effectivePanelCount: 0, effectiveAnnualProductionKwh: 0, kwpAtFetch: 0, productionPerKwp: null };
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
      return {
        scaleFactor: 1,
        effectiveKwp,
        effectivePanelCount: panelCountFromKwp(fullKwp),
        effectiveAnnualProductionKwh: Math.round(productible * fullKwp),
        kwpAtFetch: fullKwp,
        productionPerKwp: perKwp,
      };
    }

    const PERFECT_FIT_SELF_CONSUMPTION_TARGET = 0.7;
    const targetKwp = productible > 0
      ? (consoAnnuelleKwh * PERFECT_FIT_SELF_CONSUMPTION_TARGET) / productible
      : 0;
    const effectiveKwp = Math.min(targetKwp, fullKwp);
    return {
      scaleFactor: 1,
      effectiveKwp,
      effectivePanelCount: panelCountFromKwp(effectiveKwp),
      effectiveAnnualProductionKwh: Math.round(productible * effectiveKwp),
      kwpAtFetch: fullKwp,
      productionPerKwp: perKwp,
    };
  }, [prospect, configurationMode, liveAnnualConsumptionKwh, usedPanelRef, surfaceM2]);

  const recommendedBatteryKwh = useMemo(() => {
    if (!prospect || surfaceM2 <= 0) return null;
    const effectiveKwp = effectiveConfig.effectiveKwp;
    const hasProductionData = effectiveConfig.productionPerKwp != null;
    if (!hasProductionData || effectiveKwp <= 0) return null;
    const annualProductionKwh = effectiveConfig.effectiveAnnualProductionKwh;
    const monthly = effectiveConfig.productionPerKwp?.productionPerKwpMonthly;

    return computeRecommendedBatteryTargetKwh({
      productionPerKwpMonthly: monthly,
      effectiveKwp,
      annualProductionKwh,
      annualConsumptionKwh: liveAnnualConsumptionKwh,
      placeType,
      surfaceM2,
    });
  }, [prospect, surfaceM2, liveAnnualConsumptionKwh, effectiveConfig.effectiveAnnualProductionKwh, effectiveConfig.effectiveKwp, effectiveConfig.productionPerKwp, placeType]);

  const recommendedBatteryComposition = useMemo(() => {
    const visibleBatteries = (batteriesData ?? []).filter((b) => b.visible !== false);
    if (!visibleBatteries.length || recommendedBatteryKwh == null) return null;
    const sortedByCapacity = [...visibleBatteries].sort((a, b) => b.capacityKwh - a.capacityKwh);
    const largestModel = sortedByCapacity[0];
    if (!largestModel) return null;

    const target = recommendedBatteryKwh;

    if (target >= largestModel.capacityKwh) {
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
    pendingBatteryResyncAfterModeChangeRef.current = false;
    initialBatteryAppliedForProspectRef.current = null;
  }, [prospect?.id]);

  /** Tant que la cible kWh n'est pas calculable, conserver les champs batterie du prospect (PVGIS / catalogue en attente). */
  useEffect(() => {
    if (!prospect?.id) return;
    if (initialBatteryAppliedForProspectRef.current === prospect.id) return;
    if (recommendedBatteryComposition != null) return;
    if (prospect.batteryReferenceId) setSelectedBatteryId(prospect.batteryReferenceId);
    if (prospect.batteryCount != null && prospect.batteryCount >= 1) setSelectedBatteryCount(prospect.batteryCount);
  }, [prospect?.id, prospect?.batteryReferenceId, prospect?.batteryCount, recommendedBatteryComposition]);

  /** Premier chargement : aligner batterie sur recommendedBatteryComposition (identique au retour d'onglet). */
  useEffect(() => {
    if (!prospect?.id || recommendedBatteryComposition == null) return;
    if (pendingBatteryResyncAfterModeChangeRef.current) return;
    if (initialBatteryAppliedForProspectRef.current === prospect.id) return;
    const { model, count } = recommendedBatteryComposition;
    setSelectedBatteryId(model.id);
    setSelectedBatteryCount(count);
    initialBatteryAppliedForProspectRef.current = prospect.id;
  }, [prospect?.id, configurationMode, recommendedBatteryComposition]);

  /** Après clic sur Perfect fit / Highest production : aligner batterie sur la cible (y compris quand la composition arrive après PVGIS). */
  useEffect(() => {
    if (!prospect || !pendingBatteryResyncAfterModeChangeRef.current || recommendedBatteryComposition == null) {
      return;
    }
    const { model, count } = recommendedBatteryComposition;
    setSelectedBatteryId(model.id);
    setSelectedBatteryCount(count);
    pendingBatteryResyncAfterModeChangeRef.current = false;
  }, [prospect, configurationMode, recommendedBatteryComposition]);

  /** production = productionPerKwp × kWp. */
  const choiceCardsConfig = useMemo(() => {
    const panelRef = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const inverterRef = usedInverterRef ?? getRecommendedInverterReferenceSync();
    const consoAnnuelleKwh = liveAnnualConsumptionKwh;
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
    const targetKwp = productible > 0
      ? (consoAnnuelleKwh * PERFECT_FIT_SELF_CONSUMPTION_TARGET) / productible
      : 0;
    const cappedKwp = Math.min(targetKwp, fullKwp);
    const perfectFitPanelCount = panelCountFromKwp(cappedKwp);
    const perfectFitPowerKW = cappedKwp;
    const perfectFitInverterCount = calculateInverterCount(perfectFitPowerKW, inverterRef);

    return {
      perfectFit: { panelCount: perfectFitPanelCount, inverterCount: perfectFitInverterCount, kwp: cappedKwp },
      highestProduction: { panelCount: highestPanelCount, inverterCount: highestInverterCount, kwp: fullKwp },
    };
  }, [prospect, liveAnnualConsumptionKwh, usedPanelRef, usedInverterRef, surfaceM2, placeType]);

  const effectiveInverterCount = configurationMode === "perfect_fit"
    ? choiceCardsConfig.perfectFit.inverterCount
    : choiceCardsConfig.highestProduction.inverterCount;

  const consoAnnuelleKwh = liveAnnualConsumptionKwh;
  const energyBillEur = estimateEnergyBillEur(consoAnnuelleKwh);
  const displayEnergyBillEur = energyBillEurOverride ?? energyBillEur;

  const effectiveRetailPricePerKwh = useMemo(
    () => effectiveRetailPriceEurPerKwhFromBill(consoAnnuelleKwh, displayEnergyBillEur),
    [consoAnnuelleKwh, displayEnergyBillEur]
  );

  const financialSummary = useMemo(() => {
    if (!prospect || surfaceM2 <= 0) return null;
    const recommendedPanel = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const recommendedInverter = usedInverterRef ?? getRecommendedInverterReferenceSync();
    const panelCount = effectiveConfig.effectivePanelCount;
    const totalPowerKW = effectiveConfig.effectiveKwp;
    const inverterCount = calculateInverterCount(totalPowerKW, recommendedInverter);
    let equipmentEur: number;
    let annualSavings: number;
    let selfConsumptionDirectKwhTotal = 0;
    let selfConsumptionViaBatteryKwhTotal = 0;
    let injectionReseauKwhTotal = 0;
    let annualGridDrawKwh = 0;
    let batteryByMonth: { selfConsumptionDirectKwh: number; selfConsumptionViaBatteryKwh: number; injectionBatteryKwh: number; injectionReseauKwh: number; excessKwh: number; gridDrawKwh: number }[] | undefined;
    let breakdownFromHourlySim = false;
    const canUseProfiles = effectiveConfig.productionPerKwp?.productionPerKwpMonthly?.length === 12;
    const annualProductionKwh = effectiveConfig.effectiveAnnualProductionKwh;

    if (canUseProfiles && annualProductionKwh > 0 && consoAnnuelleKwh > 0) {
      breakdownFromHourlySim = true;
      const productionTypicalDayByMonth = Array.from({ length: 12 }, (_, m) =>
        buildTypicalDayForMonth(effectiveConfig.productionPerKwp!.productionPerKwpMonthly, m, totalPowerKW)
      );
      const consumptionTypicalDayByMonthRaw = Array.from({ length: 12 }, (_, m) =>
        buildTypicalConsumptionDayForMonth(placeType, m, surfaceM2)
      );
      const consumptionTypicalDayByMonth = consumptionTypicalDayByMonthRaw.map((day, m) => {
        const b = baselineBillMonthlyKwh[m] ?? 0;
        const e = editedBillMonthlyKwh.length === 12 ? (editedBillMonthlyKwh[m] ?? 0) : b;
        const factor = b > 0 ? e / b : 1;
        return day.map((h) => Math.round(h * factor * 1000) / 1000);
      });
      const scaledBattery = includeBatteryEffective && usedBatteryRef
        ? scaleBatteryForCount(usedBatteryRef, selectedBatteryCount)
        : null;
      const simulationResult = runProductionSimulation({
        productionTypicalDayByMonth,
        consumptionTypicalDayByMonth,
        battery: scaledBattery,
      });
      annualSavings = estimateAnnualSavingsEurWithBattery(
        simulationResult,
        effectiveRetailPricePerKwh,
        DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH
      );
      equipmentEur = estimateInstallationPriceEur(
        panelCount,
        inverterCount,
        recommendedPanel,
        recommendedInverter,
        includeBatteryEffective && usedBatteryRef ? usedBatteryRef : undefined,
        selectedBatteryCount
      );
      batteryByMonth = simulationResult.byMonth;
      selfConsumptionDirectKwhTotal = simulationResult.selfConsumptionDirectKwh;
      selfConsumptionViaBatteryKwhTotal = simulationResult.selfConsumptionViaBatteryKwh;
      injectionReseauKwhTotal = simulationResult.excessKwh;
      annualGridDrawKwh = simulationResult.gridDrawKwh;
    } else {
      const breakdown = estimateAnnualSavingsEurWithBreakdown(
        annualProductionKwh,
        consoAnnuelleKwh,
        effectiveRetailPricePerKwh,
        DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH
      );
      annualSavings = breakdown.annualSavingsEur;
      selfConsumptionDirectKwhTotal = breakdown.selfConsumptionKwh;
      selfConsumptionViaBatteryKwhTotal = 0;
      injectionReseauKwhTotal = breakdown.excessKwh;
      annualGridDrawKwh = Math.max(
        0,
        consoAnnuelleKwh - Math.min(annualProductionKwh, consoAnnuelleKwh)
      );
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
      selfConsumptionDirectKwhTotal,
      selfConsumptionViaBatteryKwhTotal,
      injectionReseauKwhTotal,
      annualGridDrawKwh,
      breakdownFromHourlySim,
    };
  }, [
    prospect,
    surfaceM2,
    placeType,
    consoAnnuelleKwh,
    configurationMode,
    effectiveConfig,
    usedPanelRef,
    usedInverterRef,
    usedBatteryRef,
    selectedBatteryCount,
    includeBatteryEffective,
    baselineBillMonthlyKwh,
    editedBillMonthlyKwh,
    effectiveRetailPricePerKwh,
  ]);

  const chartData = useMemo(() => {
    if (!effectiveConfig.productionPerKwp) return [];
    const { monthlyProduction } = getProductionFromPerKwp(
      effectiveConfig.productionPerKwp.productionPerKwpAnnual,
      effectiveConfig.productionPerKwp.productionPerKwpMonthly,
      effectiveConfig.effectiveKwp
    );
    const byMonth = financialSummary?.batteryByMonth;
    return monthlyProduction.map((m) => {
      const mi = m.month - 1;
      const consumption =
        editedBillMonthlyKwh.length === 12
          ? editedBillMonthlyKwh[mi] ?? 0
          : Math.round(getEnergyConsumptionForMonth(placeType, mi as MonthIndex) * surfaceM2);
      const base = {
        month: m.month,
        production: m.production,
        consumption,
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
  }, [
    effectiveConfig.productionPerKwp,
    effectiveConfig.effectiveKwp,
    financialSummary?.batteryByMonth,
    placeType,
    surfaceM2,
    editedBillMonthlyKwh,
  ]);

  const chartDailyData = useMemo(() => {
    if (!effectiveConfig.productionPerKwp) return undefined;
    const prodDay = buildTypicalDayForMonth(
      effectiveConfig.productionPerKwp.productionPerKwpMonthly,
      chartSelectedMonthIndex,
      effectiveConfig.effectiveKwp
    );
    const consDayRaw = buildTypicalConsumptionDayForMonth(placeType, chartSelectedMonthIndex, surfaceM2);
    const bm = baselineBillMonthlyKwh[chartSelectedMonthIndex] ?? 0;
    const em =
      editedBillMonthlyKwh.length === 12 ? (editedBillMonthlyKwh[chartSelectedMonthIndex] ?? 0) : bm;
    const dayFactor = bm > 0 ? em / bm : 1;
    const consDay = consDayRaw.map((h) => Math.round(h * dayFactor * 1000) / 1000);
    const batteryForChart = includeBatteryEffective && usedBatteryRef
      ? scaleBatteryForCount(usedBatteryRef, selectedBatteryCount)
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
    effectiveConfig.productionPerKwp,
    effectiveConfig.effectiveKwp,
    chartSelectedMonthIndex,
    placeType,
    surfaceM2,
    includeBatteryEffective,
    usedBatteryRef?.id,
    selectedBatteryCount,
    baselineBillMonthlyKwh,
    editedBillMonthlyKwh,
  ]);

  const annualSavings = financialSummary?.annualSavings ?? 0;
  const selfConsumptionDirectKwhTotal = financialSummary?.selfConsumptionDirectKwhTotal ?? 0;
  const selfConsumptionViaBatteryKwhTotal = financialSummary?.selfConsumptionViaBatteryKwhTotal ?? 0;
  const injectionReseauKwhTotal = financialSummary?.injectionReseauKwhTotal ?? 0;
  const billReductionCard = useMemo(() => {
    const retail = effectiveRetailPricePerKwh;
    const feedIn = DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH;
    const billAnnual = displayEnergyBillEur;
    const pctOfRefBill = (partEurAnnualOrMonthly: number, refBillEur: number) =>
      refBillEur > 0 && Number.isFinite(partEurAnnualOrMonthly)
        ? (Math.max(0, partEurAnnualOrMonthly) / refBillEur) * 100
        : 0;

    const byMonth = financialSummary?.batteryByMonth;
    const useSelectedMonth =
      chartViewMode === "daily" && byMonth != null && byMonth[chartSelectedMonthIndex] != null;

    if (useSelectedMonth) {
      const b = byMonth![chartSelectedMonthIndex]!;
      const monthConsoKwh =
        editedBillMonthlyKwh.length === 12
          ? editedBillMonthlyKwh[chartSelectedMonthIndex] ?? 0
          : Math.round(getEnergyConsumptionForMonth(placeType, chartSelectedMonthIndex as MonthIndex) * surfaceM2);
      const monthBillEur = Math.max(0, monthConsoKwh) * retail;
      const directEur = Math.max(0, b.selfConsumptionDirectKwh) * retail;
      const viaBatteryEur = Math.max(0, b.selfConsumptionViaBatteryKwh) * retail;
      const injectionEur = Math.max(0, b.injectionReseauKwh) * feedIn;
      const year = new Date().getFullYear();
      return {
        periodLabel: `${BILL_MONTH_LABELS_FR[chartSelectedMonthIndex]} ${year}`,
        headlineReductionEur: Math.round(directEur + viaBatteryEur + injectionEur),
        segments: [
          {
            id: "direct",
            label: "Autoconso directe",
            monthlyReductionEur: Math.round(directEur),
            pctOfBill: pctOfRefBill(directEur, monthBillEur),
            variant: "direct" as const,
          },
          {
            id: "battery",
            label: "Autoconso batterie",
            monthlyReductionEur: Math.round(viaBatteryEur),
            pctOfBill: pctOfRefBill(viaBatteryEur, monthBillEur),
            variant: "battery" as const,
          },
          {
            id: "injection",
            label: "Injection réseau",
            monthlyReductionEur: Math.round(injectionEur),
            pctOfBill: pctOfRefBill(injectionEur, monthBillEur),
            variant: "injection" as const,
          },
        ],
      };
    }

    const directEurY = Math.max(0, selfConsumptionDirectKwhTotal) * retail;
    const viaBatteryEurY = Math.max(0, selfConsumptionViaBatteryKwhTotal) * retail;
    const injectionEurY = Math.max(0, injectionReseauKwhTotal) * feedIn;
    return {
      periodLabel: "Moyenne mensuelle",
      headlineReductionEur: Math.round(annualSavings / 12),
      segments: [
        {
          id: "direct",
          label: "Autoconso directe",
          monthlyReductionEur: Math.round(directEurY / 12),
          pctOfBill: pctOfRefBill(directEurY, billAnnual),
          variant: "direct" as const,
        },
        {
          id: "battery",
          label: "Autoconso batterie",
          monthlyReductionEur: Math.round(viaBatteryEurY / 12),
          pctOfBill: pctOfRefBill(viaBatteryEurY, billAnnual),
          variant: "battery" as const,
        },
        {
          id: "injection",
          label: "Injection réseau",
          monthlyReductionEur: Math.round(injectionEurY / 12),
          pctOfBill: pctOfRefBill(injectionEurY, billAnnual),
          variant: "injection" as const,
        },
      ],
    };
  }, [
    annualSavings,
    chartSelectedMonthIndex,
    chartViewMode,
    displayEnergyBillEur,
    editedBillMonthlyKwh,
    effectiveRetailPricePerKwh,
    financialSummary?.batteryByMonth,
    injectionReseauKwhTotal,
    placeType,
    selfConsumptionDirectKwhTotal,
    selfConsumptionViaBatteryKwhTotal,
    surfaceM2,
  ]);
  const annualGridDrawKwh = financialSummary?.annualGridDrawKwh ?? 0;
  const breakdownFromHourlySim = financialSummary?.breakdownFromHourlySim ?? false;
  const priceRange = financialSummary?.priceRange ?? { equipmentEur: 0, totalMinEur: 0, totalMaxEur: 0 };

  const installationBandReady =
    Number.isFinite(priceRange.totalMinEur) &&
    Number.isFinite(priceRange.totalMaxEur) &&
    priceRange.totalMinEur > 0 &&
    priceRange.totalMaxEur > 0;
  const priceKMinPortal = installationBandReady ? (priceRange.totalMinEur / 1000).toFixed(0) : null;
  const priceKMaxPortal = installationBandReady ? (priceRange.totalMaxEur / 1000).toFixed(0) : null;

  const formatPower = (powerW: number) => {
    if (!Number.isFinite(powerW)) return "—";
    if (powerW >= 1000) return `${(powerW / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}kW`;
    return `${Math.round(powerW)}W`;
  };

  const resetBillEstimates = useCallback(() => {
    setEditedBillMonthlyKwh([...baselineBillMonthlyKwh]);
    setBillChartHighlightedMonth(null);
    setBillMonthUserEdited(Array.from({ length: 12 }, () => false));
    setBillFocusedMonthIndex(null);
    setBillFocusedDraft("");
  }, [baselineBillMonthlyKwh]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!prospect) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className={cn("max-w-md w-full", radianzDefaultCardClass)} style={radianzCardBorderStyle}>
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">Prospect introuvable ou lien invalide.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const imageCenter = getProspectImageCenter(prospect);
  const commercialReferent = prospect.commercialReferent;
  const isOwner = Boolean(user && prospect.userId === user.uid);

  const copyShareLink = () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Lien copié", { description: "Le lien de partage a été copié dans le presse-papiers." }),
      () => toast.error("Impossible de copier le lien")
    );
  };

  const portalCompanyName =
    commercialReferent?.company?.trim() ||
    prospect.name?.trim() ||
    "Entreprise";

  const recapAnnualMwh = effectiveConfig.effectiveAnnualProductionKwh / KWH_PER_MWH;
  const recapShowMwh = Number.isFinite(recapAnnualMwh) && recapAnnualMwh > 0;
  const recapCo2HasData = co2AvoidanceHasDataForDisplay(
    effectiveConfig.effectiveAnnualProductionKwh,
    liveAnnualConsumptionKwh
  );
  const recapCo2TonnesStr = avoidedCo2TonnesPerYearGridFr(
    effectiveConfig.effectiveAnnualProductionKwh
  ).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const recapParcelM2 = prospect.parcelContourAreaM2;
  const recapShowParcelle = recapParcelM2 != null && recapParcelM2 > 0;
  const recapBdnbM2 = prospect.bdnbFootprintSumM2;
  const recapShowBdnb = recapBdnbM2 != null && recapBdnbM2 > 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="max-w-5xl mx-auto p-4 sm:p-5 flex flex-col w-full gap-4">
        {/* Barre admin : visible uniquement pour le compte ayant généré la page */}
        {isOwner && (
          <div className="flex items-center justify-between shrink-0">
            <Button
              variant="default"
              size="icon"
              className="h-9 w-9 shrink-0 border-0 bg-secondary text-secondary-foreground shadow-none transition-[background-color,transform] duration-150 ease-out hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              asChild
            >
              <Link href="/" title="Retour" aria-label="Retour">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="default"
              size="icon"
              className="h-9 w-9 shrink-0 border-0 bg-secondary text-secondary-foreground shadow-none transition-[background-color,transform] duration-150 ease-out hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={copyShareLink}
              title="Copier le lien"
              aria-label="Copier le lien"
            >
              <Link2 className="h-4 w-4" />
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] md:gap-10 w-full">
          <nav className="md:sticky md:top-6 self-start">
            <div
              className={cn("p-3 shadow-xs", radianzDefaultCardClass)}
              style={radianzCardBorderStyle}
            >
              <p className={cn(radianzMonoLabelClass, "mb-2")}>Sommaire</p>
              <div className="flex flex-row md:flex-col gap-2 md:gap-1 text-sm">
                {[
                  { id: "recap", label: "Recap" },
                  { id: "facture", label: "Votre facture" },
                  { id: "projet", label: "Projet" },
                  { id: "finance", label: "Finance" },
                  { id: "contact", label: "Contact" },
                ].map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="rounded-md px-2 py-1 text-foreground transition-[background-color,transform] duration-150 ease-out text-xs font-medium hover:bg-muted active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>

            {commercialReferent?.calendlyUrl ? (
              <a
                href={commercialReferent.calendlyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "mt-2 group flex items-center gap-2 px-3 py-2 text-xs font-medium text-foreground shadow-xs hover:bg-muted/80",
                  radianzDefaultCardClass
                )}
                style={radianzCardBorderStyle}
              >
                <span className="relative size-7 shrink-0 overflow-hidden rounded-full bg-muted">
                  {commercialReferent.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={commercialReferent.photoURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <User className="size-3.5 text-muted-foreground" />
                    </span>
                  )}
                </span>
                <span className="flex-1 min-w-0 truncate">Contacter</span>
                <ArrowUpRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            ) : null}
          </nav>

          <div className="min-w-0 flex flex-col gap-10 py-1">
            <section id="recap" className="scroll-mt-24">
              <div
                className={cn(radianzLimeCardRootClass, "relative mb-4 h-[240px] overflow-hidden border shadow-none text-white")}
                style={{
                  backgroundColor: "#0A0A0A",
                  borderColor: "#262626",
                }}
              >
                <RadianzLimeDotOverlay dotColor={BRAND_LIME} layerOpacity={0.18} />
                <div className="absolute top-4 right-4 z-[1]">
                  <div className="size-14 rounded-[12px] border border-white/15 bg-white/10 backdrop-blur-sm shadow-xs overflow-hidden">
                    {commercialReferent?.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={commercialReferent.logoUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <span className="text-xs font-semibold text-white">
                          {(portalCompanyName?.trim()?.[0] ?? "—").toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="relative z-[1] flex h-full flex-col justify-end p-6">
                  <p
                    className={cn(
                      radianzMonoLabelClass,
                      "mb-2 text-white opacity-100"
                    )}
                  >
                    {portalCompanyName}
                  </p>
                  <div className="font-sans text-3xl font-light tracking-tight text-white sm:text-[2.5rem] sm:leading-[1.05]">
                    Hello <span aria-hidden>👋</span>
                  </div>
                  <p className="mt-2 max-w-xl font-mono text-[10px] leading-snug text-white/90">
                    Welcome to the {portalCompanyName} Portal
                  </p>
                </div>
              </div>

              {/* Carte projet (au-dessus des KPI) */}
              <div className="">
                <div className="grid grid-cols-[168px_1fr] sm:grid-cols-[224px_1fr] gap-4">
                  <figure className="rounded-[12px] border border-border aspect-square w-full max-w-full bg-card overflow-hidden">
                    {prospect.coordinates ? (
                      <SatelliteImage
                        key={`sat-recap-${imageCenter.lat}-${imageCenter.lng}`}
                        coordinates={imageCenter}
                        address={prospect.address}
                        zoom={17}
                        width={448}
                        height={448}
                        className="w-full h-full object-cover"
                        showOverlays={false}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                  </figure>

                  <div className="min-w-0 flex flex-col">
                    <p className="text-sm text-foreground font-medium">
                      {prospect.name || prospect.address}
                    </p>
                    {prospect.address && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">{prospect.address}</p>
                    )}

                    <div className="mt-3 flex flex-col gap-4">
                      <div className="drawer-discovery-pills">
                        {recapShowMwh ? (
                          <Badge
                            variant="outline"
                            className="h-6 min-h-6 rounded-md border-0 bg-foreground px-2 py-0 text-[10px] font-semibold uppercase leading-none tracking-wide text-background shadow-[0_1px_0_rgb(0_0_0/0.1)] transition-[transform,box-shadow] duration-200 hover:bg-foreground/90 hover:-translate-y-px hover:shadow-xs"
                            title="Production photovoltaïque annuelle estimée (scénario affiché)"
                          >
                            {recapAnnualMwh.toLocaleString("fr-FR", {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            })}{" "}
                            MWh/an
                          </Badge>
                        ) : null}
                        {recapCo2HasData ? (
                          <Badge
                            variant="outline"
                            className="h-6 min-h-6 rounded-md border-0 bg-foreground px-2 py-0 text-[10px] font-semibold uppercase leading-none tracking-wide text-background shadow-[0_1px_0_rgb(0_0_0/0.1)] transition-[transform,box-shadow] duration-200 hover:bg-foreground/90 hover:-translate-y-px hover:shadow-xs"
                            title="CO₂ évité par la production PV — hypothèse mix réseau ~52 g CO₂e/kWh (indicatif)"
                          >
                            {recapCo2TonnesStr} t CO₂/an
                          </Badge>
                        ) : null}
                        {effectiveConfig.effectiveKwp > 0 ? (
                          <Badge
                            variant="outline"
                            className="h-6 min-h-6 rounded-md border-0 bg-foreground px-2 py-0 text-[10px] font-semibold uppercase leading-none tracking-wide text-background shadow-[0_1px_0_rgb(0_0_0/0.1)] transition-[transform,box-shadow] duration-200 hover:bg-foreground/90 hover:-translate-y-px hover:shadow-xs"
                            title="Puissance crête estimée (kWp)"
                          >
                            {effectiveConfig.effectiveKwp.toFixed(2)} kWp
                          </Badge>
                        ) : null}
                      </div>

                      {recapShowBdnb || recapShowParcelle ? (
                        <div className="flex flex-wrap gap-8 border-t border-border pt-3 sm:gap-10">
                          {recapShowBdnb ? (
                            <div
                              className="flex min-w-[5.5rem] max-w-[14rem] flex-col items-center gap-2 text-center"
                              title="Empreinte au sol des bâtiments (BDNB, Σ footprint)"
                            >
                              <Image
                                src="/Buildingicon.svg"
                                alt=""
                                width={44}
                                height={44}
                                className="size-11 shrink-0 object-contain"
                                aria-hidden
                              />
                              <span className="font-sans text-sm font-medium tabular-nums tracking-tight text-foreground">
                                {Math.round(recapBdnbM2!).toLocaleString("fr-FR", { maximumFractionDigits: 0 })}{" "}
                                m²
                              </span>
                              <span className={cn(radianzMonoLabelClass, "max-w-full text-pretty leading-snug")}>
                                Surface building
                              </span>
                            </div>
                          ) : null}
                          {recapShowParcelle ? (
                            <div
                              className="flex min-w-[5.5rem] max-w-[14rem] flex-col items-center gap-2 text-center"
                              title={
                                prospect.pipelineEntrySource === "discovery_v5"
                                  ? "Aire du polygone parcelle sur la carte (approx. géodésique locale) ou somme des parcelles liées"
                                  : "Surface au sol du contour parcelle cadastrale (approx. cartographique)"
                              }
                            >
                              <span className="flex size-11 shrink-0 items-center justify-center" aria-hidden>
                                <Image
                                  src="/Topoicon.svg"
                                  alt=""
                                  width={44}
                                  height={44}
                                  className="size-11 object-contain opacity-90"
                                />
                              </span>
                              <span className="font-sans text-sm font-medium tabular-nums tracking-tight text-foreground">
                                {Math.round(recapParcelM2!).toLocaleString("fr-FR", { maximumFractionDigits: 0 })}{" "}
                                m²
                              </span>
                              <span className={cn(radianzMonoLabelClass, "max-w-full text-pretty leading-snug")}>
                                Surface parcelle
                              </span>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {surfaceM2 > 0 && editedBillMonthlyKwh.length === 12 ? (
              <section id="facture" className="scroll-mt-24">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-3">
                  <h2 className="text-lg font-semibold text-foreground">Votre facture</h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={resetBillEstimates}
                      className="text-left text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:text-right"
                    >
                      Réinitialiser
                    </button>
                  </div>
                </div>
                <div
                  className={cn("flex min-h-[450px] flex-col rounded-[12px] border p-4 shadow-xs", radianzDefaultCardClass)}
                  style={radianzCardBorderStyle}
                >
                  <MonthlyConsumptionOnlyChart
                    fillVertical
                    monthlyKwh={editedBillMonthlyKwh}
                    unitMode={billValueMode}
                    onUnitModeChange={setBillValueMode}
                    retailPriceEurPerKwh={effectiveRetailPricePerKwh}
                    highlightedMonthIndex={billChartHighlightedMonth}
                    contentBelowTotal={(
                      <div
                        ref={billInputsGridRef}
                        className="grid grid-cols-6 gap-x-0.5 gap-y-1 sm:grid-cols-12 sm:gap-1 min-w-0"
                      >
                        {BILL_MONTH_LABELS_FR.map((label, i) => {
                          const kwhHint = Math.round(editedBillMonthlyKwh[i] ?? 0);
                          const hintStr = billValueMode === "eur"
                            ? formatKwhAsEurForBillInput(kwhHint, effectiveRetailPricePerKwh)
                            : formatKwhAsMwhForBillInput(kwhHint);
                          const isFocused = billFocusedMonthIndex === i;
                          const inputValue = isFocused
                            ? billFocusedDraft
                            : billMonthUserEdited[i]
                              ? billValueMode === "eur"
                                ? formatKwhAsEurForBillInput(kwhHint, effectiveRetailPricePerKwh)
                                : formatKwhAsMwhForBillInput(kwhHint)
                              : "";
                          const inputPlaceholder =
                            billMonthUserEdited[i] || isFocused ? undefined : hintStr;
                          return (
                            <div key={label} className="flex min-w-0 flex-col items-stretch gap-0.5">
                              <span
                                className="text-center font-mono text-[8px] leading-none tabular-nums text-muted-foreground"
                                title={label}
                                aria-label={label}
                              >
                                {BILL_MONTH_ABBREV_FR[i]}
                              </span>
                              <Input
                                type="text"
                                inputMode="decimal"
                                className={cn(
                                  "h-6 min-h-6 rounded-none border-0 bg-muted/80 px-0.5 py-0 text-center font-mono text-[9px] tabular-nums leading-tight shadow-none ring-offset-0 focus-visible:border-0 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-0 md:text-[9px] dark:bg-muted/80",
                                  billMonthUserEdited[i]
                                    ? "bg-foreground/20 text-foreground dark:bg-foreground/30"
                                    : isFocused
                                      ? "text-foreground/60"
                                      : "text-muted-foreground"
                                )}
                                value={inputValue}
                                placeholder={inputPlaceholder}
                                onChange={(e) => {
                                  if (billFocusedMonthIndex === i) setBillFocusedDraft(e.target.value);
                                }}
                                onFocus={(e) => {
                                  billMonthFocusValueRef.current[i] = e.currentTarget.value;
                                  setBillFocusedMonthIndex(i);
                                  setBillFocusedDraft(
                                    billMonthUserEdited[i]
                                      ? billValueMode === "eur"
                                        ? formatKwhAsEurForBillInput(Math.round(editedBillMonthlyKwh[i] ?? 0), effectiveRetailPricePerKwh)
                                        : formatKwhAsMwhForBillInput(Math.round(editedBillMonthlyKwh[i] ?? 0))
                                      : ""
                                  );
                                  setBillChartHighlightedMonth(i);
                                }}
                                onBlur={(e) => {
                                  const blurred = e.target.value;
                                  const normalized = normalizeBillInputRaw(blurred);
                                  const parsed = parseFloat(normalized);
                                  const vKwh = Number.isFinite(parsed)
                                    ? billValueMode === "eur"
                                      ? parsed / Math.max(0.000001, effectiveRetailPricePerKwh)
                                      : parsed * KWH_PER_MWH
                                    : NaN;
                                  const valid = Number.isFinite(vKwh) && vKwh >= 1 && normalized.length > 0;
                                  const baselineMonth = baselineBillMonthlyKwh[i] ?? 0;

                                  setBillMonthUserEdited((prevEdited) => {
                                    const nextEdited = [...prevEdited];
                                    const monthWasEdited = prevEdited[i];
                                    const shouldClear = shouldClearBillMonthToBaseline({
                                      normalized,
                                      isValid: valid,
                                      baselineMonth,
                                      monthWasEdited,
                                    });

                                    if (shouldClear) {
                                      // Champ vidé/invalide: on revient à l'estimation initiale du mois.
                                      nextEdited[i] = false;
                                      setEditedBillMonthlyKwh((prevMonthly) => {
                                        if (prevMonthly.length !== 12) return prevMonthly;
                                        const nextMonthly = [...prevMonthly];
                                        nextMonthly[i] = Math.max(0, Math.round(baselineMonth));
                                        return nextMonthly;
                                      });
                                      return nextEdited;
                                    }

                                    if (normalized.length === 0 || !valid || baselineMonth <= 0) {
                                      return nextEdited;
                                    }

                                    const targetKwh = Math.max(0, Math.round(vKwh));
                                    nextEdited[i] = true;
                                    setEditedBillMonthlyKwh((prevMonthly) => {
                                      if (prevMonthly.length !== 12) return prevMonthly;
                                      // Ratio global = moyenne des ratios de tous les mois saisis.
                                      const editedRatios = nextEdited
                                        .map((isEdited, monthIdx) => {
                                          if (!isEdited) return null;
                                          const base = baselineBillMonthlyKwh[monthIdx] ?? 0;
                                          if (base <= 0) return null;
                                          const value = monthIdx === i
                                            ? targetKwh
                                            : Math.max(0, Math.round(prevMonthly[monthIdx] ?? 0));
                                          return value / base;
                                        })
                                        .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
                                      const avgRatio = editedRatios.length
                                        ? editedRatios.reduce((sum, r) => sum + r, 0) / editedRatios.length
                                        : 1;

                                      return baselineBillMonthlyKwh.map((baseKwh, monthIdx) => {
                                        if (monthIdx === i) return targetKwh;
                                        // Les mois déjà saisis par l'utilisateur restent figés.
                                        if (nextEdited[monthIdx]) return Math.max(0, Math.round(prevMonthly[monthIdx] ?? 0));
                                        return Math.max(0, Math.round(baseKwh * avgRatio));
                                      });
                                    });

                                    if (!monthWasEdited) {
                                      billMonthFocusValueRef.current[i] = normalized;
                                    }
                                    return nextEdited;
                                  });

                                  setBillFocusedMonthIndex(null);
                                  setBillFocusedDraft("");
                                  const rel = e.relatedTarget as Node | null;
                                  if (!billInputsGridRef.current?.contains(rel)) {
                                    setBillChartHighlightedMonth(null);
                                  }
                                }}
                                aria-label={
                                  billValueMode === "eur"
                                    ? `Facture ${label} en euros. Estimation ${hintStr} euros affichée en filigrane tant que vous n’avez pas saisi de valeur.`
                                    : `Consommation ${label} en mégawattheures. Estimation ${hintStr} MWh affichée en filigrane tant que vous n’avez pas saisi de valeur.`
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  />
                </div>
              </section>
            ) : null}

            <section id="projet" className="scroll-mt-32">
              <div className="flex items-end justify-between gap-4 mb-3">
                <h2 className="text-lg font-semibold text-foreground">Projet</h2>
              </div>

              {/* Graphique + boutons (système) */}
              {(prospect.solarPotential?.productionPerKwpMonthly?.length || prospect.solarPotential?.monthlyProduction?.length) && surfaceM2 > 0 && (
                <div className="flex flex-col gap-3">
                  <Tabs
                    value={configurationMode}
                    onValueChange={(v) => {
                      pendingBatteryResyncAfterModeChangeRef.current = true;
                      setConfigurationModeUserOverride(v as ProspectConfigurationMode);
                    }}
                    variant="line"
                    className="w-full min-w-0"
                  >
                    <TabsList aria-label="Mode de configuration" className="w-full min-w-0">
                      <TabsTrigger value="perfect_fit">
                        Perfect fit ({choiceCardsConfig.perfectFit.kwp.toFixed(2)} kWp)
                      </TabsTrigger>
                      <TabsTrigger value="highest_production">
                        Highest production ({choiceCardsConfig.highestProduction.kwp.toFixed(2)} kWp)
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>

                  <ProspectEnergyChartsPanel
                    configurationModeKey={configurationMode}
                    annualProductionKwh={effectiveConfig.effectiveAnnualProductionKwh}
                    chartViewMode={chartViewMode}
                    onChartViewModeChange={setChartViewMode}
                    chartSelectedMonthIndex={chartSelectedMonthIndex}
                    onChartSelectedMonthIndexChange={setChartSelectedMonthIndex}
                    data={chartData}
                    dailyData={chartDailyData}
                    includeBattery={includeBatteryLocal}
                    onIncludeBatteryChange={setIncludeBatteryLocal}
                  />
                </div>
              )}

              <div className="mt-6 flex w-full flex-col gap-6">
                <RadianzBillReductionCard
                  periodLabel={billReductionCard.periodLabel}
                  initialBillAnnualEur={displayEnergyBillEur}
                  headlineReductionEur={billReductionCard.headlineReductionEur}
                  segments={billReductionCard.segments}
                />
                <RadianzCo2AvoidanceRadial
                  annualProductionKwh={effectiveConfig.effectiveAnnualProductionKwh}
                  annualConsumptionKwh={liveAnnualConsumptionKwh}
                />
              </div>
            </section>

            <section id="finance" className="scroll-mt-24">
              <div className="flex items-end justify-between gap-4 mb-3">
                <h2 className="text-lg font-semibold text-foreground">Finance</h2>
              </div>
              {(() => {
                const capexAvgEur =
                  Number.isFinite(priceRange.totalMinEur) && Number.isFinite(priceRange.totalMaxEur)
                    ? (priceRange.totalMinEur + priceRange.totalMaxEur) / 2
                    : 0;
                const canRender =
                  Number.isFinite(capexAvgEur) &&
                  capexAvgEur > 0 &&
                  Number.isFinite(annualSavings) &&
                  annualSavings > 0;

                if (!canRender) {
                  return (
                    <div className="space-y-3">
                      <div className={cn("p-4", radianzDefaultCardClass)} style={radianzCardBorderStyle}>
                        <p className="text-sm text-muted-foreground">
                          Données ROI indisponibles pour ce projet.
                        </p>
                      </div>
                      {installationBandReady && priceKMinPortal != null && priceKMaxPortal != null ? (
                        <SharePortalInstallationCard priceKMin={priceKMinPortal} priceKMax={priceKMaxPortal} />
                      ) : null}
                    </div>
                  );
                }

                const baseCapexEur = capexAvgEur;
                const baseAnnualSavingsEur = annualSavings;
                const years = 25;

                const derived = (() => {
                  if (financingMode === "capex") {
                    return {
                      capexEur: baseCapexEur,
                      annualNetEur: baseAnnualSavingsEur,
                      badge: "Investissement initial",
                    };
                  }

                  if (financingMode === "lease") {
                    // Hypothèse UX simple: lease sur 15 ans (sans apport), coût annuel = CAPEX/15.
                    const leaseAnnualCostEur = baseCapexEur / 15;
                    return {
                      capexEur: 0,
                      annualNetEur: baseAnnualSavingsEur - leaseAnnualCostEur,
                      badge: "Loyer mensuel",
                    };
                  }

                  // PPA: pas d'investissement, économies "nettes" plus faibles (vous payez l'énergie PPA).
                  return {
                    capexEur: 0,
                    annualNetEur: baseAnnualSavingsEur * 0.7,
                    badge: "€/kWh",
                  };
                })();

                const selfKwhTotal =
                  selfConsumptionDirectKwhTotal + selfConsumptionViaBatteryKwhTotal;
                const escalationG = DEFAULT_ANNUAL_ELECTRICITY_PRICE_ESCALATION;
                const roiCumulative25 = getRoiCumulativeNetEurAfterHorizon({
                  capexEur: derived.capexEur,
                  years,
                  escalationAnnual: escalationG,
                  retailPriceYear0: effectiveRetailPricePerKwh,
                  feedInPriceYear0: DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH,
                  selfConsumptionKwh: selfKwhTotal,
                  excessInjectionKwh: injectionReseauKwhTotal,
                  financingMode,
                  referenceCapexForLeaseEur: baseCapexEur,
                });
                const gridKwhForTariff =
                  consoAnnuelleKwh > 0
                    ? Math.min(annualGridDrawKwh, consoAnnuelleKwh)
                    : annualGridDrawKwh;
                const tariffBillGapYear25 =
                  projectedAnnualGridBillEur(
                    consoAnnuelleKwh,
                    effectiveRetailPricePerKwh,
                    escalationG,
                    25
                  ) -
                  projectedAnnualGridBillEur(
                    gridKwhForTariff,
                    effectiveRetailPricePerKwh,
                    escalationG,
                    25
                  );

                return (
                  <>
                    <Tabs
                      value={financingMode}
                      onValueChange={(v) => setFinancingMode(v as FinancingMode)}
                      variant="line"
                      className="w-full min-w-0"
                    >
                      <TabsList aria-label="Mode de financement" className="w-full min-w-0">
                        <TabsTrigger value="capex">CAPEX</TabsTrigger>
                        <TabsTrigger value="lease">Lease</TabsTrigger>
                        <TabsTrigger value="ppa">PPA</TabsTrigger>
                      </TabsList>
                    </Tabs>

                    <div
                      className={cn("mt-3 h-[360px] py-3 px-4 pb-2 flex flex-col overflow-hidden", radianzDefaultCardClass)}
                      style={radianzCardBorderStyle}
                    >
                      <div className="flex flex-col gap-1.5 mb-2 shrink-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={radianzMonoLabelClass}>
                            {financeChartView === "roi"
                              ? "ROI (cashflow net)"
                              : "Facture réseau (hausse prix)"}
                          </span>
                          <div
                            role="tablist"
                            className="inline-flex rounded-md border border-border bg-muted/50 p-0.5 shrink-0"
                            aria-label="Vue du graphique finance"
                          >
                            <button
                              type="button"
                              role="tab"
                              aria-selected={financeChartView === "roi"}
                              onClick={() => setFinanceChartView("roi")}
                              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                                financeChartView === "roi"
                                  ? "bg-background text-foreground shadow-xs"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              ROI
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={financeChartView === "tariff"}
                              onClick={() => setFinanceChartView("tariff")}
                              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                                financeChartView === "tariff"
                                  ? "bg-background text-foreground shadow-xs"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              Hausse prix
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {financeChartView === "roi" ? (
                            <>
                              <span className="tabular-nums text-[#0000FF] text-lg font-semibold">
                                {`${Math.round(roiCumulative25) > 0 ? "+" : ""}${Math.round(roiCumulative25).toLocaleString("fr-FR")} €`}
                              </span>
                              <TooltipProvider>
                                <Tooltip delayDuration={150}>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      aria-label="Informations sur le calcul"
                                    >
                                      <Info className="h-4 w-4" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" align="start" className="text-xs max-w-xs">
                                    Plus-value nette cumulée sur 25 ans (investissement inclus), avec hausse annuelle du prix de l&apos;électricité intégrée aux économies.
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </>
                          ) : (
                            <>
                              <span className="tabular-nums text-[#0000FF] text-lg font-semibold">
                                {`Écart année 25 : ${tariffBillGapYear25 >= 0 ? "+" : ""}${Math.round(tariffBillGapYear25).toLocaleString("fr-FR")} €`}
                              </span>
                              <TooltipProvider>
                                <Tooltip delayDuration={150}>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      aria-label="Informations sur le calcul"
                                    >
                                      <Info className="h-4 w-4" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" align="start" className="text-xs max-w-xs">
                                    Différence entre facture si toute la consommation était achetée au réseau et facture sur le seul tirage réseau, à l&apos;année 25 (même scénario de hausse des prix).
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex-1 min-h-0 flex flex-col">
                        {financeChartView === "roi" ? (
                          <RoiComboChart
                            capexEur={derived.capexEur}
                            years={years}
                            escalationAnnual={escalationG}
                            retailPriceYear0={effectiveRetailPricePerKwh}
                            feedInPriceYear0={DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH}
                            selfConsumptionKwh={selfKwhTotal}
                            excessInjectionKwh={injectionReseauKwhTotal}
                            financingMode={financingMode}
                            referenceCapexForLeaseEur={baseCapexEur}
                          />
                        ) : (
                          <ElectricityTariffEscalationChart
                            annualConsumptionKwh={consoAnnuelleKwh}
                            annualGridDrawKwh={gridKwhForTariff}
                            retailPriceYear0={effectiveRetailPricePerKwh}
                            escalationAnnual={escalationG}
                            years={years}
                          />
                        )}
                      </div>
                    </div>

                    {(installationBandReady && priceKMinPortal != null && priceKMaxPortal != null) ||
                    panelsData !== undefined ||
                    invertersData !== undefined ||
                    batteriesData !== undefined ? (
                      <div className="mt-3 grid grid-cols-1 gap-4 items-stretch md:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
                        {installationBandReady && priceKMinPortal != null && priceKMaxPortal != null ? (
                          <SharePortalInstallationCard
                            priceKMin={priceKMinPortal}
                            priceKMax={priceKMaxPortal}
                            className="h-full min-w-0"
                          />
                        ) : null}

                        {(panelsData !== undefined || invertersData !== undefined || batteriesData !== undefined) && (
                          <div
                            className={cn("min-w-0 py-3 px-4 overflow-auto", radianzDefaultCardClass)}
                            style={radianzCardBorderStyle}
                          >
                            <div className={cn(radianzMonoLabelClass, "mb-3")}>Équipement</div>
                            <div className="space-y-2">
                              {visiblePanels.length > 0 ? (
                                <div>
                                  <EquipmentSelectCard<PanelReference>
                                    value={usedPanelRef ?? undefined}
                                    options={visiblePanels}
                                    onChange={(p) => setSelectedPanelId(p ? p.id : null)}
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
                                          <div className="flex items-center gap-1 mt-0 flex-wrap leading-none">
                                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">€{p.costEur}</span>
                                            <span className="text-muted-foreground/40 text-[10px]">|</span>
                                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                              <Zap className="h-2.5 w-2.5 text-muted-foreground/80" />
                                              {formatPower(p.powerW)}
                                            </span>
                                            {p.warrantyYears != null && (
                                              <>
                                                <span className="text-muted-foreground/40 text-[10px]">|</span>
                                                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                                  <FileCheck className="h-2.5 w-2.5 text-muted-foreground/80" />
                                                  {p.warrantyYears}y
                                                </span>
                                              </>
                                            )}
                                            {p.countryCode && (
                                              <>
                                                <span className="text-muted-foreground/40 text-xs">|</span>
                                                <span className="inline-flex shrink-0" title={p.countryOfOrigin}>
                                                  <img
                                                    src={getCountryFlagUrl(p.countryCode)}
                                                    alt=""
                                                    className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50"
                                                  />
                                                </span>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      </>
                                    )}
                                    renderOptionContent={(p) => (
                                      <>
                                        <EquipmentThumbnail imageUrl={p.imageUrl} alt="" fallback={<span className="text-muted-foreground text-xs">—</span>} size="sm" />
                                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                                          <div className="font-medium text-xs text-foreground truncate">{p.name}</div>
                                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] text-muted-foreground">
                                            <span>€{p.costEur}</span>
                                            <span>·</span>
                                            <span>{formatPower(p.powerW)}</span>
                                            {p.recommended && (
                                              <span className="inline-flex items-center rounded bg-gray-900 px-1 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                                            )}
                                          </div>
                                        </div>
                                      </>
                                    )}
                                  />
                                </div>
                              ) : panelsData !== undefined ? (
                                <p className="text-xs text-muted-foreground py-2">Aucun panneau configuré</p>
                              ) : null}

                              {visibleInverters.length > 0 ? (
                                <div>
                                  <EquipmentSelectCard<InverterReference>
                                    value={usedInverterRef ?? undefined}
                                    options={visibleInverters}
                                    onChange={(i) => setSelectedInverterId(i ? i.id : null)}
                                    getItemId={(i) => i.id}
                                    showRecommendedBadge={!!usedInverterRef?.recommended}
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
                                          <div className="flex items-center gap-1 mt-0 flex-wrap leading-none">
                                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">€{i.costEur}</span>
                                            <span className="text-muted-foreground/40 text-[10px]">|</span>
                                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                              <Zap className="h-2.5 w-2.5 text-muted-foreground/80" />
                                              {formatPower(i.powerW)}
                                            </span>
                                            {i.warrantyYears != null && (
                                              <>
                                                <span className="text-muted-foreground/40 text-[10px]">|</span>
                                                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                                  <FileCheck className="h-2.5 w-2.5 text-muted-foreground/80" />
                                                  {i.warrantyYears}y
                                                </span>
                                              </>
                                            )}
                                            {i.countryCode && (
                                              <>
                                                <span className="text-muted-foreground/40 text-xs">|</span>
                                                <span className="inline-flex shrink-0" title={i.countryOfOrigin}>
                                                  <img
                                                    src={getCountryFlagUrl(i.countryCode)}
                                                    alt=""
                                                    className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50"
                                                  />
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
                                            <span>{formatPower(i.powerW)}</span>
                                            {i.recommended && (
                                              <span className="inline-flex items-center rounded bg-gray-900 px-1 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                                            )}
                                          </div>
                                        </div>
                                      </>
                                    )}
                                  />
                                </div>
                              ) : invertersData !== undefined ? (
                                <p className="text-xs text-muted-foreground py-2">Aucun onduleur configuré</p>
                              ) : null}

                              {includeBatteryEffective ? (
                                visibleBatteries.length > 0 ? (
                                  <div>
                                    <BatterySelectCard
                                      value={usedBatteryRef ?? undefined}
                                      onChange={(b) => {
                                        setSelectedBatteryId(b ? b.id : null);
                                        if (b) {
                                          const maxForNew = b.maxBatteriesPerRack ?? 20;
                                          setSelectedBatteryCount((prev) => Math.min(maxForNew, Math.max(1, prev)));
                                        }
                                      }}
                                      count={selectedBatteryCount}
                                      onCountChange={setSelectedBatteryCount}
                                      maxCount={usedBatteryRef?.maxBatteriesPerRack ?? 20}
                                      batteries={visibleBatteries}
                                      isRecommendedForProspect={
                                        !!recommendedBatteryComposition &&
                                        usedBatteryRef?.id === recommendedBatteryComposition.model.id &&
                                        selectedBatteryCount === recommendedBatteryComposition.count
                                      }
                                      recommendedBatteryIdForProspect={recommendedBatteryComposition?.model.id ?? null}
                                    />
                                  </div>
                                ) : batteriesData !== undefined ? (
                                  <p className="text-xs text-muted-foreground py-2">Aucune batterie configurée</p>
                                ) : null
                              ) : (
                                <p className="text-xs text-muted-foreground py-2">Batterie non incluse</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </section>

            <section id="contact" className="scroll-mt-24">
              <div className="flex items-end justify-between gap-4 mb-3">
                <h2 className="text-lg font-semibold text-foreground">Contact</h2>
              </div>
              {commercialReferent && (commercialReferent.name || commercialReferent.email || commercialReferent.phone) ? (
                <div
                  className={cn(
                    "grid min-w-0 grid-cols-1 gap-6 overflow-hidden p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-7",
                    radianzDefaultCardClass
                  )}
                  style={radianzCardBorderStyle}
                >
                  {/* Identité + méta (portrait dans le même bloc que nom / entreprise) */}
                  <div className="flex min-w-0 flex-col gap-4 lg:gap-[18px]">
                    <div className="min-w-0">
                      <div className="flex items-start gap-4">
                        <div
                          className="relative size-24 shrink-0 overflow-hidden rounded-full border bg-muted"
                          style={{ borderColor: BRAND_LINE }}
                        >
                          {commercialReferent.photoURL ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={commercialReferent.photoURL}
                              alt=""
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div
                              className="flex h-full w-full items-center justify-center font-sans text-[2.375rem] font-light tracking-tight text-foreground"
                              aria-hidden
                            >
                              {referentInitials(commercialReferent.name || commercialReferent.email || "?")}
                            </div>
                          )}
                          <span
                            className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full ring-[3px] ring-card"
                            style={{ backgroundColor: BRAND_INK }}
                            aria-hidden
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              {commercialReferent.name ? (
                                <p className="font-sans text-[1.625rem] font-normal leading-[1.1] tracking-[-0.015em] text-foreground">
                                  {commercialReferent.name}
                                </p>
                              ) : null}
                            </div>
                            <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-medium uppercase leading-none tracking-[0.1em] text-emerald-800 dark:text-emerald-300">
                              <span className="leading-none">Disponible</span>
                              <span
                                className="size-1.5 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-400"
                                aria-hidden
                              />
                            </span>
                          </div>
                          <div className="mt-2 flex min-w-0 items-center gap-2">
                            {commercialReferent.logoUrl ? (
                              <div
                                className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded border bg-card"
                                style={{ borderColor: BRAND_LINE }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={commercialReferent.logoUrl}
                                  alt=""
                                  className="h-full w-full object-contain p-0.5"
                                />
                              </div>
                            ) : null}
                            <p className="min-w-0 truncate font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
                              {commercialReferent.company?.trim()
                                ? commercialReferent.company.trim()
                                : "Accompagnement projet solaire"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {(() => {
                      const phoneLine = commercialReferent.phone?.trim();
                      const emailLine = commercialReferent.email?.trim();
                      const cells: { label: string; node: ReactNode }[] = [];
                      if (phoneLine) {
                        cells.push({
                          label: "Téléphone",
                          node: <span className="text-foreground/90">{phoneLine}</span>,
                        });
                      }
                      if (emailLine) {
                        cells.push({
                          label: "Email",
                          node: <span className="break-words text-foreground/90">{emailLine}</span>,
                        });
                      }
                      if (cells.length === 0) return null;
                      return (
                        <div
                          className="grid gap-4 border-t pt-3.5 font-mono sm:grid-flow-col sm:auto-cols-max sm:justify-start sm:gap-x-8"
                          style={{ borderColor: BRAND_LINE }}
                        >
                          {cells.map((cell, i) => (
                            <div
                              key={cell.label}
                              className={cn(
                                "w-max min-w-0 max-w-full",
                                i > 0 && "sm:border-l sm:pl-8"
                              )}
                              style={i > 0 ? { borderColor: BRAND_LINE } : undefined}
                            >
                              <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                                {cell.label}
                              </div>
                              <div className="mt-1 text-[13px]">{cell.node}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Actions — sous le bloc identité jusqu'à lg ; colonne droite en lg+ */}
                  <div className="flex min-w-0 flex-col gap-3.5 lg:min-w-[200px] lg:items-end">
                    {commercialReferent.email ? (
                      <Button
                        asChild
                        variant="default"
                        className="h-11 w-full justify-center rounded-xl border-0 text-white hover:opacity-90 lg:w-[200px] [&_svg]:size-3.5"
                        style={{ backgroundColor: BRAND_INK }}
                      >
                        <a href={`mailto:${commercialReferent.email}`}>
                          <Mail className="size-3.5" aria-hidden />
                          Envoyer un email
                        </a>
                      </Button>
                    ) : null}
                    {commercialReferent.phone ? (
                      <Button
                        asChild
                        variant="outline"
                        className="h-11 w-full justify-center rounded-xl bg-transparent lg:w-[200px] [&_svg]:size-3.5"
                        style={{ borderColor: BRAND_INK, color: BRAND_INK }}
                      >
                        <a href={`tel:${commercialReferent.phone.replace(/\s/g, "")}`}>
                          <Phone className="size-3.5" aria-hidden />
                          Appeler
                        </a>
                      </Button>
                    ) : null}
                    {commercialReferent.calendlyUrl ? (
                      <Button
                        asChild
                        variant="outline"
                        className="h-11 w-full justify-center rounded-xl bg-transparent lg:w-[200px] [&_svg]:size-3.5"
                        style={{ borderColor: BRAND_INK, color: BRAND_INK }}
                      >
                        <a href={commercialReferent.calendlyUrl} target="_blank" rel="noopener noreferrer">
                          <Calendar className="size-3.5" aria-hidden />
                          Prendre rendez-vous
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className={cn("p-4 shadow-xs", radianzDefaultCardClass)} style={radianzCardBorderStyle}>
                  <p className="text-sm text-muted-foreground">Aucun contact configuré.</p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      <Dialog open={energyBillDialogOpen} onOpenChange={setEnergyBillDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Ma facture annuelle (€)</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Input
              type="number"
              min={0}
              step={100}
              placeholder={energyBillEur.toLocaleString("fr-FR")}
              defaultValue={energyBillEurOverride ?? energyBillEur}
              className="tabular-nums"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = parseFloat((e.target as HTMLInputElement).value);
                  if (!Number.isNaN(v) && v >= 0) setEnergyBillEurOverride(v);
                  setEnergyBillDialogOpen(false);
                }
              }}
              onBlur={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v) && v >= 0) setEnergyBillEurOverride(v);
              }}
            />
            <p className="text-xs text-gray-500">Estimation : {energyBillEur.toLocaleString("fr-FR")} €</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
