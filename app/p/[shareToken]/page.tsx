"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useParams } from "next/navigation";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { User, Phone, Mail, Building2, Loader2, ArrowLeft, Link2 } from "lucide-react";
import { getProspectByShareToken } from "@/lib/firestore";
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
} from "@/lib/pvgis";
import {
  surfaceToKwp,
  getUsableRoofAreaM2,
} from "@/lib/surface-to-kwp";
import { getPanelReferencesFromFirebase } from "@/lib/firestore-panel-references";
import { getInverterReferencesFromFirebase } from "@/lib/firestore-inverter-references";
import {
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
import { MonthlyProductionChart } from "@/components/solar-scout/MonthlyProductionChart";
import type { Prospect, PanelReference, InverterReference } from "@/types";
import { toast } from "sonner";

export default function ProspectSharePage() {
  const params = useParams();
  const { user } = useAuth();
  const shareToken = params?.shareToken as string;
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [loading, setLoading] = useState(true);
  const [configurationMode, setConfigurationMode] = useState<"highest_production" | "perfect_fit">("highest_production");
  const [annualConsumptionOverride, setAnnualConsumptionOverride] = useState<number | undefined>(undefined);
  const [usedPanelRef, setUsedPanelRef] = useState<PanelReference | null>(null);
  const [usedInverterRef, setUsedInverterRef] = useState<InverterReference | null>(null);
  const [chartViewMode, setChartViewMode] = useState<"monthly" | "daily">("monthly");
  useEffect(() => {
    if (!shareToken) return;
    getProspectByShareToken(shareToken).then((p) => {
      setProspect(p ?? null);
      if (p?.configurationMode) setConfigurationMode(p.configurationMode);
      if (p?.annualConsumptionKwhOverride != null) setAnnualConsumptionOverride(p.annualConsumptionKwhOverride);
      setLoading(false);
    });
  }, [shareToken]);

  useEffect(() => {
    getPanelReferencesFromFirebase()
      .then((refs) => {
        const recommended = refs.find((r) => r.recommended);
        setUsedPanelRef(recommended ?? refs[0] ?? null);
      })
      .catch(() => setUsedPanelRef(getRecommendedPanelReferenceSync()));
  }, []);

  useEffect(() => {
    getInverterReferencesFromFirebase()
      .then((refs) => {
        const recommended = refs.find((r) => r.recommended);
        setUsedInverterRef(recommended ?? refs[0] ?? null);
      })
      .catch(() => setUsedInverterRef(getRecommendedInverterReferenceSync()));
  }, []);

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
    const targetKwp = productible > 0
      ? (consoAnnuelleKwh * PERFECT_FIT_SELF_CONSUMPTION_TARGET) / productible
      : 0;
    const cappedKwp = Math.min(targetKwp, fullKwp);
    const perfectFitPanelCount = panelCountFromKwp(cappedKwp);
    const perfectFitPowerKW = cappedKwp;
    const perfectFitInverterCount = calculateInverterCount(perfectFitPowerKW, inverterRef);

    return {
      perfectFit: { panelCount: perfectFitPanelCount, inverterCount: perfectFitInverterCount },
      highestProduction: { panelCount: highestPanelCount, inverterCount: highestInverterCount },
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
  const annualSavings = estimateAnnualSavingsEur(effectiveConfig.effectiveAnnualProductionKwh, undefined, consoAnnuelleKwh);
  const recommendedPanel = usedPanelRef ?? getRecommendedPanelReferenceSync();
  const recommendedInverter = usedInverterRef ?? getRecommendedInverterReferenceSync();
  const inverterCount = calculateInverterCount(effectiveConfig.effectiveKwp, recommendedInverter);
  const equipmentEur = estimateInstallationPriceEur(
    effectiveConfig.effectivePanelCount,
    inverterCount,
    recommendedPanel,
    recommendedInverter
  );
  const priceRange = estimateTotalPriceRangeEur(effectiveConfig.effectiveKwp, equipmentEur);
  const breakEvenMin = getBreakEvenYears(priceRange.totalMinEur, annualSavings);
  const breakEvenMax = getBreakEvenYears(priceRange.totalMaxEur, annualSavings);
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
  const isAdminView = Boolean(user);

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
      <div className="max-w-7xl mx-auto p-4 sm:p-5 flex flex-col flex-1 min-h-0 w-full gap-4">
        {/* Barre admin : visible uniquement pour les utilisateurs connectés */}
        {isAdminView && (
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

        {/* Grille bento : 3 colonnes × 4 lignes, blocs qui s'étendent (placement explicite sur md+) */}
        <div
          className="grid grid-cols-1 md:grid-cols-3 md:grid-rows-4 gap-3 sm:gap-4 flex-1 min-h-0 w-full auto-rows-fr"
          style={{
            minHeight: "min(560px, calc(100vh - 8rem))",
          }}
        >
          {/* [1,1] Carte adresse / type / surface / orientation */}
          <div className="min-h-0 flex flex-col md:col-start-1 md:row-start-1">
            <Card className="bg-black border-0 text-white overflow-hidden rounded-xl h-full flex flex-col">
              <CardContent className="p-4 flex-1 flex flex-col justify-center">
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
                    <span className="text-[10px] uppercase tracking-wide text-white/60" title="Écart au Sud (0° = face sud)">Orientation</span>
                    <div className="px-3 py-1.5 rounded-md text-[10px] uppercase text-white/80 min-w-fit">
                      {(() => {
                        const surfaces = prospect.roofSurfaces ?? (prospect.roofSurface?.area ? [prospect.roofSurface] : []);
                        const firstOrientation = surfaces[0]?.orientation;
                        return firstOrientation != null ? `${Math.abs(firstOrientation).toFixed(1)}°` : "—";
                      })()}
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
            <div className="grid grid-cols-2 gap-2 min-h-0 md:col-start-2 md:row-start-1">
              <button
                type="button"
                onClick={() => setConfigurationMode("perfect_fit")}
                className={`rounded-xl border p-3 text-left transition-colors h-full flex flex-col ${
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
                className={`rounded-xl border p-3 text-left transition-colors h-full flex flex-col ${
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

          {/* [3,1] Prix projet estimé */}
          <div className="rounded-xl px-4 py-4 min-h-[100px] flex flex-col justify-between bg-gray-100 md:col-start-3 md:row-start-1">
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

          {/* [1,2-3] Image satellite — span 2 rows */}
          {prospect.coordinates && (
            <div className="rounded-xl overflow-hidden border shadow-xs min-h-0 flex flex-col md:col-start-1 md:row-start-2 md:row-span-2">
              <SatelliteImage
                key={`sat-${imageCenter.lat}-${imageCenter.lng}`}
                coordinates={imageCenter}
                address={prospect.address}
                zoom={17}
                width={600}
                height={320}
                className="w-full h-full min-h-[180px] object-cover"
                showOverlays={false}
              />
            </div>
          )}

          {/* [2,2-3] Graphique production — 2 lignes de hauteur, span 2 rows */}
          {(prospect.solarPotential?.productionPerKwpMonthly?.length || prospect.solarPotential?.monthlyProduction?.length) && surfaceM2 > 0 && (
            <div className="bg-gray-100 rounded-xl py-3 px-4 pb-2 min-h-0 flex flex-col md:col-start-2 md:row-start-2 md:row-span-2 overflow-hidden h-full">
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
                  data={(() => {
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
                    if (!effectiveConfig.productionPerKwp) return undefined;
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
          )}

          {/* [2,4] Energy Bill + Savings — en dessous du bloc Production */}
          <div className="flex flex-row gap-2 min-h-0 md:col-start-2 md:row-start-4">
            <div className="rounded-xl px-4 py-3 flex flex-col justify-between bg-gray-100 flex-1 min-w-0 min-h-[80px]">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] uppercase tracking-wide text-gray-500">Energy Bill</span>
                <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" title="Facture énergétique annuelle estimée" />
              </div>
              <div className="text-xl font-normal text-gray-700">
                {energyBillEur.toLocaleString("fr-FR")}
                <span className="text-sm font-light text-gray-400 ml-0.5">€</span>
              </div>
            </div>
            <div className="bg-gray-100 rounded-xl px-4 py-3 flex flex-col justify-between flex-1 min-w-0 min-h-[80px]">
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

          {/* [3,3-4] Équipement — 1 colonne × 2 lignes (row-span-2) */}
          {(usedPanelRef || usedInverterRef) && (
            <div className="bg-gray-100 rounded-xl py-3 px-4 min-h-0 overflow-auto md:col-start-3 md:row-start-3 md:row-span-2">
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
              </div>
            </div>
          )}

          {/* [1,4] Référent (personne qui a généré le lien) — données du commercialReferent */}
          {commercialReferent && (commercialReferent.name || commercialReferent.email || commercialReferent.phone) && (
            <div className="rounded-xl px-4 py-3 flex flex-col items-stretch justify-start bg-gray-100 min-h-[80px] min-w-0 md:col-start-1 md:row-start-4">
              <div className="flex items-center justify-between gap-1 shrink-0">
                <span className="text-[10px] uppercase tracking-wide text-gray-500">Votre référent</span>
                <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" title="Personne qui a généré le lien" />
              </div>
              <div className="flex items-start gap-3 min-w-0 mt-2">
                <div className="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-gray-200">
                  {commercialReferent.photoURL ? (
                    <img src={commercialReferent.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <User className="h-5 w-5 text-gray-500" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  {commercialReferent.name && (
                    <div className="text-sm font-medium text-gray-700 truncate">{commercialReferent.name}</div>
                  )}
                  {commercialReferent.email && (
                    <a href={`mailto:${commercialReferent.email}`} className="text-xs text-blue-600 hover:underline truncate block">
                      <span className="truncate">{commercialReferent.email}</span>
                    </a>
                  )}
                  <div className="text-xs text-gray-600">
                    {commercialReferent.phone ? (
                      <a
                        href={`tel:${commercialReferent.phone.replace(/\s/g, "")}`}
                        className="text-blue-600 hover:underline"
                      >
                        {commercialReferent.phone}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
