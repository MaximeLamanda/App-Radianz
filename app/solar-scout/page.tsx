"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { MapComponent } from "@/components/solar-scout/MapComponent";
import { Sidebar } from "@/components/solar-scout/Sidebar";
import { ProspectDrawer } from "@/components/solar-scout/ProspectDrawer";
import { GoogleMapsLoader } from "@/components/solar-scout/GoogleMapsLoader";
import { MapErrorBoundary } from "@/components/solar-scout/MapErrorBoundary";
import { getPlaceDetailsNew } from "@/lib/places-new-api";
import { surfaceToKwp } from "@/lib/surface-to-kwp";
import { loadProspectSurfaces, saveProspectSurfaces, deleteProspectSurfaces } from "@/lib/prospect-storage";
import { loadMapPosition, saveMapPosition, getDefaultMapPosition } from "@/lib/map-position-storage";
import { getProspectById, getProspectByPlaceId, updateProspectInPipeline } from "@/lib/firestore";
import { useDrawer } from "@/lib/drawer-context";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import type { Prospect, AddressCoordinates, PlaceSearchResult } from "@/types";

// Fonction pour calculer le quality score
function calculateQualityScore(area: number, placeType: string): number {
  let score = 0;

  // Score basé sur la surface (max 40 points)
  if (area > 1000) score += 40;
  else if (area > 500) score += 35;
  else if (area > 200) score += 30;
  else if (area > 100) score += 20;
  else if (area > 0) score += 10;

  // Score basé sur le type de lieu (max 30 points)
  const energyIntensiveTypes = ["warehouse", "supermarket", "industrial"];
  if (energyIntensiveTypes.includes(placeType)) {
    score += 30;
  } else if (placeType === "retail" || placeType === "office") {
    score += 20;
  } else {
    score += 10;
  }

  return Math.min(100, score);
}

function SolarScoutContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [prospect, setProspect] = useState<Prospect | null>(null);

  // Ref qui mémorise les dernières surfaces BDNB détectées.
  // Permet de les réinjecter quand onProspectUpdate remplace le prospect (clic POI).
  const pendingBdnbSurfacesRef = useRef<import("@/types").RoofSurface[] | null>(null);
  const { isDrawerOpen, setIsDrawerOpen, setDrawerContent } = useDrawer();
  const [isDrawing, setIsDrawing] = useState(false);

  // À la fermeture du drawer : retirer prospectId de l'URL (sans recharger) et revenir à solar-scout "classique"
  const handleDrawerOpenChange = useCallback(
    (open: boolean) => {
      setIsDrawerOpen(open);
      if (!open && searchParams.get("prospectId")) {
        setProspect(null);
        router.replace(pathname ?? "/solar-scout");
      }
    },
    [pathname, router, searchParams, setIsDrawerOpen]
  );
  const [shouldValidateDrawing, setShouldValidateDrawing] = useState(false);
  // Charger la dernière position sauvegardée au démarrage
  const savedPosition = typeof window !== "undefined" ? loadMapPosition() : null;
  const defaultPosition = savedPosition || getDefaultMapPosition();
  
  const [centerCoordinates, setCenterCoordinates] = useState<AddressCoordinates | null>(
    savedPosition ? savedPosition.center : null
  );
  const [initialAddress, setInitialAddress] = useState<string>(""); // Champ adresse vide par défaut
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [getMapCenterFunc, setGetMapCenterFunc] = useState<(() => AddressCoordinates | null) | null>(null);
  
  // Wrapper pour setGetMapCenterFunc qui vérifie que c'est bien une fonction
  const handleGetMapCenter = useCallback((func: (() => AddressCoordinates | null) | null) => {
    if (func && typeof func === 'function') {
      setGetMapCenterFunc(() => func);
    } else if (func !== null) {
      console.error("[Page] ERREUR: handleGetMapCenter a reçu quelque chose qui n'est pas une fonction:", func, typeof func);
    }
  }, []);
  
  // Fonction wrapper stable qui utilise getMapCenterFunc
  // Fallback par défaut si la fonction n'est pas encore disponible
  const defaultCenter: AddressCoordinates = defaultPosition.center;
  
  const getMapCenter = useCallback(() => {
    if (getMapCenterFunc && typeof getMapCenterFunc === 'function') {
      const result = getMapCenterFunc();
      // Si le résultat est null, retourner le centre par défaut
      if (result) {
        return result;
      } else {
        return defaultCenter;
      }
    }
    return defaultCenter;
  }, [getMapCenterFunc]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  // Sauvegarder la position quand elle change
  useEffect(() => {
    if (centerCoordinates) {
      saveMapPosition(centerCoordinates);
    }
  }, [centerCoordinates]);

  const handleAddToPipeline = useCallback(() => {
    // Réinitialiser le prospect après ajout
    setProspect(null);
    setIsDrawerOpen(false);
  }, [setIsDrawerOpen]);

  // Ouvrir le drawer et mettre à jour le contenu quand un prospect est sélectionné
  useEffect(() => {
    if (prospect) {
      setIsDrawerOpen(true);
      setDrawerContent(
        <ProspectDrawer
          prospect={prospect}
          isOpen={true}
          onOpenChange={handleDrawerOpenChange}
          onAddToPipeline={handleAddToPipeline}
          isDrawing={isDrawing}
          onDrawingChange={setIsDrawing}
          onSurfaceUpdate={(surface) => {
            setProspect((currentProspect) => {
              if (!currentProspect) {
                return currentProspect;
              }
              
              const newSurface = {
                id: `surface-${Date.now()}`,
                ...surface,
              };
              
              const existingSurfaces = currentProspect.roofSurfaces || 
                (currentProspect.roofSurface.area > 0 
                  ? [{ ...currentProspect.roofSurface, id: `surface-${Date.now() - 1000}` }] 
                  : []);
              
              const updatedSurfaces = [...existingSurfaces, newSurface];
              const totalArea = updatedSurfaces.reduce((sum, s) => sum + s.area, 0);
              const estimatedKwp = surfaceToKwp(totalArea);
              const prev = currentProspect.solarPotential;
              const updatedProspect = {
                ...currentProspect,
                roofSurfaces: updatedSurfaces,
                roofSurface: newSurface,
                qualityScore: calculateQualityScore(totalArea, currentProspect.placeType),
                solarPotential: {
                  ...prev,
                  maxArrayPanelsCount: prev?.maxArrayPanelsCount ?? 0,
                  maxArrayAreaMeters2: prev?.maxArrayAreaMeters2 ?? totalArea,
                  maxSunshineHoursPerYear: prev?.maxSunshineHoursPerYear ?? 0,
                  maxKwhPerYear: prev?.maxKwhPerYear ?? 0,
                  estimatedKwp,
                  pvgisDataFetched: false,
                },
              };
              
              saveProspectSurfaces(updatedProspect);
              return updatedProspect;
            });
          }}
          onSurfaceDelete={(surfaceId: string) => {
            if (prospect) {
              const surfaces = prospect.roofSurfaces || 
                (prospect.roofSurface.area > 0 ? [{ ...prospect.roofSurface, id: `surface-0` }] : []);
              
              const updatedSurfaces = surfaces.filter(s => 
                (s.id || `surface-${surfaces.indexOf(s)}`) !== surfaceId
              );
              
              const totalArea = updatedSurfaces.reduce((sum, s) => sum + s.area, 0);
              const estimatedKwp = surfaceToKwp(totalArea);
              const prev = prospect.solarPotential;
              const updatedProspect = {
                ...prospect,
                roofSurfaces: updatedSurfaces,
                roofSurface: updatedSurfaces.length > 0 
                  ? updatedSurfaces[updatedSurfaces.length - 1] 
                  : { area: 0, polygon: [] },
                qualityScore: calculateQualityScore(totalArea, prospect.placeType),
                solarPotential: {
                  ...prev,
                  maxArrayPanelsCount: prev?.maxArrayPanelsCount ?? 0,
                  maxArrayAreaMeters2: totalArea > 0 ? (prev?.maxArrayAreaMeters2 ?? totalArea) : 0,
                  maxSunshineHoursPerYear: prev?.maxSunshineHoursPerYear ?? 0,
                  maxKwhPerYear: totalArea > 0 ? (prev?.maxKwhPerYear ?? 0) : 0,
                  monthlyProduction: totalArea > 0 ? prev?.monthlyProduction : undefined,
                  estimatedKwp,
                  pvgisDataFetched: false,
                },
              };
              
              if (updatedSurfaces.length > 0) {
                saveProspectSurfaces(updatedProspect);
              } else {
                deleteProspectSurfaces(updatedProspect);
              }
              setProspect(updatedProspect);

              if (prospect.id) {
                updateProspectInPipeline(prospect.id, updatedProspect, { estimatedKwp })
                  .then(() => toast.success("Surface supprimée"))
                  .catch((err) => {
                    console.error("Erreur Firestore après suppression de surface:", err);
                    toast.error("Erreur lors de la sauvegarde");
                  });
              }
            }
          }}
          onProspectUpdate={(updatedProspect) => {
            // Merger dans le state courant pour ne pas écraser les surfaces BDNB
            // injectées après que la closure du drawer a capturé le prospect.
            setProspect((prev) => {
              if (!prev || !updatedProspect) return updatedProspect;
              return {
                ...prev,
                ...updatedProspect,
                // Conserver les roofSurfaces du state courant si updatedProspect
                // n'en apporte pas de nouvelles (cas PVGIS qui ne touche qu'à solarPotential)
                roofSurfaces: updatedProspect.roofSurfaces ?? prev.roofSurfaces,
                roofSurface: updatedProspect.roofSurface ?? prev.roofSurface,
              };
            });
          }}
          onValidateDrawing={() => {
            setShouldValidateDrawing(true);
          }}
          voirHref={(id) => `/?prospectId=${id}`}
        />
      );
    } else {
      setIsDrawerOpen(false);
      setDrawerContent(null);
    }
  }, [prospect, isDrawing, setIsDrawerOpen, setDrawerContent, handleAddToPipeline, handleDrawerOpenChange]);

  // Charger un prospect depuis le pipeline (clic sur une ligne)
  useEffect(() => {
    const prospectId = searchParams.get("prospectId");
    if (!prospectId) return;

    const loadProspect = async () => {
      const p = await getProspectById(prospectId);
      if (p && p.coordinates) {
        setProspect(p);
        setCenterCoordinates(p.coordinates);
      }
    };

    loadProspect();
  }, [searchParams]);

  const handleAddressSelect = (address: string, coordinates: AddressCoordinates) => {
    // Centrer la carte sur l'adresse sélectionnée
    setCenterCoordinates(coordinates);
    
    // Mettre à jour le prospect avec l'adresse si un prospect existe déjà
    if (prospect) {
      const updatedProspect = {
        ...prospect,
        address,
        coordinates,
      };
      
      // Charger les surfaces sauvegardées pour cette nouvelle adresse
      const savedSurfaces = loadProspectSurfaces(updatedProspect);
      if (savedSurfaces.length > 0) {
        const totalArea = savedSurfaces.reduce((sum, s) => sum + s.area, 0);
        updatedProspect.roofSurfaces = savedSurfaces;
        updatedProspect.roofSurface = savedSurfaces[savedSurfaces.length - 1] || { area: 0, polygon: [] };
        updatedProspect.qualityScore = calculateQualityScore(totalArea, updatedProspect.placeType);
      }
      
      setProspect(updatedProspect);
    }
  };

  // Gérer le clic sur un résultat de recherche
  const handleSearchResultClick = async (result: PlaceSearchResult) => {
    // Centrer la carte sur le résultat
    setCenterCoordinates(result.coordinates);

    // Obtenir les détails complets (formattedAddress) pour cohérence sidebar ↔ drawer
    const placeDetails = await getPlaceDetailsNew(result.placeId);
    const fullAddress = placeDetails?.formattedAddress || result.address;
    const displayName = placeDetails?.displayName || result.name;

    const existingProspect = await getProspectByPlaceId(result.placeId);
    if (existingProspect) {
      setProspect(existingProspect);
      return;
    }

    const newProspect: Prospect = {
      name: displayName,
      address: fullAddress,
      coordinates: result.coordinates,
      roofSurface: { area: 0, polygon: [] },
      placeType: placeDetails?.primaryTypeDisplayName || result.placeType,
      placeId: result.placeId,
      qualityScore: calculateQualityScore(0, result.placeType),
      contact: result.contact,
    };

    // Charger les surfaces sauvegardées depuis localStorage
    const savedSurfaces = loadProspectSurfaces(newProspect);
    if (savedSurfaces.length > 0) {
      const totalArea = savedSurfaces.reduce((sum, s) => sum + s.area, 0);
      newProspect.roofSurfaces = savedSurfaces;
      newProspect.roofSurface = savedSurfaces[savedSurfaces.length - 1] || { area: 0, polygon: [] };
      newProspect.qualityScore = calculateQualityScore(totalArea, newProspect.placeType);
    }

    setProspect(newProspect);
  };

  return (
    <div className="flex-1 w-full relative overflow-hidden flex rounded-xl min-h-0 h-full min-h-[70vh]">
      {/* Map en plein écran avec transition */}
      <div className="h-full flex-1 min-w-0 relative min-h-[70vh]">
        <MapErrorBoundary>
          <GoogleMapsLoader>
            <MapComponent
            onProspectUpdate={(newProspect) => {
              // Réinitialiser les surfaces BDNB en attente : le nouveau clic BDNB
              // arrivera après et mettra à jour via onBdnbSurface (qui sera appelé en parallèle).
              pendingBdnbSurfacesRef.current = null;
              setProspect(newProspect);
            }}
            isDrawing={isDrawing}
            onDrawingChange={(drawing) => {
              setIsDrawing(drawing);
              // Réinitialiser le flag de validation quand on active le dessin
              if (drawing) {
                setShouldValidateDrawing(false);
              }
            }}
            centerCoordinates={centerCoordinates}
            shouldValidateDrawing={shouldValidateDrawing}
            onValidationComplete={() => {
              setShouldValidateDrawing(false);
            }}
            onValidateDrawing={() => {
              setShouldValidateDrawing(true);
            }}
            onSurfaceUpdate={(surface) => {
              setProspect((currentProspect) => {
                if (!currentProspect) {
                  return currentProspect;
                }
                
                // Générer un ID unique pour la nouvelle surface
                const newSurface = {
                  id: `surface-${Date.now()}`,
                  ...surface,
                };
                
                // Ajouter à la liste des surfaces ou créer le tableau
                const existingSurfaces = currentProspect.roofSurfaces || 
                  (currentProspect.roofSurface.area > 0 
                    ? [{ ...currentProspect.roofSurface, id: `surface-${Date.now() - 1000}` }] 
                    : []);
                
                const updatedSurfaces = [...existingSurfaces, newSurface];
                const totalArea = updatedSurfaces.reduce((sum, s) => sum + s.area, 0);
                const estimatedKwp = surfaceToKwp(totalArea);
                const prev = currentProspect.solarPotential;
                const updatedProspect = {
                  ...currentProspect,
                  roofSurfaces: updatedSurfaces,
                  roofSurface: newSurface, // Garder la dernière pour compatibilité
                  qualityScore: calculateQualityScore(totalArea, currentProspect.placeType),
                  solarPotential: {
                    ...prev,
                    maxArrayPanelsCount: prev?.maxArrayPanelsCount ?? 0,
                    // Garder maxArrayAreaMeters2 pour pouvoir scaler la prod jusqu'au prochain fetch PVGIS
                    maxArrayAreaMeters2: prev?.maxArrayAreaMeters2 ?? totalArea,
                    maxSunshineHoursPerYear: prev?.maxSunshineHoursPerYear ?? 0,
                    maxKwhPerYear: prev?.maxKwhPerYear ?? 0,
                    estimatedKwp,
                    pvgisDataFetched: false, // Recalculer la production avec le nouveau kWp
                  },
                };
                
                // Sauvegarder les surfaces dans localStorage
                saveProspectSurfaces(updatedProspect);
                
                return updatedProspect;
              });
            }}
            currentProspect={prospect}
            searchResults={searchResults}
            onSearchResultClick={handleSearchResultClick}
            onGetMapCenter={handleGetMapCenter}
            onBdnbInfo={(info) => {
              setProspect((prev) => {
                if (!prev) return prev;
                return { ...prev, anneeConstruction: info.anneeConstruction };
              });
            }}
            onBdnbSurface={(bdnbSurfaces) => {
              // Mémoriser dans le ref pour que onProspectUpdate puisse les réinjecter
              pendingBdnbSurfacesRef.current = bdnbSurfaces && bdnbSurfaces.length > 0 ? bdnbSurfaces : null;

              setProspect((prev) => {
                if (!prev) return prev;
                // Surfaces manuelles = tout ce qui n'est pas préfixé "bdnb-"
                const manualSurfaces = (prev.roofSurfaces ?? []).filter(
                  (s) => !s.id?.startsWith("bdnb-")
                );
                if (!bdnbSurfaces || bdnbSurfaces.length === 0) {
                  // BDNB n'a rien retourné : garder uniquement les surfaces manuelles
                  // Ne pas écraser si le prospect avait déjà des surfaces (ex: BDNB d'un clic précédent)
                  if (manualSurfaces.length > 0) {
                    const totalArea = manualSurfaces.reduce((sum, s) => sum + s.area, 0);
                    return {
                      ...prev,
                      roofSurfaces: manualSurfaces,
                      roofSurface: manualSurfaces.at(-1) ?? { area: 0, polygon: [] },
                      qualityScore: calculateQualityScore(totalArea, prev.placeType),
                      solarPotential: {
                        ...prev.solarPotential,
                        maxArrayPanelsCount: prev.solarPotential?.maxArrayPanelsCount ?? 0,
                        maxArrayAreaMeters2: prev.solarPotential?.maxArrayAreaMeters2 ?? totalArea,
                        maxSunshineHoursPerYear: prev.solarPotential?.maxSunshineHoursPerYear ?? 0,
                        maxKwhPerYear: prev.solarPotential?.maxKwhPerYear ?? 0,
                        estimatedKwp: surfaceToKwp(totalArea),
                        pvgisDataFetched: false,
                      },
                    };
                  }
                  // manualSurfaces vide mais le prospect avait des surfaces (BDNB d'avant) : ne pas écraser
                  const existingCount = (prev.roofSurfaces ?? []).length || (prev.roofSurface?.area > 0 ? 1 : 0);
                  if (existingCount > 0) {
                    return prev;
                  }
                  // Aucune surface existante : comportement normal (tout à zéro)
                  return {
                    ...prev,
                    roofSurfaces: [],
                    roofSurface: { area: 0, polygon: [] },
                    qualityScore: calculateQualityScore(0, prev.placeType),
                  solarPotential: {
                    ...prev.solarPotential,
                    maxArrayPanelsCount: prev.solarPotential?.maxArrayPanelsCount ?? 0,
                    maxArrayAreaMeters2: 0,
                    maxSunshineHoursPerYear: prev.solarPotential?.maxSunshineHoursPerYear ?? 0,
                    maxKwhPerYear: 0,
                    monthlyProduction: undefined,
                    estimatedKwp: surfaceToKwp(0),
                    pvgisDataFetched: false,
                  },
                  };
                }
                // BDNB en premier, puis surfaces manuelles
                const updatedSurfaces = [...bdnbSurfaces, ...manualSurfaces];
                const totalArea = updatedSurfaces.reduce((sum, s) => sum + s.area, 0);
                return {
                  ...prev,
                  roofSurfaces: updatedSurfaces,
                  roofSurface: bdnbSurfaces[0],
                  qualityScore: calculateQualityScore(totalArea, prev.placeType),
                  solarPotential: {
                    ...prev.solarPotential,
                    maxArrayPanelsCount: prev.solarPotential?.maxArrayPanelsCount ?? 0,
                    maxArrayAreaMeters2: prev.solarPotential?.maxArrayAreaMeters2 ?? totalArea,
                    maxSunshineHoursPerYear: prev.solarPotential?.maxSunshineHoursPerYear ?? 0,
                    maxKwhPerYear: prev.solarPotential?.maxKwhPerYear ?? 0,
                    estimatedKwp: surfaceToKwp(totalArea),
                    pvgisDataFetched: false,
                  },
                };
              });
            }}
          />
        </GoogleMapsLoader>
      </MapErrorBoundary>
      </div>
      
      {/* Sidebar positionnée par-dessus la map */}
      <div className="absolute top-6 left-6 z-50">
        <Sidebar 
          onAddressSelect={handleAddressSelect}
          initialAddress={initialAddress}
          isDrawing={isDrawing}
          onDrawingChange={setIsDrawing}
          onProspectUpdate={(updatedProspect) => {
            setProspect((prev) => {
              if (!prev || !updatedProspect) return updatedProspect;
              return {
                ...prev,
                ...updatedProspect,
                roofSurfaces: updatedProspect.roofSurfaces ?? prev.roofSurfaces,
                roofSurface: updatedProspect.roofSurface ?? prev.roofSurface,
              };
            });
          }}
          onValidateDrawing={() => {
            setShouldValidateDrawing(true);
          }}
          onSurfaceDelete={(surfaceId: string) => {
              if (prospect) {
                const surfaces = prospect.roofSurfaces || 
                  (prospect.roofSurface.area > 0 ? [{ ...prospect.roofSurface, id: `surface-0` }] : []);
                
                const updatedSurfaces = surfaces.filter(s => 
                  (s.id || `surface-${surfaces.indexOf(s)}`) !== surfaceId
                );
                
                const totalArea = updatedSurfaces.reduce((sum, s) => sum + s.area, 0);
                const estimatedKwp = surfaceToKwp(totalArea);
                const prev = prospect.solarPotential;
                const updatedProspect = {
                  ...prospect,
                  roofSurfaces: updatedSurfaces,
                  roofSurface: updatedSurfaces.length > 0 
                    ? updatedSurfaces[updatedSurfaces.length - 1] 
                    : { area: 0, polygon: [] },
                  qualityScore: calculateQualityScore(totalArea, prospect.placeType),
                  solarPotential: {
                    ...prev,
                    maxArrayPanelsCount: prev?.maxArrayPanelsCount ?? 0,
                    maxArrayAreaMeters2: totalArea > 0 ? (prev?.maxArrayAreaMeters2 ?? totalArea) : 0,
                    maxSunshineHoursPerYear: prev?.maxSunshineHoursPerYear ?? 0,
                    maxKwhPerYear: totalArea > 0 ? (prev?.maxKwhPerYear ?? 0) : 0,
                    monthlyProduction: totalArea > 0 ? prev?.monthlyProduction : undefined,
                    estimatedKwp,
                    pvgisDataFetched: false,
                  },
                };
                
                if (updatedSurfaces.length > 0) {
                  saveProspectSurfaces(updatedProspect);
                } else {
                  deleteProspectSurfaces(updatedProspect);
                }
                setProspect(updatedProspect);

                if (prospect.id) {
                  updateProspectInPipeline(prospect.id, updatedProspect, { estimatedKwp })
                    .then(() => toast.success("Surface supprimée"))
                    .catch((err) => {
                      console.error("Erreur Firestore après suppression de surface:", err);
                      toast.error("Erreur lors de la sauvegarde");
                    });
                }
              }
            }}
          searchResults={searchResults}
          onSearchResults={(results) => {
            // Réinitialiser centerCoordinates quand une nouvelle recherche est lancée
            // pour permettre l'ajustement automatique des bounds
            setCenterCoordinates(null);
            setSearchResults(results);
          }}
          onSearchResultSelect={handleSearchResultClick}
          getMapCenter={getMapCenter}
          // Debug: vérifier que getMapCenter est bien passé
          // (on peut retirer ce log plus tard)
        />
      </div>
    </div>
  );
}

export default function SolarScoutPage() {
  return (
    <Suspense fallback={<div className="flex h-screen w-full items-center justify-center bg-background">Chargement...</div>}>
      <SolarScoutContent />
    </Suspense>
  );
}
