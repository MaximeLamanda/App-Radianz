"use client";

import { useState, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { User, Phone, Mail, Building2, Loader2, ArrowLeft, Link2, Battery, Zap, FileCheck, Pencil, ArrowUpRight, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  usePanelReferences,
  useInverterReferences,
  useBatteryReferences,
  useProspectByShareToken,
} from "@/lib/swr-hooks";
import { getProspectImageCenter } from "@/lib/geometry";
import { SatelliteImage } from "@/components/solar-scout/SatelliteImage";
import { translatePlaceType } from "@/lib/place-types-translation";
import { getCountryFlagUrl } from "@/lib/solar-settings";
import {
  getEnergyConsumption,
  getEnergyConsumptionForMonth,
  getHourlyConsumptionProfileKwhPerM2,
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
  getRecommendedPanelReferenceSync,
  getRecommendedInverterReferenceSync,
  getRecommendedBatteryReferenceSync,
  getSolarEquipmentSettings,
  calculatePanelCount,
  calculateInverterCount,
  estimateInstallationPriceEur,
  estimateTotalPriceRangeEur,
  estimateAnnualSavingsEurWithBattery,
  DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH,
  DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH,
  estimateAnnualSavingsEurWithBreakdown,
  estimateEnergyBillEur,
  getBreakEvenYears,
  DEFAULT_ANNUAL_ELECTRICITY_PRICE_ESCALATION,
  effectiveRetailPriceEurPerKwhFromBill,
  projectedAnnualGridBillEur,
} from "@/lib/solar-settings";
import { computeRecommendedBatteryTargetKwh } from "@/lib/recommended-battery-sizing";
import { MonthlyProductionChart } from "@/components/solar-scout/MonthlyProductionChart";
import { EquipmentSelectCard, EquipmentThumbnail } from "@/components/solar-scout/EquipmentSelectCard";
import { BatterySelectCard } from "@/components/solar-scout/BatterySelectCard";
import type { Prospect, PanelReference, InverterReference, BatteryReference } from "@/types";
import { toast } from "sonner";
import { RoiComboChart, getRoiCumulativeNetEurAfterHorizon } from "@/components/solar-scout/RoiChart";
import { ElectricityTariffEscalationChart } from "@/components/solar-scout/ElectricityTariffEscalationChart";

type FinancingMode = "capex" | "lease" | "ppa";

/** Largeur mini visée d’un trait (px) — sert à choisir combien de colonnes tiennent dans la largeur. */
const CARBON_BAR_STICK_MIN_PX = 1;
/** Écart fixe entre deux traits (px) — identique pour toutes les paires. */
const CARBON_BAR_GAP_PX = 1;

/** Nombre de traits : même écart et largeurs égales, la grille répartit le reste sur toute la largeur. */
function carbonBarStickCountForWidth(widthPx: number): number {
  const sMin = CARBON_BAR_STICK_MIN_PX;
  const g = CARBON_BAR_GAP_PX;
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 1;
  return Math.max(1, Math.floor((widthPx + g) / (sMin + g)));
}

export default function ProspectSharePage() {
  const params = useParams();
  const { user } = useAuth();
  const shareToken = (params?.shareToken as string) ?? null;
  const { data: prospectData } = useProspectByShareToken(shareToken);
  const prospect = prospectData ?? null;
  const ownerUserId = prospect?.userId ?? null;
  const [financingMode, setFinancingMode] = useState<FinancingMode>("capex");
  const { data: panelsData } = usePanelReferences(ownerUserId);
  const { data: invertersData } = useInverterReferences(ownerUserId);
  const { data: batteriesData } = useBatteryReferences(ownerUserId);
  const loading = prospectData === undefined && shareToken != null;
  const [configurationMode, setConfigurationMode] = useState<"highest_production" | "perfect_fit">("highest_production");
  const [annualConsumptionOverride, setAnnualConsumptionOverride] = useState<number | undefined>(undefined);
  const [chartViewMode, setChartViewMode] = useState<"monthly" | "daily">("daily");
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
  const carbonBarTrackRef = useRef<HTMLDivElement>(null);
  const [carbonBarSegments, setCarbonBarSegments] = useState(80);

  useLayoutEffect(() => {
    const el = carbonBarTrackRef.current;
    if (!el) return;
    const apply = (width: number) => {
      setCarbonBarSegments(carbonBarStickCountForWidth(width));
    };
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      apply(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    if (prospect?.configurationMode) setConfigurationMode(prospect.configurationMode);
    if (prospect?.annualConsumptionKwhOverride != null) setAnnualConsumptionOverride(prospect.annualConsumptionKwhOverride);
    if (prospect != null) setIncludeBatteryLocal(prospect.includeBatteryOverride ?? getSolarEquipmentSettings().includeBattery ?? true);
    if (prospect?.batteryReferenceId) setSelectedBatteryId(prospect.batteryReferenceId);
    if (prospect?.batteryCount != null && prospect.batteryCount >= 1) setSelectedBatteryCount(prospect.batteryCount);
  }, [prospect?.configurationMode, prospect?.annualConsumptionKwhOverride, prospect?.includeBatteryOverride, prospect?.batteryReferenceId, prospect?.batteryCount, prospect]);

  /** production = productionPerKwp × kWp. kWp = surfaceToKwp(surface). */
  const effectiveConfig = useMemo(() => {
    const surfaceM2 = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    const panelRef = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const legacyKwp = (prospect?.solarPotential?.maxArrayAreaMeters2 ?? 0) > 0
      ? surfaceToKwp(prospect!.solarPotential!.maxArrayAreaMeters2!, undefined, undefined, panelRef)
      : undefined;
    const perKwp = getProductionPerKwpFromSolarPotential(prospect?.solarPotential, legacyKwp);
    const placeType = prospect?.placeType || "other";
    const consoFromType = getEnergyConsumption(placeType) * surfaceM2;
    const consoAnnuelleKwh = annualConsumptionOverride ?? consoFromType;

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
  }, [prospect, configurationMode, annualConsumptionOverride, usedPanelRef]);

  const recommendedBatteryKwh = useMemo(() => {
    const totalArea = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    if (!prospect || totalArea <= 0) return null;
    const effectiveKwp = effectiveConfig.effectiveKwp;
    const hasProductionData = effectiveConfig.productionPerKwp != null;
    if (!hasProductionData || effectiveKwp <= 0) return null;
    const placeType = prospect.placeType || "other";
    const annualConsumptionKwh =
      annualConsumptionOverride ?? getEnergyConsumption(placeType) * totalArea;
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
  }, [prospect, annualConsumptionOverride, effectiveConfig.effectiveAnnualProductionKwh, effectiveConfig.effectiveKwp, effectiveConfig.productionPerKwp]);

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
  }, [prospect?.id]);

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
    const surfaceM2 = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    const panelRef = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const inverterRef = usedInverterRef ?? getRecommendedInverterReferenceSync();
    const placeType = prospect?.placeType || "other";
    const consoFromType = getEnergyConsumption(placeType) * surfaceM2;
    const consoAnnuelleKwh = annualConsumptionOverride ?? consoFromType;
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
  }, [prospect, annualConsumptionOverride, usedPanelRef, usedInverterRef]);

  const effectiveInverterCount = configurationMode === "perfect_fit"
    ? choiceCardsConfig.perfectFit.inverterCount
    : choiceCardsConfig.highestProduction.inverterCount;

  const surfaceM2 = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
  const placeType = prospect?.placeType || "other";
  const consoFromType = getEnergyConsumption(placeType) * surfaceM2;
  const consoAnnuelleKwh = annualConsumptionOverride ?? consoFromType;
  const energyBillEur = estimateEnergyBillEur(consoAnnuelleKwh);
  const displayEnergyBillEur = energyBillEurOverride ?? energyBillEur;

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
      const consumptionTypicalDayByMonth = Array.from({ length: 12 }, (_, m) =>
        buildTypicalConsumptionDayForMonth(placeType, m, surfaceM2)
      );
      const scaledBattery = includeBatteryEffective && usedBatteryRef
        ? scaleBatteryForCount(usedBatteryRef, selectedBatteryCount)
        : null;
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
        consoAnnuelleKwh
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
  }, [prospect, surfaceM2, placeType, consoAnnuelleKwh, configurationMode, effectiveConfig, usedPanelRef, usedInverterRef, usedBatteryRef, selectedBatteryCount, includeBatteryEffective]);

  const chartData = useMemo(() => {
    if (!effectiveConfig.productionPerKwp) return [];
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
  }, [effectiveConfig.productionPerKwp, effectiveConfig.effectiveKwp, financialSummary?.batteryByMonth, placeType, surfaceM2]);

  const chartDailyData = useMemo(() => {
    if (!effectiveConfig.productionPerKwp) return undefined;
    const prodDay = buildTypicalDayForMonth(
      effectiveConfig.productionPerKwp.productionPerKwpMonthly,
      chartSelectedMonthIndex,
      effectiveConfig.effectiveKwp
    );
    const consDay = buildTypicalConsumptionDayForMonth(placeType, chartSelectedMonthIndex, surfaceM2);
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
  ]);

  const annualSavings = financialSummary?.annualSavings ?? 0;
  const selfConsumptionDirectKwhTotal = financialSummary?.selfConsumptionDirectKwhTotal ?? 0;
  const selfConsumptionViaBatteryKwhTotal = financialSummary?.selfConsumptionViaBatteryKwhTotal ?? 0;
  const injectionReseauKwhTotal = financialSummary?.injectionReseauKwhTotal ?? 0;
  const annualGridDrawKwh = financialSummary?.annualGridDrawKwh ?? 0;
  const breakdownFromHourlySim = financialSummary?.breakdownFromHourlySim ?? false;
  const priceRange = financialSummary?.priceRange ?? { equipmentEur: 0, totalMinEur: 0, totalMaxEur: 0 };
  const breakEvenMin = financialSummary?.breakEvenMin ?? null;
  const breakEvenMax = financialSummary?.breakEvenMax ?? null;
  const breakEvenLabel =
    breakEvenMin != null && breakEvenMax != null
      ? breakEvenMin === breakEvenMax
        ? `${breakEvenMin} an${breakEvenMin > 1 ? "s" : ""}`
        : `${breakEvenMin} – ${breakEvenMax} ans`
      : "—";

  const effectiveRetailPricePerKwh = useMemo(
    () => effectiveRetailPriceEurPerKwhFromBill(consoAnnuelleKwh, displayEnergyBillEur),
    [consoAnnuelleKwh, displayEnergyBillEur]
  );

  const formatPower = (powerW: number) => {
    if (!Number.isFinite(powerW)) return "—";
    if (powerW >= 1000) return `${(powerW / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}kW`;
    return `${Math.round(powerW)}W`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!prospect) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4">
        <Card className="max-w-md w-full">
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

  const productionGwh = effectiveConfig.effectiveAnnualProductionKwh > 0
    ? effectiveConfig.effectiveAnnualProductionKwh / 1_000_000
    : 0;
  const selfConsumptionPct = consoAnnuelleKwh > 0
    ? Math.min(
        100,
        Math.max(
          0,
          ((selfConsumptionDirectKwhTotal + selfConsumptionViaBatteryKwhTotal) / consoAnnuelleKwh) * 100
        )
      )
    : 0;
  const carbonReductionPct = selfConsumptionPct;
  const FR_AVG_CARBON_INTENSITY_G_PER_KWH = 55;
  const baselineCarbonKgPerYear = (consoAnnuelleKwh * FR_AVG_CARBON_INTENSITY_G_PER_KWH) / 1000;
  const avoidedCarbonKgPerYear = (baselineCarbonKgPerYear * carbonReductionPct) / 100;
  const avoidedCarbonTons = avoidedCarbonKgPerYear / 1000;

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      <div className="max-w-5xl mx-auto p-4 sm:p-5 flex flex-col w-full gap-4">
        {/* Barre admin : visible uniquement pour le compte ayant généré la page */}
        {isOwner && (
          <div className="flex items-center justify-between shrink-0">
            <Button
              variant="default"
              size="icon"
              className="h-9 w-9 shrink-0 border-0 bg-zinc-100 text-zinc-700 shadow-none transition-[background-color,transform] duration-150 ease-out hover:bg-zinc-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/10 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50"
              asChild
            >
              <Link href="/" title="Retour" aria-label="Retour">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="default"
              size="icon"
              className="h-9 w-9 shrink-0 border-0 bg-zinc-100 text-zinc-700 shadow-none transition-[background-color,transform] duration-150 ease-out hover:bg-zinc-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/10 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50"
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
            <div className="rounded-xl border border-zinc-200 bg-white shadow-xs p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
                Sommaire
              </p>
              <div className="flex flex-row md:flex-col gap-2 md:gap-1 text-sm">
                {[
                  { id: "recap", label: "Recap" },
                  { id: "projet", label: "Projet" },
                  { id: "finance", label: "Finance" },
                  { id: "contact", label: "Contact" },
                ].map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="rounded-md px-2 py-1 text-zinc-700 transition-[background-color,transform] duration-150 ease-out text-xs font-medium hover:bg-zinc-100 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/10 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
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
                className="mt-2 group flex items-center gap-2 rounded-xl border border-zinc-200 bg-white shadow-xs px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/10 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50"
              >
                <span className="relative size-7 shrink-0 overflow-hidden rounded-full bg-zinc-200">
                  {commercialReferent.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={commercialReferent.photoURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <User className="size-3.5 text-zinc-500" />
                    </span>
                  )}
                </span>
                <span className="flex-1 min-w-0 truncate">Contacter</span>
                <ArrowUpRight className="size-3.5 text-zinc-500 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            ) : null}
          </nav>

          <div className="min-w-0 flex flex-col gap-10 py-1">
            <section id="recap" className="scroll-mt-24">
              <div
                className="relative mb-4 h-[240px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-900/5"
                style={{
                  backgroundImage: "url(/images/recap-hero.png)",
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              >
                <div className="absolute top-4 right-4">
                  <div className="size-14 rounded-xl border border-zinc-200 bg-white/70 backdrop-blur-sm shadow-xs overflow-hidden">
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
                        <span className="text-xs font-semibold text-zinc-700">
                          {(portalCompanyName?.trim()?.[0] ?? "—").toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="relative h-full flex flex-col justify-end p-6">
                  <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-white drop-shadow-sm">
                    Hello <span aria-hidden>👋</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-white/80 drop-shadow-sm">
                    Welcome to the {portalCompanyName} Portal
                  </p>
                </div>
              </div>

              {/* Carte projet (au-dessus des KPI) */}
              <div className="">
                <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[140px_1fr] gap-4">
                  <figure className="rounded-xl overflow-hidden w-[110px] sm:w-[140px] aspect-square max-w-full">
                    {prospect.coordinates ? (
                      <SatelliteImage
                        key={`sat-recap-${imageCenter.lat}-${imageCenter.lng}`}
                        coordinates={imageCenter}
                        address={prospect.address}
                        zoom={17}
                        width={160}
                        height={160}
                        className="w-full h-full object-cover"
                        showOverlays={false}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-zinc-400" />
                      </div>
                    )}
                  </figure>

                  <div className="min-w-0 flex flex-col">
                    <p className="text-sm text-zinc-900 font-medium">
                      {prospect.name || prospect.address}
                    </p>
                    {prospect.address && (
                      <p className="text-xs text-zinc-500 mt-1 truncate">{prospect.address}</p>
                    )}

                    <dl className="mt-3 grid gap-2">
                      <div className="grid grid-cols-[72px_1fr] items-baseline gap-x-3 gap-y-1 min-w-0">
                        <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Type</dt>
                        <dd className="text-[11px] text-zinc-800 min-w-0">
                          {translatePlaceType(prospect.placeType)}
                        </dd>

                        <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Surface</dt>
                        <dd className="text-[11px] text-zinc-800 tabular-nums">
                          {surfaceM2.toFixed(0)} m²
                        </dd>

                        <dt className="text-[10px] uppercase tracking-wide text-zinc-500" title="Année de construction (BDNB)">
                          Année
                        </dt>
                        <dd className="text-[11px] text-zinc-800 tabular-nums">
                          {prospect.anneeConstruction != null ? String(prospect.anneeConstruction) : "—"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl bg-zinc-100 py-3 px-4 min-h-[110px] flex flex-col justify-between">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Économies</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-2xl font-semibold tabular-nums text-zinc-900 leading-none">
                      {annualSavings.toLocaleString("fr-FR")}
                      <span className="text-zinc-400 font-light ml-1">€</span>
                    </p>
                    <span className="text-[11px] text-zinc-500 leading-none">/ an</span>
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-100 py-3 px-4 min-h-[110px] flex flex-col justify-between">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Rentabilité</p>
                  {(() => {
                    const label = breakEvenLabel;
                    const match = typeof label === "string" ? label.match(/^(.*?)(?:\s*(ans?))$/i) : null;
                    const valuePart = match?.[1]?.trim() || label;
                    const unitPart = match?.[2] || null;
                    return (
                      <div className="flex items-baseline gap-2">
                        <p className="text-2xl font-semibold tabular-nums text-zinc-900 leading-none">
                          {valuePart}
                        </p>
                        {unitPart ? (
                          <span className="text-[11px] text-zinc-500 leading-none">{unitPart}</span>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
                <div className="rounded-xl bg-zinc-100 py-3 px-4 min-h-[110px] flex flex-col justify-between">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Autoconsommation</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-2xl font-semibold tabular-nums text-zinc-900 leading-none">
                      {selfConsumptionPct.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}
                      <span className="text-zinc-400 font-light ml-1">%</span>
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section id="projet" className="scroll-mt-32">
              <div className="flex items-end justify-between gap-4 mb-3">
                <h2 className="text-lg font-semibold text-zinc-900">Projet</h2>
              </div>

              {/* Graphique + boutons (système) */}
              {(prospect.solarPotential?.productionPerKwpMonthly?.length || prospect.solarPotential?.monthlyProduction?.length) && surfaceM2 > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        pendingBatteryResyncAfterModeChangeRef.current = true;
                        setConfigurationMode("perfect_fit");
                      }}
                      className={`cursor-pointer rounded-xl px-4 py-4 text-left h-full flex flex-col justify-between overflow-hidden transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0000FF33] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 ${
                        configurationMode === "perfect_fit"
                          ? "border border-[#0000FF33] bg-[#0000FF0D] shadow-xs"
                          : "border border-transparent bg-zinc-100 hover:bg-zinc-200/70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Perfect fit</span>
                      </div>
                      <div className={`text-base font-normal mt-auto ${configurationMode === "perfect_fit" ? "text-[#0000FF]" : "text-zinc-700"}`}>
                        {choiceCardsConfig.perfectFit.kwp.toFixed(2)}
                        <span className={`text-sm font-light ml-0.5 ${configurationMode === "perfect_fit" ? "text-[#0000FF]" : "text-zinc-400"}`}>kWp</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        pendingBatteryResyncAfterModeChangeRef.current = true;
                        setConfigurationMode("highest_production");
                      }}
                      className={`cursor-pointer rounded-xl px-4 py-4 text-left h-full flex flex-col justify-between overflow-hidden transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0000FF33] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 ${
                        configurationMode === "highest_production"
                          ? "border border-[#0000FF33] bg-[#0000FF0D] shadow-xs"
                          : "border border-transparent bg-zinc-100 hover:bg-zinc-200/70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Highest production</span>
                      </div>
                      <div className={`text-base font-normal mt-auto ${configurationMode === "highest_production" ? "text-[#0000FF]" : "text-zinc-700"}`}>
                        {choiceCardsConfig.highestProduction.kwp.toFixed(2)}
                        <span className={`text-sm font-light ml-0.5 ${configurationMode === "highest_production" ? "text-[#0000FF]" : "text-zinc-400"}`}>kWp</span>
                      </div>
                    </button>
                  </div>

                  <div className="h-[360px] bg-zinc-100 rounded-xl py-3 px-4 pb-2 flex flex-col overflow-hidden">
                    <div className="flex flex-col gap-1.5 mb-2 shrink-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wide text-zinc-500">Production</span>
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
                              chartViewMode === "monthly" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Mensuel
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={chartViewMode === "daily"}
                            onClick={() => setChartViewMode("daily")}
                            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                              chartViewMode === "daily" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Journalier
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 flex flex-col">
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
                </div>
              )}

              {/* Sous le graphe : 2 colonnes (finance à gauche, équipement à droite) */}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[280px] items-stretch">
                <div className="bg-zinc-100 rounded-xl py-3 px-4 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500">Réduction de facture</span>
                  </div>
                  <div className="mb-4">
                    {displayEnergyBillEur > 0 ? (
                      (() => {
                        const bill = displayEnergyBillEur;
                        const savingsPctRaw = bill > 0 ? (annualSavings / bill) * 100 : 0;
                        const savingsPct = Math.min(100, Math.max(0, savingsPctRaw));

                        const directEur = selfConsumptionDirectKwhTotal * DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH;
                        const viaBatteryEur = selfConsumptionViaBatteryKwhTotal * DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH;
                        const injectionEur = injectionReseauKwhTotal * DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH;
                        const totalParts = directEur + viaBatteryEur + injectionEur;

                        const partPct = (part: number) => (totalParts > 0 ? (part / totalParts) * 100 : 0);
                        const pctBattery = partPct(viaBatteryEur);
                        const pctDirect = partPct(directEur);
                        const pctInjection = Math.max(0, 100 - pctBattery - pctDirect);

                        return (
                          <div className="flex flex-col gap-3">
                            <div className="flex items-end justify-between gap-3">
                              <div className="text-3xl font-semibold tabular-nums text-zinc-900 leading-none shrink-0">
                                -{Math.round(savingsPct)}%
                              </div>
                            </div>

                            <div className="w-full h-2.5 rounded-full bg-zinc-200 overflow-hidden flex">
                              {savingsPct > 0 && totalParts > 0 ? (
                                <div className="h-full flex shrink-0" style={{ width: `${savingsPct}%` }}>
                                  <div className="h-full bg-[#0000FF] shrink-0" style={{ width: `${pctBattery}%` }} title="Autoconsommation batterie" />
                                  <div className="h-full bg-[#4B5563] shrink-0" style={{ width: `${pctDirect}%` }} title="Autoconsommation directe" />
                                  <div className="h-full bg-[#32F490] shrink-0 flex-1" title="Injection réseau" />
                                </div>
                              ) : savingsPct > 0 ? (
                                <div className="h-full bg-zinc-500" style={{ width: `${savingsPct}%` }} />
                              ) : null}
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="text-3xl font-semibold tabular-nums text-zinc-900 leading-none">—</div>
                    )}
                  </div>
                  <div className="flex flex-col gap-3 text-xs">
                    <Separator className="bg-zinc-200/70" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs sm:text-sm font-normal text-zinc-600 truncate">Est. Energy bill</span>
                      <button
                        type="button"
                        onClick={() => setEnergyBillDialogOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded px-1 -mx-1 py-0.5 -my-0.5 text-left cursor-pointer shrink-0 tabular-nums text-xs sm:text-sm font-normal text-zinc-600 transition-[background-color,transform] duration-150 ease-out hover:bg-zinc-200/60 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/10 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-100"
                        aria-label="Modifier la facture annuelle"
                      >
                        <Pencil className="h-3 w-3 text-zinc-400 shrink-0" />
                        {displayEnergyBillEur.toLocaleString("fr-FR")}
                        <span className="text-zinc-400 ml-0.5 font-light">€</span>
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs sm:text-sm font-normal text-zinc-600 truncate">Savings</span>
                      <span className="text-xs sm:text-sm font-normal text-zinc-600 shrink-0 tabular-nums">
                        {annualSavings.toLocaleString("fr-FR")}
                        <span className="text-zinc-400 ml-0.5 font-light">€</span>
                      </span>
                    </div>
                    {(() => {
                      const directEur = selfConsumptionDirectKwhTotal * DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH;
                      const viaBatteryEur = selfConsumptionViaBatteryKwhTotal * DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH;
                      const injectionEur = injectionReseauKwhTotal * DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH;
                      const totalParts = directEur + viaBatteryEur + injectionEur;
                      if (!Number.isFinite(totalParts) || totalParts <= 0) return null;
                      return (
                        <div className="mt-2 flex flex-col gap-1.5 text-[11px] text-zinc-600">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="h-2 w-2 rounded-full shrink-0 bg-[#0000FF]" aria-hidden />
                              <span className="truncate">Autoconsommation batterie</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-zinc-700">
                              {Math.round(viaBatteryEur).toLocaleString("fr-FR")}€
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="h-2 w-2 rounded-full shrink-0 bg-[#4B5563]" aria-hidden />
                              <span className="truncate">Autoconsommation directe</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-zinc-700">
                              {Math.round(directEur).toLocaleString("fr-FR")}€
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="h-2 w-2 rounded-full shrink-0 bg-[#32F490]" aria-hidden />
                              <span className="truncate">Injection réseau</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-zinc-700">
                              {Math.round(injectionEur).toLocaleString("fr-FR")}€
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {(panelsData !== undefined || invertersData !== undefined || batteriesData !== undefined) && (
                  <div className="bg-zinc-100 rounded-xl py-3 px-4 overflow-auto">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-3">Équipement</div>
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

              <div className="relative mt-4 bg-zinc-100 rounded-xl py-3 px-4 overflow-hidden flex flex-col min-h-[134px]">
                <div
                  className="absolute top-3 right-4 pointer-events-none text-[#0000FF]"
                  aria-hidden
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 125 125"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="shrink-0"
                  >
                    <rect
                      x="-2.21883"
                      y="2.21883"
                      width="58.6085"
                      height="58.6085"
                      transform="matrix(-0.116186 0.993227 -0.993227 0.116186 96.6408 31.6199)"
                      stroke="currentColor"
                      strokeWidth="2.75"
                    />
                    <path d="M64.0565 32.4581L66.2075 58.2295" stroke="currentColor" strokeWidth="2.75" />
                    <path d="M65.6705 58.184L91.4419 60.335" stroke="currentColor" strokeWidth="2.75" />
                    <path d="M46.8704 35.5688L50.0967 74.2236" stroke="currentColor" strokeWidth="2.75" />
                    <path d="M49.2914 74.156L87.9463 77.3823" stroke="currentColor" strokeWidth="2.75" />
                    <path d="M28.7041 95.6704L93.7041 30.6704" stroke="currentColor" strokeWidth="2.75" />
                  </svg>
                </div>
                <div className="flex items-start justify-between gap-3 pr-12">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                      Impact carbon
                    </div>
                  </div>
                </div>

                <div className="w-full mt-auto pt-3 flex flex-col items-start gap-0">
                  <div className="text-lg font-semibold tabular-nums leading-none text-[#0000FF] text-left">
                    {avoidedCarbonTons.toLocaleString("fr-FR", {
                      maximumFractionDigits: 2,
                      minimumFractionDigits: 0,
                    })}{" "}
                    t CO₂e
                  </div>
                  <div className="mt-1 flex h-9 w-full items-end gap-[3px]">
                    <div
                      ref={carbonBarTrackRef}
                      className="relative grid h-9 w-full min-w-0 shrink-0 items-stretch"
                      style={{
                        gap: CARBON_BAR_GAP_PX,
                        gridTemplateColumns: `repeat(${carbonBarSegments}, minmax(0, 1fr))`,
                      }}
                      aria-hidden
                    >
                      {Array.from({ length: carbonBarSegments }, (_, i) => {
                        const pct = Math.min(100, Math.max(0, carbonReductionPct));
                        const fillEnd = (pct / 100) * carbonBarSegments;
                        const isFilled = i < fillEnd;
                        return (
                          <div
                            key={i}
                            className={
                              isFilled
                                ? "h-full min-w-0 w-full rounded-full bg-[#0000FF]"
                                : "h-full min-w-0 w-full rounded-full bg-zinc-400/95"
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section id="finance" className="scroll-mt-24">
              <div className="flex items-end justify-between gap-4 mb-3">
                <h2 className="text-lg font-semibold text-zinc-900">Finance</h2>
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
                    <div className="rounded-xl border border-zinc-200 bg-white p-4">
                      <p className="text-sm text-zinc-600">
                        Données ROI indisponibles pour ce projet.
                      </p>
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
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {([
                        { id: "capex", title: "CAPEX" },
                        { id: "lease", title: "Lease" },
                        { id: "ppa", title: "PPA" },
                      ] satisfies Array<{ id: FinancingMode; title: string }>).map((item) => {
                        const selected = financingMode === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setFinancingMode(item.id)}
                            className={`cursor-pointer rounded-xl px-4 py-4 text-left h-full flex flex-col justify-center overflow-hidden transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0000FF33] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 ${
                              selected
                                ? "border border-[#0000FF33] bg-[#0000FF0D] shadow-xs"
                                : "border border-transparent bg-zinc-100 hover:bg-zinc-200/70"
                            }`}
                            aria-pressed={selected}
                          >
                            <div
                              className={`text-base font-normal uppercase ${selected ? "text-[#0000FF]" : "text-zinc-700"}`}
                            >
                              {item.title}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 h-[360px] bg-zinc-100 rounded-xl py-3 px-4 pb-2 flex flex-col overflow-hidden">
                      <div className="flex flex-col gap-1.5 mb-2 shrink-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] uppercase tracking-wide text-zinc-500">
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
                                      className="inline-flex items-center justify-center rounded-md p-1 text-zinc-400 transition-colors hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/10"
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
                                      className="inline-flex items-center justify-center rounded-md p-1 text-zinc-400 transition-colors hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/10"
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
                  </>
                );
              })()}
            </section>

            <section id="contact" className="scroll-mt-24">
              <div className="flex items-end justify-between gap-4 mb-3">
                <h2 className="text-lg font-semibold text-zinc-900">Contact</h2>
              </div>
              {commercialReferent && (commercialReferent.name || commercialReferent.email || commercialReferent.phone) ? (
                <div className="flex min-h-[200px] min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                  <div className="flex w-full items-center justify-between">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      Votre référent
                    </p>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      Disponible
                    </span>
                  </div>
                  <div className="relative mx-auto mt-3 size-24 shrink-0 overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-600">
                    {commercialReferent.photoURL ? (
                      <img src={commercialReferent.photoURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <User className="size-8 text-zinc-400" />
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex w-full flex-1 flex-col gap-1.5 text-center">
                    {commercialReferent.name && (
                      <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {commercialReferent.name}
                      </p>
                    )}
                    {(commercialReferent.logoUrl || commercialReferent.company) && (
                      <div className="flex items-center justify-center gap-2">
                        {commercialReferent.logoUrl && (
                          <div className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-200 bg-white dark:border-zinc-600 dark:bg-zinc-800">
                            <img src={commercialReferent.logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
                          </div>
                        )}
                        <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                          {commercialReferent.company || "Entreprise"}
                        </p>
                      </div>
                    )}
                    <div className="mt-auto flex gap-2 pt-2">
                      {commercialReferent.phone ? (
                        <a
                          href={`tel:${commercialReferent.phone.replace(/\s/g, "")}`}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-zinc-200 py-1.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
                        >
                          <Phone className="size-3 shrink-0" />
                          <span className="truncate">{commercialReferent.phone}</span>
                        </a>
                      ) : (
                        <span className="flex flex-1 items-center justify-center rounded-md bg-zinc-200 py-1.5 text-[11px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
                          —
                        </span>
                      )}
                      {commercialReferent.email ? (
                        <a
                          href={`mailto:${commercialReferent.email}`}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-zinc-900 py-1.5 text-[11px] font-medium text-white hover:bg-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                        >
                          <Mail className="size-3 shrink-0" />
                          Email
                        </a>
                      ) : (
                        <span className="flex flex-1 items-center justify-center rounded-md bg-zinc-300 py-1.5 text-[11px] text-zinc-500 dark:bg-zinc-600 dark:text-zinc-400">
                          —
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs">
                  <p className="text-sm text-zinc-600">Aucun contact configuré.</p>
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
