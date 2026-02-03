"use client";

import { useState, useEffect } from "react";
import { MapComponent } from "@/components/solar-scout/MapComponent";
import { Sidebar } from "@/components/solar-scout/Sidebar";
import { GoogleMapsLoader } from "@/components/solar-scout/GoogleMapsLoader";
import { MapErrorBoundary } from "@/components/solar-scout/MapErrorBoundary";
import type { Prospect, AddressCoordinates } from "@/types";

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
  const [isDrawing, setIsDrawing] = useState(false);
  const [shouldValidateDrawing, setShouldValidateDrawing] = useState(false);
  const [centerCoordinates, setCenterCoordinates] = useState<AddressCoordinates | null>(null);
  const [initialAddress, setInitialAddress] = useState<string>(DEFAULT_ADDRESS);

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
  };

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

  return (
    <div className="h-screen relative">
      {/* Map en plein écran */}
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
            onSurfaceUpdate={(surface) => {
              console.log("[Surface] onSurfaceUpdate appelé depuis MapComponent", surface);
              setProspect((currentProspect) => {
                if (!currentProspect) {
                  console.warn("[Surface] Pas de prospect actuel, impossible d'ajouter la surface");
                  return currentProspect;
                }
                
                // Générer un ID unique pour la nouvelle surface
                const newSurface = {
                  id: `surface-${Date.now()}`,
                  ...surface,
                };
                
                console.log("[Surface] Nouvelle surface créée:", newSurface);
                
                // Ajouter à la liste des surfaces ou créer le tableau
                const existingSurfaces = currentProspect.roofSurfaces || 
                  (currentProspect.roofSurface.area > 0 
                    ? [{ ...currentProspect.roofSurface, id: `surface-${Date.now() - 1000}` }] 
                    : []);
                
                console.log("[Surface] Surfaces existantes:", existingSurfaces.length);
                
                const updatedSurfaces = [...existingSurfaces, newSurface];
                const totalArea = updatedSurfaces.reduce((sum, s) => sum + s.area, 0);
                
                console.log("[Surface] Surfaces mises à jour:", updatedSurfaces.length, "Surface totale:", totalArea);
                
                const updatedProspect = {
                  ...currentProspect,
                  roofSurfaces: updatedSurfaces,
                  roofSurface: newSurface, // Garder la dernière pour compatibilité
                  qualityScore: calculateQualityScore(totalArea, currentProspect.placeType),
                };
                
                console.log("[Surface] Prospect mis à jour:", updatedProspect);
                return updatedProspect;
              });
            }}
            currentProspect={prospect}
          />
        </GoogleMapsLoader>
      </MapErrorBoundary>
      
      {/* Sidebar positionnée par-dessus la map */}
      <div className="absolute top-6 left-6 z-50">
        <Sidebar 
          prospect={prospect} 
          onAddToPipeline={handleAddToPipeline}
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
                
                setProspect({
                  ...prospect,
                  roofSurfaces: updatedSurfaces,
                  roofSurface: updatedSurfaces.length > 0 
                    ? updatedSurfaces[updatedSurfaces.length - 1] 
                    : { area: 0, polygon: [] },
                  qualityScore: calculateQualityScore(totalArea, prospect.placeType),
                });
              }
            }}
          />
      </div>
    </div>
  );
}
