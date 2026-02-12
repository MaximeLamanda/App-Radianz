"use client";

import { useState, useEffect, useCallback } from "react";
import { MapComponent } from "@/components/solar-scout/MapComponent";
import { Sidebar } from "@/components/solar-scout/Sidebar";
import { ProspectDrawer } from "@/components/solar-scout/ProspectDrawer";
import { GoogleMapsLoader } from "@/components/solar-scout/GoogleMapsLoader";
import { MapErrorBoundary } from "@/components/solar-scout/MapErrorBoundary";
import { getPlaceDetailsNew } from "@/lib/places-new-api";
import { surfaceToKwp } from "@/lib/surface-to-kwp";
import type { Prospect, AddressCoordinates, PlaceSearchResult } from "@/types";

const DEFAULT_ADDRESS = "7 Pl. du Vieux Théatre, 91410 Roinville, France";

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

export default function SolarScoutPage() {
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [shouldValidateDrawing, setShouldValidateDrawing] = useState(false);
  const [centerCoordinates, setCenterCoordinates] = useState<AddressCoordinates | null>(null);
  const [initialAddress, setInitialAddress] = useState<string>(DEFAULT_ADDRESS);
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
  const defaultCenter: AddressCoordinates = { lat: 48.5311, lng: 2.0508 }; // Roinville par défaut
  
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

  // Géocoder l'adresse par défaut au chargement
  useEffect(() => {
    if (typeof window !== "undefined" && window.google && window.google.maps) {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address: DEFAULT_ADDRESS }, (results, status) => {
        if (status === "OK" && results && results[0]) {
          const location = results[0].geometry.location;
          const coordinates: AddressCoordinates = {
            lat: location.lat(),
            lng: location.lng(),
          };
          setCenterCoordinates(coordinates);
        }
      });
    }
  }, []);

  const handleAddToPipeline = () => {
    // Réinitialiser le prospect après ajout
    setProspect(null);
    setIsDrawerOpen(false);
  };

  // Ouvrir le drawer quand un prospect est sélectionné
  useEffect(() => {
    if (prospect) {
      setIsDrawerOpen(true);
    }
  }, [prospect]);

  const handleAddressSelect = (address: string, coordinates: AddressCoordinates) => {
    // Centrer la carte sur l'adresse sélectionnée
    setCenterCoordinates(coordinates);
    
    // Mettre à jour le prospect avec l'adresse si un prospect existe déjà
    if (prospect) {
      setProspect({
        ...prospect,
        address,
        coordinates,
      });
    }
  };

  // Gérer le clic sur un résultat de recherche
  const handleSearchResultClick = async (result: PlaceSearchResult) => {
    // Centrer la carte sur le résultat
    setCenterCoordinates(result.coordinates);
    
    // Essayer d'obtenir les détails complets du lieu avec la nouvelle API
    const placeDetails = await getPlaceDetailsNew(result.placeId);
    
    // Créer un prospect à partir du résultat de recherche
    const newProspect: Prospect = {
      name: result.name,
      address: result.address,
      coordinates: result.coordinates,
      roofSurface: { area: 0, polygon: [] },
      placeType: placeDetails?.primaryTypeDisplayName || result.placeType,
      qualityScore: calculateQualityScore(0, result.placeType),
      contact: result.contact,
    };
    
    setProspect(newProspect);
  };

  return (
    <div className="h-screen relative overflow-hidden flex">
      {/* Map en plein écran avec transition */}
      <div 
        className={`h-full flex-1 transition-all duration-300 ease-in-out ${
          isDrawerOpen ? 'mr-[400px]' : 'mr-0'
        }`}
      >
        <MapErrorBoundary>
          <GoogleMapsLoader>
            <MapComponent
            onProspectUpdate={setProspect}
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
                    maxArrayAreaMeters2: totalArea,
                    maxSunshineHoursPerYear: prev?.maxSunshineHoursPerYear ?? 0,
                    maxKwhPerYear: prev?.maxKwhPerYear ?? 0,
                    estimatedKwp,
                    pvgisDataFetched: false, // Recalculer la production avec le nouveau kWp
                  },
                };
                return updatedProspect;
              });
            }}
            currentProspect={prospect}
            searchResults={searchResults}
            onSearchResultClick={handleSearchResultClick}
            onGetMapCenter={handleGetMapCenter}
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
            setProspect(updatedProspect);
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
                setProspect({
                  ...prospect,
                  roofSurfaces: updatedSurfaces,
                  roofSurface: updatedSurfaces.length > 0 
                    ? updatedSurfaces[updatedSurfaces.length - 1] 
                    : { area: 0, polygon: [] },
                  qualityScore: calculateQualityScore(totalArea, prospect.placeType),
                  solarPotential: {
                    ...prev,
                    maxArrayPanelsCount: prev?.maxArrayPanelsCount ?? 0,
                    maxArrayAreaMeters2: totalArea,
                    maxSunshineHoursPerYear: prev?.maxSunshineHoursPerYear ?? 0,
                    maxKwhPerYear: prev?.maxKwhPerYear ?? 0,
                    estimatedKwp,
                    pvgisDataFetched: false,
                  },
                });
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

      {/* Drawer pour les informations du prospect - positionné à droite */}
      <ProspectDrawer
        prospect={prospect}
        isOpen={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        onAddToPipeline={handleAddToPipeline}
        isDrawing={isDrawing}
        onDrawingChange={setIsDrawing}
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
                maxArrayAreaMeters2: totalArea,
                maxSunshineHoursPerYear: prev?.maxSunshineHoursPerYear ?? 0,
                maxKwhPerYear: prev?.maxKwhPerYear ?? 0,
                estimatedKwp,
                pvgisDataFetched: false,
              },
            };
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
            setProspect({
              ...prospect,
              roofSurfaces: updatedSurfaces,
              roofSurface: updatedSurfaces.length > 0 
                ? updatedSurfaces[updatedSurfaces.length - 1] 
                : { area: 0, polygon: [] },
              qualityScore: calculateQualityScore(totalArea, prospect.placeType),
              solarPotential: {
                ...prev,
                maxArrayPanelsCount: prev?.maxArrayPanelsCount ?? 0,
                maxArrayAreaMeters2: totalArea,
                maxSunshineHoursPerYear: prev?.maxSunshineHoursPerYear ?? 0,
                maxKwhPerYear: prev?.maxKwhPerYear ?? 0,
                estimatedKwp,
                pvgisDataFetched: false,
              },
            });
          }
        }}
        onProspectUpdate={(updatedProspect) => {
          setProspect(updatedProspect);
        }}
        onValidateDrawing={() => {
          setShouldValidateDrawing(true);
        }}
      />
    </div>
  );
}
