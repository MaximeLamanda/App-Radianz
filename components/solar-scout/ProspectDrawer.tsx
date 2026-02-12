"use client";

import { useState, useEffect, useMemo } from "react";
import Image from "next/image";
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
import { Plus, Trash2, X, Loader2, AlertCircle, Zap, FileCheck } from "lucide-react";
import { addProspectToPipeline, createLeadFromProspect } from "@/lib/firestore";
import { translatePlaceType } from "@/lib/place-types-translation";
import { SatelliteImage } from "./SatelliteImage";
import { MonthlyProductionChart } from "./MonthlyProductionChart";
import { surfaceToKwp } from "@/lib/surface-to-kwp";
import {
  BUILDING_ENERGY_CONSUMPTION_DATA,
  getEnergyConsumptionForMonth,
  getHourlyConsumptionProfileKwhPerM2,
  isKnownPlaceType,
  normalizePlaceTypeForConsumption,
  type MonthIndex,
} from "@/lib/building-energy-consumption";
import { buildTypicalDayFromMonthly } from "@/lib/pvgis";
import { getPanelReferences, getCountryFlagUrl } from "@/lib/solar-settings";
import { getPanelReferencesFromFirebase } from "@/lib/firestore-panel-references";
import type { Prospect, SolarPotential, PanelReference } from "@/types";

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
  return (
    <Select value={displayValue} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        className={
          variant === "dark"
            ? "bg-white/10 border-white/20 text-white hover:bg-white/15 focus:ring-white/30 focus:ring-offset-0 focus:ring-offset-black [&>span]:text-white [&_svg]:text-white [&_svg]:opacity-80 placeholder:text-white/60"
            : "bg-white"
        }
      >
        <SelectValue placeholder="Choisir un type" />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
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
  onAddToPipeline: () => void;
  isDrawing?: boolean;
  onDrawingChange?: (isDrawing: boolean) => void;
  onSurfaceUpdate?: (surface: { area: number; polygon: Array<{ lat: number; lng: number }> }) => void;
  onSurfaceDelete?: (surfaceId: string) => void;
  onProspectUpdate?: (prospect: Prospect) => void;
  onValidateDrawing?: () => void;
}

export function ProspectDrawer({
  prospect,
  isOpen,
  onOpenChange,
  onAddToPipeline,
  isDrawing = false,
  onDrawingChange,
  onSurfaceUpdate,
  onSurfaceDelete,
  onProspectUpdate,
  onValidateDrawing,
}: ProspectDrawerProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [address, setAddress] = useState(prospect?.address || "");
  const [isLoadingPVGIS, setIsLoadingPVGIS] = useState(false);
  const [pvgisError, setPvgisError] = useState<string | null>(null);
  const [chartViewMode, setChartViewMode] = useState<"monthly" | "daily">("monthly");
  const [usedPanelRef, setUsedPanelRef] = useState<PanelReference | null>(null);

  useEffect(() => {
    getPanelReferencesFromFirebase()
      .then((refs) => setUsedPanelRef(refs[0] ?? null))
      .catch(() => {
        const local = getPanelReferences();
        setUsedPanelRef(local[0] ?? null);
      });
  }, []);

  // Mettre à jour l'adresse quand le prospect change
  useEffect(() => {
    if (prospect?.address) {
      setAddress(prospect.address);
    }
  }, [prospect]);

  // Récupérer les données PVGIS quand le drawer s'ouvre
  useEffect(() => {
    const fetchPVGISData = async () => {
      // Conditions pour appeler PVGIS :
      // 1. Le drawer doit être ouvert
      // 2. Un prospect doit exister avec des coordonnées
      // 3. Les données PVGIS ne doivent pas déjà être chargées
      if (
        !isOpen ||
        !prospect ||
        !prospect.coordinates ||
        prospect.solarPotential?.pvgisDataFetched ||
        isLoadingPVGIS
      ) {
        return;
      }

      setIsLoadingPVGIS(true);
      setPvgisError(null);

      try {
        // PVGIS retourne la production pour 1 kWp ; on appelle avec peakpower=1 puis on multiplie par notre kWp.
        const totalArea = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) || 
                          (prospect.roofSurface?.area || 0);
        const kwp = totalArea > 0 ? Math.max(0.1, surfaceToKwp(totalArea)) : 1;

        const response = await fetch("/api/pvgis", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            lat: prospect.coordinates.lat,
            lon: prospect.coordinates.lng,
            peakpower: 1, // Référence 1 kWp : les sorties sont ensuite multipliées par notre kWp
            loss: 14,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Erreur ${response.status}`);
        }

        const pvgisData = await response.json();

        if (!pvgisData || typeof pvgisData.annualProduction !== 'number') {
          throw new Error("Données PVGIS invalides reçues");
        }

        // Multiplier par notre kWp : PVGIS donne la production pour 1 kWp
        const annualProduction = Math.round(pvgisData.annualProduction * kwp);
        const monthlyProduction = Array.isArray(pvgisData.monthlyProduction)
          ? pvgisData.monthlyProduction.map((m: { month: number; production: number }) => ({
              month: m.month,
              production: Math.round((m.production || 0) * kwp),
            }))
          : [];

        if (onProspectUpdate && prospect) {
          const updatedSolarPotential: SolarPotential = {
            ...prospect.solarPotential,
            maxKwhPerYear: annualProduction,
            maxSunshineHoursPerYear: pvgisData.sunshineHoursEquivalent,
            optimalInclination: pvgisData.optimalInclination,
            optimalAzimuth: pvgisData.optimalAzimuth,
            annualIrradiation: pvgisData.annualIrradiation,
            monthlyProduction,
            monthlyIrradiation: Array.isArray(pvgisData.monthlyIrradiation) 
              ? pvgisData.monthlyIrradiation 
              : [],
            pvgisDataFetched: true,
            maxArrayPanelsCount: prospect.solarPotential?.maxArrayPanelsCount || 0,
            maxArrayAreaMeters2: prospect.solarPotential?.maxArrayAreaMeters2 || totalArea,
          };

          onProspectUpdate({
            ...prospect,
            solarPotential: updatedSolarPotential,
          });
        }
      } catch (error) {
        console.error("Erreur lors de la récupération des données PVGIS:", error);
        setPvgisError(
          error instanceof Error ? error.message : "Erreur lors de la récupération des données d'ensoleillement"
        );
      } finally {
        setIsLoadingPVGIS(false);
      }
    };

    fetchPVGISData();
  }, [isOpen, prospect, isLoadingPVGIS, onProspectUpdate]);

  const handleAddToPipeline = async () => {
    if (!prospect) return;

    setIsAdding(true);
    try {
      // Ajouter le prospect au pipeline
      const prospectId = await addProspectToPipeline({
        ...prospect,
        address: address || prospect.address,
      });

      // Créer un lead à partir du prospect
      await createLeadFromProspect(
        prospectId,
        address || prospect.address,
        prospect.contact?.websiteUri
      );

      // Réinitialiser le formulaire
      onAddToPipeline();
      onOpenChange(false);
    } catch (error) {
      alert("Erreur lors de l'ajout au pipeline. Veuillez réessayer.");
    } finally {
      setIsAdding(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-[400px] bg-gray-50 border-l shadow-xl z-10 flex flex-col transition-transform duration-300 ease-in-out">
        <div className="border-b p-4 bg-white">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold leading-none tracking-tight">Informations du prospect</h2>
            <Button
              variant="outline"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 border border-gray-300"
              title="Fermer"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {false ? (
            <>
              {/* Skeleton pour le score de qualité */}
              <div className="bg-gray-100 rounded-md py-3 px-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                  <Skeleton className="h-2 w-full" />
                </div>
              </div>

              {/* Skeleton pour l’aperçu carte */}
              <div className="bg-gray-100 rounded-md py-3 px-4">
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
              {/* Score de qualité avec barre de progression - en haut */}
              <div className="bg-gray-100 rounded-md py-3 px-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Score de qualité</span>
                    <span className="text-muted-foreground">{prospect.qualityScore}/100</span>
                  </div>
                  <Progress value={prospect.qualityScore} className="h-2" />
                </div>
              </div>

              {/* Bloc prospect : photo, nom, adresse, type, lat/lon */}
              <Card className="bg-black border-0 text-white overflow-hidden">
                <CardContent className="p-0">
                  {/* Photo : aperçu satellite avec padding */}
                  {prospect.coordinates && (
                    <div className="p-3 pt-3 pb-0">
                      <div className="w-full overflow-hidden rounded-lg">
                        <SatelliteImage
                          key={`sat-${prospect.coordinates.lat.toFixed(4)}-${prospect.coordinates.lng.toFixed(4)}`}
                          coordinates={prospect.coordinates}
                          address={prospect.address}
                          zoom={17}
                          width={400}
                          height={160}
                          className="!h-40 rounded-lg border-0"
                          showOverlays={false}
                        />
                      </div>
                    </div>
                  )}
                  <div className="p-3 space-y-2">
                    {prospect.name && (
                      <p className="text-sm font-medium truncate" title={prospect.name}>
                        {prospect.name}
                      </p>
                    )}
                    {prospect.address && (
                      <p className="text-xs text-white/80 truncate" title={prospect.address}>
                        {prospect.address}
                      </p>
                    )}
                    <div className="pt-1">
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
                    <div className="flex gap-3 pt-1 text-[11px] text-white/60">
                      <span>Lat {prospect.coordinates.lat.toFixed(5)}</span>
                      <span>Lon {prospect.coordinates.lng.toFixed(5)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Section des surfaces */}
              <div className="bg-gray-100 rounded-md py-3 px-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-gray-700">Surfaces</div>
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
                          className="rounded-xl border border-border bg-white p-3 shadow-sm flex items-stretch gap-3"
                        >
                          <div className="flex-shrink-0 flex items-center">
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
                                {(surface.availablePercentage ?? 100)}%
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
                <div className="bg-gray-100 rounded-md py-3 px-4">
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
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2 bg-gray-100 rounded-md px-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Chargement des données d&apos;ensoleillement...</span>
                </div>
              )}
              {pvgisError && !isLoadingPVGIS && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{pvgisError}</span>
                </div>
              )}

              {/* Production mensuelle : affiché uniquement si surface définie (kWp + consommation) */}
              {prospect.solarPotential?.monthlyProduction &&
               prospect.solarPotential.monthlyProduction.length > 0 &&
               !isLoadingPVGIS &&
               ((prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0) > 0) && (
                <>
                  <div className="bg-gray-100 rounded-md py-3 px-4">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="text-sm font-semibold text-gray-700">Production</div>
                      <div
                        role="tablist"
                        className="inline-flex rounded-md border border-border bg-muted/50 p-0.5 flex-shrink-0"
                        aria-label="Vue du graphique"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={chartViewMode === "monthly"}
                          onClick={() => setChartViewMode("monthly")}
                          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                            chartViewMode === "monthly"
                              ? "bg-background text-foreground shadow-sm"
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
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Journalier
                        </button>
                      </div>
                    </div>
                    <div>
                      <MonthlyProductionChart
                        viewMode={chartViewMode}
                        onViewModeChange={setChartViewMode}
                        data={(() => {
                          const raw = prospect.solarPotential!.monthlyProduction!;
                          const surfaceM2 = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0;
                          const placeType = prospect.placeType || "other";
                          return raw.map((m) => ({
                            month: m.month,
                            production: m.production,
                            consumption: Math.round(getEnergyConsumptionForMonth(placeType, (m.month - 1) as MonthIndex) * surfaceM2),
                          }));
                        })()}
                        dailyData={(() => {
                          const raw = prospect.solarPotential!.monthlyProduction!;
                          const surfaceM2 = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0;
                          if (surfaceM2 <= 0) return undefined;
                          const placeType = prospect.placeType || "other";
                          // raw est déjà en kWh total (déjà × kWp côté PVGIS), donc peakpower=1 pour ne pas re-multiplier
                          const hourlyProduction = buildTypicalDayFromMonthly(raw, 1);
                          const hourlyConsumptionPerM2 = getHourlyConsumptionProfileKwhPerM2(placeType);
                          return Array.from({ length: 24 }, (_, hour) => ({
                            hour,
                            production: hourlyProduction[hour] ?? 0,
                            consumption: Math.round((hourlyConsumptionPerM2[hour] ?? 0) * surfaceM2),
                          }));
                        })()}
                      />
                    </div>
                  </div>
                  {/* KPIs sous le graphique, dans des blocs séparés */}
                  {(() => {
                    const raw = prospect.solarPotential!.monthlyProduction!;
                    const totalKwh = raw.reduce((s, m) => s + (m.production ?? 0), 0);
                    const productionGwh = totalKwh / 1_000_000;
                    const surfaceM2 =
                      prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ??
                      prospect.roofSurface?.area ??
                      0;
                    const placeType = prospect.placeType || "other";
                    const totalConsumptionKwh = raw.reduce((sum, m) => {
                      const perM2Month = getEnergyConsumptionForMonth(
                        placeType,
                        (m.month - 1) as MonthIndex,
                      );
                      return sum + perM2Month * surfaceM2;
                    }, 0);
                    const consumptionGwh = totalConsumptionKwh / 1_000_000;
                    return (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-gray-100 rounded py-2 px-3 text-center">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Production totale
                            </div>
                            <div className="text-sm font-semibold text-gray-900 flex items-center justify-center gap-1.5">
                              <div className="w-2 h-2 rounded-full bg-blue-500" />
                              {productionGwh >= 0.001 ? productionGwh.toFixed(3) : productionGwh.toFixed(6)} GWh
                            </div>
                          </div>
                          <div className="bg-gray-100 rounded py-2 px-3 text-center">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Consommation totale
                            </div>
                            <div className="text-sm font-semibold text-gray-900 flex items-center justify-center gap-1.5">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "hsl(0, 0%, 50%)" }} />
                              {consumptionGwh >= 0.001 ? consumptionGwh.toFixed(3) : consumptionGwh.toFixed(6)} GWh
                            </div>
                          </div>
                        </div>
                        {usedPanelRef && (
                          <div className="mt-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Panneau utilisé</div>
                            <div className="rounded-xl border border-border bg-white p-3 shadow-sm flex items-stretch gap-3">
                            <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gray-100">
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
                      </>
                    );
                  })()}
                </>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">
              Cliquez sur la carte pour obtenir les informations d'un lieu
            </div>
          )}
        </div>

        <div className="border-t p-4 mt-auto bg-white">
          {prospect && (
            <Button
              onClick={handleAddToPipeline}
              className="w-full"
              size="lg"
              disabled={isAdding}
            >
              <Plus className="h-4 w-4 mr-2" />
              {isAdding ? "Ajout en cours..." : "Ajouter au pipeline"}
            </Button>
          )}
        </div>
    </div>
  );
}
