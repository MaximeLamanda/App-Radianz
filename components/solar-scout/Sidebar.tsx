"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Table, Sun, Zap, Square, Clock, Pencil, Check, X, Trash2, Layers } from "lucide-react";
import { addProspectToPipeline, createLeadFromProspect } from "@/lib/firestore";
import { translatePlaceType } from "@/lib/place-types-translation";
import type { Prospect, AddressCoordinates } from "@/types";

interface SidebarProps {
  prospect: Prospect | null;
  onAddToPipeline: () => void;
  onAddressSelect?: (address: string, coordinates: AddressCoordinates) => void;
  initialAddress?: string;
  isDrawing?: boolean;
  onDrawingChange?: (isDrawing: boolean) => void;
  onSurfaceUpdate?: (surface: { area: number; polygon: Array<{ lat: number; lng: number }> }) => void;
  onSurfaceDelete?: (surfaceId: string) => void;
  onProspectUpdate?: (prospect: Prospect) => void;
  onValidateDrawing?: () => void;
}

export function Sidebar({ 
  prospect, 
  onAddToPipeline, 
  onAddressSelect, 
  initialAddress,
  isDrawing = false,
  onDrawingChange,
  onSurfaceUpdate,
  onSurfaceDelete,
  onProspectUpdate,
  onValidateDrawing
}: SidebarProps) {
  const [address, setAddress] = useState(initialAddress || "");
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  // Initialiser l'adresse avec l'adresse initiale si fournie
  useEffect(() => {
    if (initialAddress && !address) {
      setAddress(initialAddress);
    }
  }, [initialAddress]);

  // Mettre à jour l'adresse quand le prospect change (depuis un clic sur la carte)
  useEffect(() => {
    if (prospect && prospect.address) {
      setAddress(prospect.address);
    }
  }, [prospect]);

  // Initialiser l'autocomplétion Google Places
  useEffect(() => {
    if (!inputRef.current) return;
    if (!window.google || !window.google.maps || !window.google.maps.places) {
      return;
    }

    const maps = window.google.maps;
    
    // Créer l'autocomplétion
    const autocomplete = new maps.places.Autocomplete(inputRef.current, {
      types: ["address"],
      fields: ["formatted_address", "geometry", "name", "place_id"],
    });

    autocompleteRef.current = autocomplete;

    // Écouter la sélection d'une adresse
    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      
      if (!place.geometry || !place.geometry.location) {
        console.error("Aucune géométrie trouvée pour cette adresse");
        return;
      }

      const addressText = place.formatted_address || place.name || address;
      const coordinates: AddressCoordinates = {
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
      };

      setAddress(addressText);
      
      // Notifier le composant parent
      if (onAddressSelect) {
        onAddressSelect(addressText, coordinates);
      }
    });

    return () => {
      if (autocompleteRef.current) {
        maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [onAddressSelect, address]);

  const handleSearch = () => {
    if (!autocompleteRef.current) {
      // Fallback : géocoder l'adresse manuellement
      if (!window.google || !window.google.maps) return;
      
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address }, (results, status) => {
        if (status === "OK" && results && results[0]) {
          const result = results[0];
          const coordinates: AddressCoordinates = {
            lat: result.geometry.location.lat(),
            lng: result.geometry.location.lng(),
          };
          
          setAddress(result.formatted_address);
          
          if (onAddressSelect) {
            onAddressSelect(result.formatted_address, coordinates);
          }
        } else {
          console.error("Erreur de géocodage:", status);
          alert("Adresse introuvable. Veuillez essayer une autre adresse.");
        }
      });
    }
  };

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
    } catch (error) {
      console.error("Erreur lors de l'ajout au pipeline:", error);
      alert("Erreur lors de l'ajout au pipeline. Veuillez réessayer.");
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="w-96 flex flex-col gap-4 max-h-[calc(100vh-48px)] overflow-y-auto">
      {/* Partie 1: Recherche d'adresse */}
      <Card className="rounded-lg shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg">Recherche d'adresse</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                id="address"
                placeholder="Entrez une adresse..."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
              />
              <Button 
                onClick={handleSearch} 
                size="icon"
                variant="outline"
                className="border border-gray-300"
              >
                <Search className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Commencez à taper pour voir les suggestions d'adresses
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Partie 2: Informations du prospect */}
      <Card className="rounded-lg shadow-lg bg-gray-50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Informations du prospect</CardTitle>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                // TODO: Navigation vers la liste des leads
                console.log("Navigation vers la liste des leads");
              }}
              className="h-8 w-8 border border-gray-300"
            >
              <Table className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {prospect ? (
            <>
              {prospect.name && (
                <div className="bg-white rounded-md py-3 px-4">
                  <div className="text-sm font-medium">
                    {prospect.name}
                  </div>
                </div>
              )}
              {prospect.address && (
                <div className="bg-white rounded-md py-3 px-4">
                  <div className="text-sm font-medium">
                    {prospect.address}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <div className="flex-1 bg-white rounded-md py-3 px-4 text-sm text-muted-foreground">
                  Lat: {prospect.coordinates.lat.toFixed(6)}
                </div>
                <div className="flex-1 bg-white rounded-md py-3 px-4 text-sm text-muted-foreground">
                  Lng: {prospect.coordinates.lng.toFixed(6)}
                </div>
              </div>

              {/* Section des surfaces */}
              <div className="bg-white rounded-md py-3 px-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-gray-700">Surfaces</div>
                  {!isDrawing && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        console.log("[Surface] Activation du mode dessin depuis le bouton");
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
                    
                    console.log("[Surface] Surfaces à afficher:", surfaces.length, surfaces);
                    
                    if (surfaces.length === 0) {
                      return (
                        <div className="text-sm text-muted-foreground text-center py-2">
                          Aucune surface définie
                        </div>
                      );
                    }

                    return surfaces.map((surface, index) => {
                      const surfaceId = surface.id || `surface-${index}`;
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
                            
                            {/* Informations de la surface */}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium">
                                {surface.area.toFixed(2)} m²
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {surface.polygon.length} points
                              </div>
                            </div>
                            
                            {/* Bouton de suppression */}
                            {!isDrawing && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  console.log(`[Surface] Suppression de la surface ${surfaceId}`);
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
                        console.log("[Surface] Bouton Valider cliqué");
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
                        console.log("[Surface] Bouton Annuler cliqué");
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
                <div className="bg-white rounded-md py-3 px-4">
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>Nord: {prospect.exposure.north}%</div>
                    <div>Sud: {prospect.exposure.south}%</div>
                    <div>Est: {prospect.exposure.east}%</div>
                    <div>Ouest: {prospect.exposure.west}%</div>
                  </div>
                </div>
              )}

              {/* Données solaires */}
              {prospect.solarPotential && (
                <div className="bg-white rounded-md py-3 px-4 space-y-3 border-t-2 border-yellow-200">
                  <div className="text-sm font-semibold text-yellow-700 flex items-center gap-2">
                    <Sun className="h-4 w-4" />
                    Potentiel solaire
                  </div>
                  
                  {prospect.solarPotential.maxKwhPerYear > 0 && (
                    <div className="flex items-center gap-2 text-sm">
                      <Zap className="h-4 w-4 text-yellow-600" />
                      <span className="text-muted-foreground">Production annuelle:</span>
                      <span className="font-medium">
                        {prospect.solarPotential.maxKwhPerYear.toLocaleString('fr-FR')} kWh/an
                      </span>
                    </div>
                  )}
                  
                  {prospect.solarPotential.maxArrayPanelsCount > 0 && (
                    <div className="flex items-center gap-2 text-sm">
                      <Square className="h-4 w-4 text-yellow-600" />
                      <span className="text-muted-foreground">Panneaux possibles:</span>
                      <span className="font-medium">
                        {prospect.solarPotential.maxArrayPanelsCount}
                      </span>
                    </div>
                  )}
                  
                  {prospect.solarPotential.maxArrayAreaMeters2 > 0 && (
                    <div className="flex items-center gap-2 text-sm">
                      <Square className="h-4 w-4 text-yellow-600" />
                      <span className="text-muted-foreground">Surface disponible:</span>
                      <span className="font-medium">
                        {prospect.solarPotential.maxArrayAreaMeters2.toFixed(2)} m²
                      </span>
                    </div>
                  )}
                  
                  {prospect.solarPotential.maxSunshineHoursPerYear > 0 && (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-yellow-600" />
                      <span className="text-muted-foreground">Heures d'ensoleillement:</span>
                      <span className="font-medium">
                        {prospect.solarPotential.maxSunshineHoursPerYear.toLocaleString('fr-FR')} h/an
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-white rounded-md py-3 px-4">
                <div className="text-sm font-medium">
                  {/* Si le type contient déjà un libellé français (de primaryTypeDisplayName), l'afficher tel quel
                      Sinon, utiliser la traduction */}
                  {prospect.placeType.includes(" ") || prospect.placeType === prospect.placeType.toUpperCase() 
                    ? prospect.placeType 
                    : translatePlaceType(prospect.placeType)}
                </div>
              </div>

              <div className="bg-white rounded-md py-3 px-4">
                <div className="text-sm font-medium">
                  {prospect.qualityScore}/100
                </div>
              </div>

              <Button
                onClick={handleAddToPipeline}
                className="w-full mt-6"
                size="lg"
                disabled={isAdding}
              >
                <Plus className="h-4 w-4 mr-2" />
                {isAdding ? "Ajout en cours..." : "Ajouter au pipeline"}
              </Button>
            </>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">
              Cliquez sur la carte pour obtenir les informations d'un lieu
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
