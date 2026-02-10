"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Layers, Trash2, Check, X, Loader2, AlertCircle } from "lucide-react";
import { addProspectToPipeline, createLeadFromProspect } from "@/lib/firestore";
import { translatePlaceType } from "@/lib/place-types-translation";
import { SatelliteImage } from "./SatelliteImage";
import { MonthlyProductionChart } from "./MonthlyProductionChart";
import { surfaceToKwp } from "@/lib/surface-to-kwp";
import {
  BUILDING_ENERGY_CONSUMPTION_DATA,
  getEnergyConsumptionForMonth,
  isKnownPlaceType,
  normalizePlaceTypeForConsumption,
  type MonthIndex,
} from "@/lib/building-energy-consumption";
import type { Prospect, SolarPotential } from "@/types";

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
}: {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const options = useMemo(() => getPlaceTypeOptions(value), [value]);
  const displayValue =
    value && options.some((o) => o.value === value)
      ? value
      : options.find((o) => normalizePlaceTypeForConsumption(o.value) === normalizePlaceTypeForConsumption(value))
          ?.value ?? value ?? "other";
  return (
    <Select value={displayValue} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="bg-white">
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

              {/* Aperçu satellite du lieu (Mapbox ou Google plan) */}
              {prospect.address && (
                <div className="bg-gray-100 rounded-md py-3 px-4">
                  <div className="text-sm font-semibold text-gray-700 mb-2">Aperçu satellite du lieu</div>
                  <SatelliteImage
                    key={`sat-${prospect.coordinates.lat.toFixed(4)}-${prospect.coordinates.lng.toFixed(4)}`}
                    coordinates={prospect.coordinates}
                    address={prospect.address}
                    zoom={16}
                  />
                </div>
              )}

              {prospect.name && (
                <div className="bg-gray-100 rounded-md py-3 px-4">
                  <div className="text-sm font-medium">{prospect.name}</div>
                </div>
              )}
              {prospect.address && (
                <div className="bg-gray-100 rounded-md py-3 px-4">
                  <div className="text-sm font-medium">{prospect.address}</div>
                </div>
              )}
              <div className="bg-gray-100 rounded-md py-3 px-4">
                <div className="text-xs font-medium text-gray-600 mb-1.5">Type de lieu (base consommation)</div>
                <PlaceTypeSelect
                  value={prospect.placeType}
                  onValueChange={(value) => {
                    if (onProspectUpdate) {
                      onProspectUpdate({ ...prospect, placeType: value });
                    }
                  }}
                  disabled={!onProspectUpdate}
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1 bg-gray-100 rounded-md py-3 px-4 text-sm text-muted-foreground">
                  Lat: {prospect.coordinates.lat.toFixed(6)}
                </div>
                <div className="flex-1 bg-gray-100 rounded-md py-3 px-4 text-sm text-muted-foreground">
                  Lng: {prospect.coordinates.lng.toFixed(6)}
                </div>
              </div>

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
                          className="bg-gray-50 rounded-md py-2 px-3 border border-gray-200 hover:border-gray-300 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            {/* Icône de surface */}
                            <div className="flex-shrink-0">
                              <div className="w-10 h-10 rounded-md bg-blue-50 flex items-center justify-center">
                                <Layers className="h-5 w-5 text-blue-600" />
                              </div>
                            </div>
                            
                            {/* Informations de la surface : m², points, kWp */}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium">
                                {surface.area.toFixed(2)} m²
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {surface.polygon.length} points
                              </div>
                              <div className="text-sm font-semibold text-amber-800 mt-0.5">
                                {surfaceKwp.toFixed(2)} kWp
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
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {isDrawing && (
                <div className="bg-yellow-50 border-2 border-yellow-300 rounded-md py-3 px-4">
                  <div className="text-sm font-medium text-yellow-800 mb-2">
                    Mode dessin activé
                  </div>
                  <p className="text-xs text-yellow-700 mb-3">
                    Cliquez sur la carte pour dessiner un polygone représentant la surface du toit.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => {
                        // Signaler qu'on veut valider avant de désactiver le mode dessin
                        if (onValidateDrawing) {
                          onValidateDrawing();
                        }
                        if (onDrawingChange) {
                          onDrawingChange(false);
                        }
                      }}
                      className="flex-1"
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Valider
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // Annulation : ne pas valider, juste désactiver le mode dessin
                        if (onDrawingChange) {
                          onDrawingChange(false);
                        }
                      }}
                      className="flex-1"
                    >
                      <X className="h-3 w-3 mr-1" />
                      Annuler
                    </Button>
                  </div>
                </div>
              )}

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
                <div className="bg-gray-100 rounded-md py-3 px-4">
                  <div className="text-sm font-semibold text-gray-700 mb-3">Production mensuelle</div>
                  <div>
                    <MonthlyProductionChart
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
                    />
                  </div>
                </div>
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
