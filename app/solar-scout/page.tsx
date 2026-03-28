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
import { fetchWithAuth } from "@/lib/api-client";
import { logPolygonDrawer } from "@/lib/debug-polygon-drawer";
import { toast } from "sonner";
import type { Prospect, AddressCoordinates, PlaceSearchResult } from "@/types";

type BdnbDataForClick = {
  surfaceM2?: number | null;
  anneeConstruction?: number | null;
  batiment?: {
    id: string;
    polygonSurfaces: Array<{ polygon: Array<{ lat: number; lng: number }>; areaM2: number; orientation: number | null }>;
    totalAreaM2: number;
    anneeConstruction: number | null;
  };
};

type MapBounds = { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } };

type SitadelOpportunity = {
  id: number;
  num_permis: string | null;
  comm: string | null;
  dest_loc: string | null;
  surf_loc: number | null;
  nature_projet: string | null;
  date_reelle_auth: string | null;
  date_doc: string | null;
  date_ouverture_chantier: string | null;
  date_achevement_travaux: string | null;
  annee_source: number | null;
  lat: number;
  lng: number;
  ape_dem?: string | null;
  cj_dem?: string | null;
  denom_dem?: string | null;
  siren_dem?: string | null;
  siret_dem?: string | null;
};

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
  const [osmBoundsToFetch, setOsmBoundsToFetch] = useState<{ ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null>(null);
  const [surfaceRange, setSurfaceRange] = useState<{ min: number; max: number }>({ min: 200, max: 2000 });
  const [isAnalysingBuildings, setIsAnalysingBuildings] = useState(false);
  const [getMapBoundsFunc, setGetMapBoundsFunc] = useState<(() => { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null) | null>(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState<"analyser" | "recherche" | "permis">("recherche");
  const [mapBoundsForPermis, setMapBoundsForPermis] = useState<MapBounds | null>(null);
  const [sitadelOpportunities, setSitadelOpportunities] = useState<SitadelOpportunity[]>([]);
  const [isSitadelLoading, setIsSitadelLoading] = useState(false);
  const [sitadelError, setSitadelError] = useState<string | null>(null);
  const [sitadelTruncated, setSitadelTruncated] = useState(false);
  const [selectedSourceYears, setSelectedSourceYears] = useState<number[]>([
    2020, 2021, 2022, 2023, 2024, 2025, 2026,
  ]);
  const hasAutoLoadedPermisRef = useRef(false);

  // À la fermeture du drawer : retirer prospectId de l'URL (sans recharger) mais garder le prospect/polygone sélectionné sur la carte
  const handleDrawerOpenChange = useCallback(
    (open: boolean) => {
      setIsDrawerOpen(open);
      if (!open && searchParams.get("prospectId")) {
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
  /** Incrémenté pour recentrer la carte après fermeture de la recherche bâtiments */
  const [mapViewResetKey, setMapViewResetKey] = useState(0);
  const [getMapCenterFunc, setGetMapCenterFunc] = useState<(() => AddressCoordinates | null) | null>(null);
  const [isBdnbEnrichingForProspect, setIsBdnbEnrichingForProspect] = useState(false);
  
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
  
  const handleGetMapBounds = useCallback((func: (() => { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null) | null) => {
    if (func && typeof func === 'function') {
      setGetMapBoundsFunc(() => func);
    }
  }, []);

  const handleAnalyseBuildings = useCallback(() => {
    if (getMapBoundsFunc && typeof getMapBoundsFunc === 'function') {
      const bounds = getMapBoundsFunc();
      if (bounds) setOsmBoundsToFetch(bounds);
    }
  }, [getMapBoundsFunc]);

  const handleResetSearch = useCallback(() => {
    setSearchResults([]);
    setCenterCoordinates(null);
    setInitialAddress("");
    setMapViewResetKey((k) => k + 1);
  }, []);

  const fetchSitadelOpportunities = useCallback(
    async (boundsOverride?: MapBounds | null) => {
      const bounds = boundsOverride ?? mapBoundsForPermis ?? getMapBoundsFunc?.() ?? null;
      if (!bounds) return;
      setIsSitadelLoading(true);
      setSitadelError(null);
      try {
        const params = new URLSearchParams({
          ne_lat: String(bounds.ne.lat),
          ne_lng: String(bounds.ne.lng),
          sw_lat: String(bounds.sw.lat),
          sw_lng: String(bounds.sw.lng),
          limit: "12000",
        });
        if (selectedSourceYears.length > 0) {
          params.set("source_years", selectedSourceYears.join(","));
        }
        const res = await fetchWithAuth(`/api/sitadel-opportunities?${params.toString()}`);
        if (res.status === 403) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.message ?? "Quota Sitadel carte atteint.");
        }
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Erreur API Sitadel.");
        }
        const json = await res.json();
        setSitadelOpportunities(Array.isArray(json.opportunities) ? json.opportunities : []);
        setSitadelTruncated(Boolean(json.meta?.truncated));
      } catch (error) {
        setSitadelError(error instanceof Error ? error.message : "Erreur de chargement Sitadel.");
        setSitadelOpportunities([]);
        setSitadelTruncated(false);
      } finally {
        setIsSitadelLoading(false);
      }
    },
    [getMapBoundsFunc, mapBoundsForPermis, selectedSourceYears]
  );

  useEffect(() => {
    if (activeSidebarTab !== "permis") return;
    if (hasAutoLoadedPermisRef.current) return;
    const initialBounds = mapBoundsForPermis ?? getMapBoundsFunc?.() ?? null;
    if (!initialBounds) return;
    hasAutoLoadedPermisRef.current = true;
    void fetchSitadelOpportunities(initialBounds);
  }, [activeSidebarTab, mapBoundsForPermis, getMapBoundsFunc, fetchSitadelOpportunities]);

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
      logPolygonDrawer("page:drawer-effect", {
        prospectId: prospect.id,
        placeId: prospect.placeId,
        addressPreview: prospect.address?.slice(0, 40),
        roofSurfacesCount: prospect.roofSurfaces?.length ?? 0,
        roofSurfaceArea: prospect.roofSurface?.area,
        firstSurfaceId: prospect.roofSurfaces?.[0]?.id ?? "(roofSurface only)",
      });
      setIsDrawerOpen(true);
      setDrawerContent(
        <ProspectDrawer
          prospect={prospect}
          bdnbLoading={isBdnbEnrichingForProspect}
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
              if (!updatedProspect) return prev;
              if (!prev) return updatedProspect as Prospect;
              const merged: Prospect = {
                ...prev,
                ...updatedProspect,
                // Conserver les roofSurfaces du state courant si updatedProspect
                // n'en apporte pas de nouvelles (cas PVGIS qui ne touche qu'à solarPotential)
                roofSurfaces: updatedProspect.roofSurfaces ?? prev.roofSurfaces,
                roofSurface: updatedProspect.roofSurface ?? prev.roofSurface,
              };
              logPolygonDrawer("page:drawer-onProspectUpdate", {
                source: "ProspectDrawer",
                prevSurfaces: prev.roofSurfaces?.length ?? 0,
                updatedHasRoofSurfaces: updatedProspect.roofSurfaces != null,
                updatedSurfacesLen: updatedProspect.roofSurfaces?.length,
                mergedSurfaces: merged.roofSurfaces?.length ?? 0,
                keysPatch: Object.keys(updatedProspect),
              });
              return merged;
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
  }, [prospect, isDrawing, isBdnbEnrichingForProspect, setIsDrawerOpen, setDrawerContent, handleAddToPipeline, handleDrawerOpenChange]);

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

  /** Tableau Analyser → « Voir » : carte + polygone OSM sans passer par handleAddressSelect (évite loadProspectSurfaces qui écrase les surfaces). */
  const handleFocusBuildingFromAnalysis = useCallback(
    (focused: Prospect, center: AddressCoordinates) => {
      setCenterCoordinates(center);
      setProspect((prev) => {
        if (!prev) return focused;
        return {
          ...prev,
          ...focused,
          roofSurfaces: focused.roofSurfaces ?? prev.roofSurfaces,
          roofSurface: focused.roofSurface ?? prev.roofSurface,
        };
      });
    },
    []
  );

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
  const handleSearchResultClick = async (result: PlaceSearchResult, bdnbData?: BdnbDataForClick) => {
    setCenterCoordinates(result.coordinates);
    setIsBdnbEnrichingForProspect(false);

    const placeDetails = await getPlaceDetailsNew(result.placeId);
    const fullAddress = placeDetails?.formattedAddress || result.address;
    const displayName = placeDetails?.displayName || result.name;

    const existingProspect = await getProspectByPlaceId(result.placeId);
    if (existingProspect) {
      setProspect(existingProspect);
      return;
    }

    let newProspect: Prospect = {
      name: displayName,
      address: fullAddress,
      coordinates: result.coordinates,
      roofSurface: { area: 0, polygon: [] },
      placeType: placeDetails?.primaryTypeDisplayName || result.placeType,
      placeId: result.placeId,
      qualityScore: calculateQualityScore(0, result.placeType),
      contact: result.contact,
    };

    if (bdnbData?.batiment?.polygonSurfaces?.length) {
      const roofSurfaces = bdnbData.batiment.polygonSurfaces.map((s, i) => ({
        id: `bdnb-${bdnbData.batiment!.id}-${i}`,
        area: s.areaM2,
        polygon: s.polygon,
        orientation: s.orientation ?? undefined,
      }));
      const totalArea = roofSurfaces.reduce((sum, s) => sum + s.area, 0);
      newProspect = {
        ...newProspect,
        roofSurfaces,
        roofSurface: roofSurfaces[0] ?? { area: 0, polygon: [] },
        anneeConstruction: bdnbData.batiment.anneeConstruction ?? undefined,
        bdnbBatimentId: bdnbData.batiment.id,
        qualityScore: calculateQualityScore(totalArea, newProspect.placeType),
      };
    } else {
      setIsBdnbEnrichingForProspect(true);
      const bdnbRes = await fetchWithAuth(
        `/api/bdnb?lat=${result.coordinates.lat}&lng=${result.coordinates.lng}`
      );
      if (bdnbRes.status === 403) {
        const json = await bdnbRes.json().catch(() => ({}));
        toast.error(json.message ?? "Quota BDNB atteint. Passez en Premium pour augmenter vos limites.");
      }
      if (bdnbRes.ok) {
        const bdnbJson = await bdnbRes.json();
        const bat = bdnbJson?.batiment;
        if (bat?.polygonSurfaces?.length) {
          const roofSurfaces = bat.polygonSurfaces.map((s: { polygon: Array<{ lat: number; lng: number }>; areaM2: number; orientation?: number | null }, i: number) => ({
            id: `bdnb-${bat.id}-${i}`,
            area: s.areaM2,
            polygon: s.polygon,
            orientation: s.orientation ?? undefined,
          }));
          const totalArea = roofSurfaces.reduce((sum: number, s: { area: number }) => sum + s.area, 0);
          newProspect = {
            ...newProspect,
            roofSurfaces,
            roofSurface: roofSurfaces[0] ?? { area: 0, polygon: [] },
            anneeConstruction: bat.anneeConstruction ?? undefined,
            bdnbBatimentId: bat.id,
            qualityScore: calculateQualityScore(totalArea, newProspect.placeType),
          };
        } else if (bat?.anneeConstruction != null) {
          newProspect = {
            ...newProspect,
            anneeConstruction: bat.anneeConstruction,
            bdnbBatimentId: bat.id,
          };
        }
      }
      setIsBdnbEnrichingForProspect(false);
    }

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
            onProspectUpdate={(updatedProspect) => {
              pendingBdnbSurfacesRef.current = null;
              setProspect((prev) => {
                if (!updatedProspect) return prev;
                if (!prev) return updatedProspect as Prospect;
                const merged: Prospect = {
                  ...prev,
                  ...updatedProspect,
                  roofSurfaces: updatedProspect.roofSurfaces ?? prev.roofSurfaces,
                  roofSurface: updatedProspect.roofSurface ?? prev.roofSurface,
                };
                logPolygonDrawer("page:map-onProspectUpdate", {
                  prevSurfaces: prev.roofSurfaces?.length ?? 0,
                  updatedHasRoofSurfaces: updatedProspect.roofSurfaces != null,
                  updatedSurfacesLen: updatedProspect.roofSurfaces?.length,
                  mergedSurfaces: merged.roofSurfaces?.length ?? 0,
                  keysPatch: Object.keys(updatedProspect),
                });
                return merged;
              });
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
            onOsmPolygonClick={() => setSearchResults([])}
            onOsmEnrichmentChange={setIsBdnbEnrichingForProspect}
            onGetMapCenter={handleGetMapCenter}
            onBdnbInfo={(info) => {
              setProspect((prev) => {
                if (!prev) return prev;
                return { ...prev, anneeConstruction: info.anneeConstruction };
              });
            }}
            osmBoundsToFetch={osmBoundsToFetch}
            surfaceRange={surfaceRange}
            onOsmBuildingsLoadingChange={setIsAnalysingBuildings}
            onGetMapBounds={handleGetMapBounds}
            onViewBoundsChange={setMapBoundsForPermis}
            mapViewResetKey={mapViewResetKey}
            permisOpportunities={sitadelOpportunities}
            showPermisLayer={activeSidebarTab === "permis"}
            onBdnbSurface={(bdnbSurfaces) => {
              logPolygonDrawer("page:onBdnbSurface", {
                bdnbCount: bdnbSurfaces?.length ?? 0,
              });
              // Mémoriser dans le ref pour que onProspectUpdate puisse les réinjecter
              pendingBdnbSurfacesRef.current = bdnbSurfaces && bdnbSurfaces.length > 0 ? bdnbSurfaces : null;

              setProspect((prev) => {
                if (!prev) return prev;
                // Surfaces manuelles = uniquement les surfaces dessinées (exclure bdnb- et osm-)
                const manualSurfaces = (prev.roofSurfaces ?? []).filter(
                  (s) => !s.id?.startsWith("bdnb-") && !s.id?.startsWith("osm-")
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
          onFocusBuildingFromAnalysis={handleFocusBuildingFromAnalysis}
          initialAddress={initialAddress}
          isDrawing={isDrawing}
          onDrawingChange={setIsDrawing}
          onProspectUpdate={(updatedProspect) => {
            setProspect((prev) => {
              if (!updatedProspect) return prev;
              if (!prev) return updatedProspect as Prospect;
              const merged: Prospect = {
                ...prev,
                ...updatedProspect,
                roofSurfaces: updatedProspect.roofSurfaces ?? prev.roofSurfaces,
                roofSurface: updatedProspect.roofSurface ?? prev.roofSurface,
              };
              return merged;
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
          onAnalyseBuildings={handleAnalyseBuildings}
          isAnalysingBuildings={isAnalysingBuildings}
          osmBoundsToFetch={osmBoundsToFetch}
          surfaceRange={surfaceRange}
          onSurfaceRangeChange={setSurfaceRange}
          onTabChange={setActiveSidebarTab}
          onResetSearch={handleResetSearch}
          permisState={{
            loading: isSitadelLoading,
            count: sitadelOpportunities.length,
            truncated: sitadelTruncated,
            error: sitadelError,
          }}
          onRefreshPermis={() => {
            void fetchSitadelOpportunities();
          }}
          selectedSourceYears={selectedSourceYears}
          onToggleSourceYear={(year) => {
            setSelectedSourceYears((prev) => {
              if (prev.includes(year)) {
                // Garder au moins 1 source sélectionnée.
                if (prev.length === 1) return prev;
                return prev.filter((y) => y !== year);
              }
              return [...prev, year].sort();
            });
          }}
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
