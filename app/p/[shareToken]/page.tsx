"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useParams } from "next/navigation";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { User, Phone, Mail, Building2, Loader2, ArrowLeft, Link2, Battery } from "lucide-react";
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
import { runBatterySimulation, runBatterySimulationOneDayWithCarryOver } from "@/lib/battery-simulation";
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
  estimateAnnualSavingsEur,
  estimateAnnualSavingsEurWithBattery,
  estimateEnergyBillEur,
  getBreakEvenYears,
} from "@/lib/solar-settings";
import { MonthlyProductionChart } from "@/components/solar-scout/MonthlyProductionChart";
import type { Prospect, PanelReference, InverterReference, BatteryReference } from "@/types";
import { toast } from "sonner";

export default function ProspectSharePage() {
  const params = useParams();
  const { user } = useAuth();
  const shareToken = (params?.shareToken as string) ?? null;
  const { data: prospectData } = useProspectByShareToken(shareToken);
  const prospect = prospectData ?? null;
  const ownerUserId = prospect?.userId ?? null;
  const { data: panelsData } = usePanelReferences(ownerUserId);
  const { data: invertersData } = useInverterReferences(ownerUserId);
  const { data: batteriesData } = useBatteryReferences(ownerUserId);
  const loading = prospectData === undefined && shareToken != null;
  const [configurationMode, setConfigurationMode] = useState<"highest_production" | "perfect_fit">("highest_production");
  const [annualConsumptionOverride, setAnnualConsumptionOverride] = useState<number | undefined>(undefined);
  const [chartViewMode, setChartViewMode] = useState<"monthly" | "daily">("monthly");
  const [chartSelectedMonthIndex, setChartSelectedMonthIndex] = useState(0);
  const [includeBatteryLocal, setIncludeBatteryLocal] = useState<boolean>(true);

  const usedPanelRef =
    panelsData?.find((r) => r.recommended) ?? panelsData?.[0] ?? getRecommendedPanelReferenceSync();
  const usedInverterRef =
    invertersData?.find((r) => r.recommended) ?? invertersData?.[0] ?? getRecommendedInverterReferenceSync();
  const usedBatteryRef: BatteryReference | null =
    batteriesData?.find((r) => r.recommended) ?? batteriesData?.[0] ?? getRecommendedBatteryReferenceSync();
  const includeBatteryEffective = includeBatteryLocal;

  useEffect(() => {
    if (prospect?.configurationMode) setConfigurationMode(prospect.configurationMode);
    if (prospect?.annualConsumptionKwhOverride != null) setAnnualConsumptionOverride(prospect.annualConsumptionKwhOverride);
    if (prospect != null) setIncludeBatteryLocal(prospect.includeBatteryOverride ?? getSolarEquipmentSettings().includeBattery ?? true);
  }, [prospect?.configurationMode, prospect?.annualConsumptionKwhOverride, prospect?.includeBatteryOverride, prospect]);

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

  const financialSummary = useMemo(() => {
    if (!prospect || surfaceM2 <= 0) return null;
    const recommendedPanel = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const recommendedInverter = usedInverterRef ?? getRecommendedInverterReferenceSync();
    const panelCount = effectiveConfig.effectivePanelCount;
    const totalPowerKW = effectiveConfig.effectiveKwp;
    const inverterCount = calculateInverterCount(totalPowerKW, recommendedInverter);
    let equipmentEur: number;
    let annualSavings: number;
    let batteryByMonth: { selfConsumptionDirectKwh: number; selfConsumptionViaBatteryKwh: number; injectionBatteryKwh: number; injectionReseauKwh: number; excessKwh: number; gridDrawKwh: number }[] | undefined;
    if (includeBatteryEffective && usedBatteryRef && effectiveConfig.productionPerKwp?.productionPerKwpMonthly?.length === 12) {
      const productionTypicalDayByMonth = Array.from({ length: 12 }, (_, m) =>
        buildTypicalDayForMonth(effectiveConfig.productionPerKwp!.productionPerKwpMonthly, m, totalPowerKW)
      );
      const consumptionTypicalDayByMonth = Array.from({ length: 12 }, (_, m) =>
        buildTypicalConsumptionDayForMonth(placeType, m, surfaceM2)
      );
      const simulationResult = runBatterySimulation({
        productionTypicalDayByMonth,
        consumptionTypicalDayByMonth,
        battery: usedBatteryRef,
      });
      annualSavings = estimateAnnualSavingsEurWithBattery(simulationResult);
      equipmentEur = estimateInstallationPriceEur(
        panelCount,
        inverterCount,
        recommendedPanel,
        recommendedInverter,
        usedBatteryRef
      );
      batteryByMonth = simulationResult.byMonth;
    } else {
      annualSavings = estimateAnnualSavingsEur(effectiveConfig.effectiveAnnualProductionKwh, undefined, consoAnnuelleKwh);
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
    return { equipmentEur, priceRange, annualSavings, breakEvenMin, breakEvenMax, batteryByMonth };
  }, [prospect, surfaceM2, placeType, consoAnnuelleKwh, effectiveConfig, usedPanelRef, usedInverterRef, usedBatteryRef, includeBatteryEffective]);

  const annualSavings = financialSummary?.annualSavings ?? 0;
  const priceRange = financialSummary?.priceRange ?? { equipmentEur: 0, totalMinEur: 0, totalMaxEur: 0 };
  const breakEvenMin = financialSummary?.breakEvenMin ?? null;
  const breakEvenMax = financialSummary?.breakEvenMax ?? null;
  const breakEvenLabel =
    breakEvenMin != null && breakEvenMax != null
      ? breakEvenMin === breakEvenMax
        ? `${breakEvenMin} an${breakEvenMin > 1 ? "s" : ""}`
        : `${breakEvenMin} – ${breakEvenMax} ans`
      : "—";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!prospect) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="max-w-7xl mx-auto p-4 sm:p-5 flex flex-col w-full gap-4">
        {/* Barre admin : visible uniquement pour le compte ayant généré la page */}
        {isOwner && (
          <div className="flex items-center justify-between shrink-0">
            <Button variant="secondary" size="icon" className="h-9 w-9 shrink-0" asChild>
              <Link href="/" title="Retour" aria-label="Retour">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={copyShareLink}
              title="Copier le lien"
              aria-label="Copier le lien"
            >
              <Link2 className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Grille bento : 3 colonnes × 8 lignes ; mobile : compact (hauteur contenu), md : hauteur fixe (pas adaptée à l'écran) */}
        <div className="grid grid-cols-1 md:grid-cols-3 md:grid-rows-8 gap-2 sm:gap-3 md:gap-4 w-full auto-rows-min md:auto-rows-fr md:h-[720px] shrink-0">
          {/* [1,1] Logo + Nom entreprise — 1 ligne (au-dessus de la carte) */}
          {commercialReferent && (commercialReferent.logoUrl || commercialReferent.company) && (
            <div className="order-1 flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-xs min-h-0 overflow-hidden md:order-none md:col-start-1 md:row-start-1">
              {commercialReferent.logoUrl && (
                <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
                  <img src={commercialReferent.logoUrl} alt="" className="h-full w-full object-contain p-1" />
                </div>
              )}
              <p className="font-medium text-zinc-800 truncate">
                {commercialReferent.company || "Entreprise"}
              </p>
            </div>
          )}

          {/* [1,2-4] ou [1,1-3] Carte adresse / type / surface / orientation */}
          <div
            className={`order-2 min-h-0 flex flex-col overflow-hidden md:order-none md:col-start-1 md:row-span-3 ${
              commercialReferent && (commercialReferent.logoUrl || commercialReferent.company)
                ? "md:row-start-2"
                : "md:row-start-1"
            }`}
          >
            <Card className="bg-black border-0 text-white overflow-hidden rounded-xl h-full flex flex-col">
              <CardContent className="p-4 flex-1 flex flex-col justify-start">
                <div className="mb-3">
                  <h1 className="text-xl font-semibold truncate">{prospect.name || prospect.address}</h1>
                  {prospect.address && (
                    <p className="text-sm text-white/80 truncate mt-1">{prospect.address}</p>
                  )}
                </div>
                <div className="rounded-lg px-3 py-2 bg-white/10 flex gap-4">
                  <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-white/60">Type</span>
                    <div className="px-3 py-1.5 rounded-md text-[10px] uppercase text-white/80 min-w-fit">
                      {translatePlaceType(prospect.placeType)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-white/60">Surface</span>
                    <div className="px-3 py-1.5 rounded-md text-[10px] uppercase text-white/80 min-w-fit">
                      {surfaceM2.toFixed(0)} m²
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-white/60" title="Année de construction (BDNB)">Année</span>
                    <div className="px-3 py-1.5 rounded-md text-[10px] uppercase text-white/80 min-w-fit">
                      {prospect.anneeConstruction != null ? String(prospect.anneeConstruction) : "—"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* [2,1] Perfect fit / Highest production */}
          {(prospect.solarPotential?.productionPerKwpMonthly?.length || prospect.solarPotential?.monthlyProduction?.length) && surfaceM2 > 0 && (
            <div className="order-3 grid grid-cols-2 gap-2 min-h-0 overflow-hidden md:order-none md:col-start-2 md:row-start-1">
              <button
                type="button"
                onClick={() => setConfigurationMode("perfect_fit")}
                className={`rounded-xl px-4 py-4 text-left transition-colors h-full flex flex-col justify-between overflow-hidden ${
                  configurationMode === "perfect_fit"
                    ? "border border-blue-200 bg-blue-50 shadow-xs"
                    : "border border-transparent bg-gray-100 hover:bg-gray-200/80"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">Perfect fit</span>
                </div>
                <div className={`text-base font-normal mt-auto ${configurationMode === "perfect_fit" ? "text-blue-600" : "text-gray-700"}`}>
                  {choiceCardsConfig.perfectFit.kwp.toFixed(2)}
                  <span className={`text-sm font-light ml-0.5 ${configurationMode === "perfect_fit" ? "text-blue-500" : "text-gray-400"}`}>kWp</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setConfigurationMode("highest_production")}
                className={`rounded-xl px-4 py-4 text-left transition-colors h-full flex flex-col justify-between overflow-hidden ${
                  configurationMode === "highest_production"
                    ? "border border-blue-200 bg-blue-50 shadow-xs"
                    : "border border-transparent bg-gray-100 hover:bg-gray-200/80"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">Highest production</span>
                </div>
                <div className={`text-base font-normal mt-auto ${configurationMode === "highest_production" ? "text-blue-600" : "text-gray-700"}`}>
                  {choiceCardsConfig.highestProduction.kwp.toFixed(2)}
                  <span className={`text-sm font-light ml-0.5 ${configurationMode === "highest_production" ? "text-blue-500" : "text-gray-400"}`}>kWp</span>
                </div>
              </button>
            </div>
          )}

          {/* [3,1] Prix projet estimé */}
          <div className="order-6 rounded-xl px-4 py-4 min-h-0 flex flex-col justify-between bg-gray-100 overflow-hidden md:order-none md:col-start-2 md:row-start-7 md:row-span-2 md:min-h-[100px]">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Estimated project price</span>
              <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" title="Fourchette du coût total d'installation" />
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-gray-500">{breakEvenLabel}</div>
              <div className="text-2xl font-normal text-gray-700">
                {priceRange.totalMinEur.toLocaleString("fr-FR")} – {priceRange.totalMaxEur.toLocaleString("fr-FR")}
                <span className="text-sm font-light text-gray-400 ml-0.5">€</span>
              </div>
            </div>
          </div>

          {/* [1,5-8] Image satellite — span 4 rows */}
          {prospect.coordinates && (
            <div className="order-7 rounded-xl overflow-hidden border shadow-xs min-h-0 flex flex-col md:order-none md:col-start-1 md:row-start-5 md:row-span-4">
              <SatelliteImage
                key={`sat-${imageCenter.lat}-${imageCenter.lng}`}
                coordinates={imageCenter}
                address={prospect.address}
                zoom={17}
                width={600}
                height={320}
                className="w-full h-full min-h-[140px] md:min-h-[180px] object-cover"
                showOverlays={false}
              />
            </div>
          )}

          {/* [2,2-5] Graphique production — 4 lignes */}
          {(prospect.solarPotential?.productionPerKwpMonthly?.length || prospect.solarPotential?.monthlyProduction?.length) && surfaceM2 > 0 && (
            <div className="order-4 min-h-[280px] bg-gray-100 rounded-xl py-3 px-4 pb-2 flex flex-col overflow-hidden h-full max-h-[260px] md:max-h-none md:order-none md:col-start-2 md:row-start-2 md:row-span-4 md:min-h-0">
              <div className="flex flex-col gap-1.5 mb-2 shrink-0">
                {/* Ligne 1 : label Production + onglets */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">Production</span>
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
                {/* Ligne 2 : les deux valeurs GWh côte à côte */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-gray-600">
                  {(() => {
                    if (chartViewMode === "daily" && effectiveConfig.productionPerKwp) {
                      const { dailyTypical } = getProductionFromPerKwp(
                        effectiveConfig.productionPerKwp.productionPerKwpAnnual,
                        effectiveConfig.productionPerKwp.productionPerKwpMonthly,
                        effectiveConfig.effectiveKwp
                      );
                      const dailyProductionKwh = dailyTypical.reduce((s, v) => s + (v ?? 0), 0);
                      const hourlyConsumptionPerM2 = getHourlyConsumptionProfileKwhPerM2(placeType);
                      const dailyConsumptionKwh = surfaceM2 * (hourlyConsumptionPerM2?.reduce((s, v) => s + (v ?? 0), 0) ?? 0);
                      const fmt = (kwh: number) => (kwh >= 1000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${Math.round(kwh)} kWh`);
                      return (
                        <>
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                            {fmt(dailyProductionKwh)} /j
                          </span>
                          <span className="flex items-center gap-1.5">
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
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                          {productionGwh >= 0.001 ? productionGwh.toFixed(3) : productionGwh.toFixed(6)} GWh
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" />
                          {consumptionGwh >= 0.001 ? consumptionGwh.toFixed(3) : consumptionGwh.toFixed(6)} GWh
                        </span>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                <MonthlyProductionChart
                  key={configurationMode}
                  viewMode={chartViewMode}
                  onViewModeChange={setChartViewMode}
                  selectedMonthIndex={chartSelectedMonthIndex}
                  onSelectedMonthIndexChange={setChartSelectedMonthIndex}
                  data={(() => {
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
                  })()}
                  dailyData={(() => {
                    if (!effectiveConfig.productionPerKwp) return undefined;
                    const prodDay = buildTypicalDayForMonth(
                      effectiveConfig.productionPerKwp.productionPerKwpMonthly,
                      chartSelectedMonthIndex,
                      effectiveConfig.effectiveKwp
                    );
                    const consDay = buildTypicalConsumptionDayForMonth(placeType, chartSelectedMonthIndex, surfaceM2);
                    if (financialSummary?.batteryByMonth && usedBatteryRef) {
                      const hourly = runBatterySimulationOneDayWithCarryOver(prodDay, consDay, usedBatteryRef);
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
                    }
                    return Array.from({ length: 24 }, (_, hour) => ({
                      hour,
                      production: prodDay[hour] ?? 0,
                      consumption: consDay[hour] ?? 0,
                    }));
                  })()}
                />
              </div>
            </div>
          )}

          {/* [2,6] Energy Bill + Savings — en dessous du bloc Production, une seule ligne de grille */}
          <div className="order-5 flex flex-row gap-2 min-h-0 overflow-hidden md:order-none md:col-start-2 md:row-start-6">
            <div className="rounded-xl px-4 py-3 flex flex-col justify-between bg-gray-100 flex-1 min-w-0 md:min-h-[80px]">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] uppercase tracking-wide text-gray-500">EST. Energy bill</span>
                <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" title="Facture énergétique annuelle estimée" />
              </div>
              <div className="text-xl font-normal text-gray-700">
                {energyBillEur.toLocaleString("fr-FR")}
                <span className="text-sm font-light text-gray-400 ml-0.5">€</span>
              </div>
            </div>
            <div className="rounded-xl px-4 py-3 flex flex-col justify-between bg-gray-100 flex-1 min-w-0 md:min-h-[80px]">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] uppercase tracking-wide text-gray-500">Savings</span>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="Économies annuelles estimées" />
              </div>
              <div className="text-xl font-normal text-gray-700">
                {annualSavings.toLocaleString("fr-FR")}
                <span className="text-sm font-light text-gray-400 ml-0.5">€</span>
              </div>
            </div>
          </div>

          {/* [3,2-3] Équipement — colonne 3, 2 lignes (panneau, onduleur, batterie) */}
          {(usedPanelRef || usedInverterRef || usedBatteryRef) && (
            <div className="order-8 bg-gray-100 rounded-xl py-3 px-4 min-h-0 overflow-auto md:order-none md:col-start-3 md:row-start-1 md:row-span-4">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-3">Équipement</div>
              <div className="space-y-2">
                {usedPanelRef && (
                  <div>
                    <div className="flex justify-end items-center gap-1.5 mb-1">
                      <span className="inline-flex items-center rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                      <span className="inline-flex items-center rounded-md bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">{effectiveConfig.effectivePanelCount}</span>
                    </div>
                    <div className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-stretch gap-3">
                      <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gray-100">
                        {usedPanelRef.imageUrl ? (
                          <Image src={usedPanelRef.imageUrl} alt={usedPanelRef.name} width={48} height={48} className="w-full h-full object-cover" unoptimized />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">—</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="font-semibold text-xs text-foreground truncate">{usedPanelRef.name}</div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-muted-foreground">
                          €{usedPanelRef.costEur} · {usedPanelRef.powerW}W
                          {usedPanelRef.warrantyYears != null && ` · ${usedPanelRef.warrantyYears}y`}
                          {usedPanelRef.countryCode && (
                            <>
                              <span className="text-muted-foreground/40">|</span>
                              <span className="inline-flex items-center shrink-0" title={usedPanelRef.countryOfOrigin}>
                                <img
                                  src={getCountryFlagUrl(usedPanelRef.countryCode)}
                                  alt=""
                                  className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50"
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
                      <span className="inline-flex items-center rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                      <span className="inline-flex items-center rounded-md bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">{effectiveInverterCount}</span>
                    </div>
                    <div className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-stretch gap-3">
                      <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gray-100">
                        {usedInverterRef.imageUrl ? (
                          <Image src={usedInverterRef.imageUrl} alt={usedInverterRef.name} width={48} height={48} className="w-full h-full object-cover" unoptimized />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">—</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="font-semibold text-xs text-foreground truncate">{usedInverterRef.name}</div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-muted-foreground">
                          €{usedInverterRef.costEur} · {usedInverterRef.powerW}W
                          {usedInverterRef.warrantyYears != null && ` · ${usedInverterRef.warrantyYears}y`}
                          {usedInverterRef.countryCode && (
                            <>
                              <span className="text-muted-foreground/40">|</span>
                              <span className="inline-flex items-center shrink-0" title={usedInverterRef.countryOfOrigin}>
                                <img
                                  src={getCountryFlagUrl(usedInverterRef.countryCode)}
                                  alt=""
                                  className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50"
                                />
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {usedBatteryRef && includeBatteryEffective && (
                  <div>
                    <div className="flex justify-end items-center gap-1.5 mb-1">
                      {usedBatteryRef.recommended && (
                        <span className="inline-flex items-center rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                      )}
                      <span className="inline-flex items-center rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800" title="Paramètres utilisés dans les calculs (injection / tirage batterie)">
                        Calculs
                      </span>
                    </div>
                    <div className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-stretch gap-3">
                      <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                        {usedBatteryRef.imageUrl ? (
                          <Image src={usedBatteryRef.imageUrl} alt={usedBatteryRef.name} width={48} height={48} className="w-full h-full object-cover" unoptimized />
                        ) : (
                          <Battery className="h-6 w-6 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="font-semibold text-xs text-foreground truncate">{usedBatteryRef.name}</div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-muted-foreground">
                          €{usedBatteryRef.costEur}
                          <span className="text-muted-foreground/40">·</span>
                          <span title="Capacité utilisée dans la simulation">{usedBatteryRef.capacityKwh} kWh</span>
                          {usedBatteryRef.warrantyYears != null && (
                            <>
                              <span className="text-muted-foreground/40">·</span>
                              <span>{usedBatteryRef.warrantyYears}y</span>
                            </>
                          )}
                          {usedBatteryRef.countryCode && (
                            <>
                              <span className="text-muted-foreground/40">|</span>
                              <span className="inline-flex items-center shrink-0" title={usedBatteryRef.countryOfOrigin}>
                                <img
                                  src={getCountryFlagUrl(usedBatteryRef.countryCode)}
                                  alt=""
                                  className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50"
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

          {/* Inclure / exclure batterie (même bloc que dans le drawer) */}
          {(prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0) > 0 && usedBatteryRef && (
            <div className="order-8 mt-2 md:mt-0 md:order-none md:col-start-3 md:row-start-5 flex h-full min-h-0">
              <div className="flex flex-1 items-center justify-between rounded-xl border border-border bg-white p-3 min-h-0">
                <div className="flex items-center gap-2">
                  <Battery className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Label htmlFor="share-include-battery" className="text-sm font-medium cursor-pointer">Inclure batterie</Label>
                </div>
                <Switch
                  id="share-include-battery"
                  className="shrink-0 data-[state=checked]:bg-[#0000FF]"
                  checked={includeBatteryLocal}
                  onCheckedChange={setIncludeBatteryLocal}
                />
              </div>
            </div>
          )}

          {/* [3,4-7] Référent — colonne 3, 4 lignes (design aligné sur IllustrationContactCard) */}
          {commercialReferent && (commercialReferent.name || commercialReferent.email || commercialReferent.phone) && (
            <div className="order-9 flex min-h-[200px] min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50 md:order-none md:col-start-3 md:row-start-6 md:row-span-3">
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
                  <p className="truncate font-mono text-sm font-medium text-zinc-800 dark:text-zinc-200">
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
                    <p className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">
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
                      <span className="truncate font-mono">{commercialReferent.phone}</span>
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
          )}
        </div>
      </div>
    </div>
  );
}
