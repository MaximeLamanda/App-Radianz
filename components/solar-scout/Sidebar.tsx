"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Plus, Loader2, MapPin, Table, Settings, X } from "lucide-react";
import { searchPlacesByType } from "@/lib/places-search";
import { SatelliteImage } from "./SatelliteImage";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { AddressCoordinates, PlaceSearchResult, PlaceSearchType, Prospect, SolarPanelType, InverterType, SolarEquipmentSettings } from "@/types";

interface SidebarProps {
  onAddressSelect?: (address: string, coordinates: AddressCoordinates) => void;
  initialAddress?: string;
  isDrawing?: boolean;
  onDrawingChange?: (isDrawing: boolean) => void;
  onSurfaceUpdate?: (surface: { area: number; polygon: Array<{ lat: number; lng: number }> }) => void;
  onSurfaceDelete?: (surfaceId: string) => void;
  onProspectUpdate?: (prospect: Prospect) => void;
  onValidateDrawing?: () => void;
  searchResults?: PlaceSearchResult[];
  onSearchResults?: (results: PlaceSearchResult[]) => void;
  onSearchResultSelect?: (result: PlaceSearchResult) => void;
  getMapCenter?: () => AddressCoordinates | null;
}

export function Sidebar({ 
  onAddressSelect, 
  initialAddress,
  isDrawing = false,
  onDrawingChange,
  onSurfaceUpdate,
  onSurfaceDelete,
  onProspectUpdate,
  onValidateDrawing,
  searchResults = [],
  onSearchResults,
  onSearchResultSelect,
  getMapCenter
}: SidebarProps) {
  const [address, setAddress] = useState(initialAddress || "");
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  
  // États pour la recherche par type
  const [selectedPlaceType, setSelectedPlaceType] = useState<PlaceSearchType | "">("");
  const [selectedDistance, setSelectedDistance] = useState<string>("1000");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // États pour les paramètres d'équipement solaire
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [panelType, setPanelType] = useState<SolarPanelType>("monocrystalline");
  const [inverterType, setInverterType] = useState<InverterType>("string_inverter");
  const [panelPowerW, setPanelPowerW] = useState<string>("400");
  const [panelEfficiency, setPanelEfficiency] = useState<string>("20");

  // Charger les paramètres depuis localStorage au montage
  useEffect(() => {
    const savedSettings = localStorage.getItem("solarEquipmentSettings");
    if (savedSettings) {
      try {
        const settings: SolarEquipmentSettings = JSON.parse(savedSettings);
        setPanelType(settings.panelType || "monocrystalline");
        setInverterType(settings.inverterType || "string_inverter");
        if (settings.panelPowerW) setPanelPowerW(settings.panelPowerW.toString());
        if (settings.panelEfficiency) setPanelEfficiency(settings.panelEfficiency.toString());
      } catch (error) {
        console.error("Erreur lors du chargement des paramètres:", error);
      }
    }
  }, []);

  // Sauvegarder les paramètres dans localStorage quand ils changent
  useEffect(() => {
    const settings: SolarEquipmentSettings = {
      panelType,
      inverterType,
      panelPowerW: parseInt(panelPowerW) || undefined,
      panelEfficiency: parseFloat(panelEfficiency) || undefined,
    };
    localStorage.setItem("solarEquipmentSettings", JSON.stringify(settings));
  }, [panelType, inverterType, panelPowerW, panelEfficiency]);

  // Initialiser l'adresse avec l'adresse initiale si fournie
  useEffect(() => {
    if (initialAddress && !address) {
      setAddress(initialAddress);
    }
  }, [initialAddress]);


  // Initialiser l'autocomplétion Google Places pour la recherche d'adresse principale
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
          alert("Adresse introuvable. Veuillez essayer une autre adresse.");
        }
      });
    }
  };


  // Fonction pour rechercher les lieux par type
  const handleSearchByType = async () => {
    if (!selectedPlaceType) {
      setSearchError("Veuillez sélectionner un type de lieu");
      return;
    }

    if (!getMapCenter || typeof getMapCenter !== 'function') {
      setSearchError("La fonction de récupération du centre de la carte n'est pas disponible");
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      // Obtenir le centre de la carte actuelle en utilisant la méthode native getCenter()
      const coordinates = getMapCenter();

      if (!coordinates) {
        console.error("[Sidebar] ERREUR: coordinates est null ou undefined");
        throw new Error("Impossible d'obtenir le centre de la carte");
      }
      
      if (!coordinates.lat || !coordinates.lng) {
        console.error("[Sidebar] ERREUR: coordinates n'a pas lat ou lng:", coordinates);
        throw new Error("Coordonnées invalides obtenues du centre de la carte");
      }
      

      // Rechercher les lieux
      const radius = parseInt(selectedDistance);
      const results = await searchPlacesByType(coordinates, selectedPlaceType as PlaceSearchType, radius);
      
      if (onSearchResults) {
        onSearchResults(results);
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Erreur lors de la recherche");
    } finally {
      setIsSearching(false);
    }
  };

  // Options de types de lieux avec les types importants en premier
  const placeTypeOptions: { value: PlaceSearchType; label: string }[] = [
    { value: "factory", label: "Usine" },
    { value: "warehouse", label: "Entrepôt logistique" },
    { value: "industrial", label: "Zone industrielle" },
    { value: "storage", label: "Installation de stockage" },
    { value: "store", label: "Magasin" },
    { value: "supermarket", label: "Supermarché" },
    { value: "office", label: "Bureau" },
    { value: "gym", label: "Salle de sport" },
    { value: "restaurant", label: "Restaurant" },
    { value: "shopping_mall", label: "Centre commercial" },
  ];

  // Options de distance
  const distanceOptions = [
    { value: "500", label: "500 m" },
    { value: "1000", label: "1 km" },
    { value: "2000", label: "2 km" },
    { value: "5000", label: "5 km" },
    { value: "10000", label: "10 km" },
  ];

  return (
    <div className="w-96 flex flex-col gap-4 max-h-[calc(100vh-48px)] overflow-y-auto">
      {/* Partie 1: Recherche avec onglets */}
      <Card className="rounded-lg shadow-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Recherche</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setIsSettingsOpen(true)}
                className="h-8 w-8 border border-gray-300"
                title="Paramètres"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  // TODO: Navigation vers la liste des leads
                }}
                className="h-8 w-8 border border-gray-300"
                title="Voir la liste des leads"
              >
                <Table className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="address" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="address">Par adresse</TabsTrigger>
              <TabsTrigger value="type">Par type</TabsTrigger>
            </TabsList>
            
            {/* Onglet Recherche par adresse */}
            <TabsContent value="address" className="space-y-4 mt-4">
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
            </TabsContent>

            {/* Onglet Recherche par type */}
            <TabsContent value="type" className="space-y-4 mt-4">
              <div className="space-y-4">
                {/* Sélecteur de type de lieu */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Type de lieu</label>
                  <Select value={selectedPlaceType} onValueChange={(value) => setSelectedPlaceType(value as PlaceSearchType)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionnez un type de lieu" />
                    </SelectTrigger>
                    <SelectContent>
                      {placeTypeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Sélecteur de distance */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Distance</label>
                  <Select value={selectedDistance} onValueChange={setSelectedDistance}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {distanceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Bouton de recherche */}
                <Button 
                  onClick={handleSearchByType} 
                  className="w-full"
                  disabled={isSearching || !selectedPlaceType}
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Recherche en cours...
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      Rechercher
                    </>
                  )}
                </Button>

                {/* Affichage des erreurs */}
                {searchError && (
                  <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">
                    {searchError}
                  </div>
                )}

                {/* Affichage du nombre de résultats */}
                {searchResults.length > 0 && (
                  <div className="text-sm font-medium text-gray-700 bg-blue-50 rounded-md p-2">
                    {searchResults.length} résultat{searchResults.length > 1 ? "s" : ""} trouvé{searchResults.length > 1 ? "s" : ""}
                  </div>
                )}

                {/* Liste des résultats */}
                {searchResults.length > 0 && (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {searchResults.map((result) => (
                      <div
                        key={result.placeId}
                        onClick={() => {
                          if (onSearchResultSelect) {
                            onSearchResultSelect(result);
                          }
                        }}
                        className="bg-white rounded-md border border-gray-200 hover:border-gray-300 hover:bg-gray-50 cursor-pointer transition-colors overflow-hidden"
                      >
                        {/* Image satellite */}
                        <div className="w-full">
                          <SatelliteImage 
                            coordinates={result.coordinates} 
                            address={result.address}
                            zoom={17}
                            width={400}
                            height={200}
                            className="rounded-t-md"
                            onClick={() => {
                              if (onSearchResultSelect) {
                                onSearchResultSelect(result);
                              }
                            }}
                          />
                        </div>
                        {/* Informations du lieu */}
                        <div className="p-3">
                          <div className="text-sm font-medium">{result.name}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                            <MapPin className="h-3 w-3" />
                            {result.address}
                          </div>
                          {result.rating && (
                            <div className="text-xs text-muted-foreground mt-1">
                              ⭐ {result.rating.toFixed(1)} {result.userRatingsTotal ? `(${result.userRatingsTotal})` : ""}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Drawer des paramètres */}
      <Drawer open={isSettingsOpen} onOpenChange={setIsSettingsOpen} direction="right" shouldScaleBackground={false}>
        <DrawerContent className="h-full w-[400px] right-0 top-0 left-auto p-0 flex flex-col border-l shadow-xl z-20">
          <DrawerHeader className="border-b bg-white">
            <div className="flex items-center justify-between">
              <DrawerTitle>Paramètres</DrawerTitle>
              <DrawerClose asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 border border-gray-300"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DrawerClose>
            </div>
            <DrawerDescription>
              Configuration des équipements solaires pour les calculs de potentiel
            </DrawerDescription>
          </DrawerHeader>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Sélecteur de type de panneau */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Type de panneau solaire</label>
              <Select value={panelType} onValueChange={(value) => setPanelType(value as SolarPanelType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monocrystalline">Monocristallin</SelectItem>
                  <SelectItem value="polycrystalline">Polycristallin</SelectItem>
                  <SelectItem value="thin_film">Couche mince</SelectItem>
                  <SelectItem value="bifacial">Bifacial</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {panelType === "monocrystalline" && "Rendement élevé, meilleur pour espaces limités"}
                {panelType === "polycrystalline" && "Bon rapport qualité/prix"}
                {panelType === "thin_film" && "Léger et flexible, moins efficace"}
                {panelType === "bifacial" && "Capture la lumière des deux côtés"}
              </p>
            </div>

            {/* Sélecteur de type d'onduleur */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Type d'onduleur/inverseur</label>
              <Select value={inverterType} onValueChange={(value) => setInverterType(value as InverterType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="central_inverter">Onduleur central</SelectItem>
                  <SelectItem value="string_inverter">Onduleur string</SelectItem>
                  <SelectItem value="micro_inverter">Micro-onduleur</SelectItem>
                  <SelectItem value="power_optimizer">Optimiseur de puissance</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {inverterType === "central_inverter" && "Pour grandes installations, coût réduit"}
                {inverterType === "string_inverter" && "Équilibre entre coût et performance"}
                {inverterType === "micro_inverter" && "Optimisation par panneau, meilleur rendement"}
                {inverterType === "power_optimizer" && "Optimisation avec onduleur central"}
              </p>
            </div>

            {/* Puissance du panneau (optionnel) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Puissance d'un panneau (W)</label>
              <Input
                type="number"
                value={panelPowerW}
                onChange={(e) => setPanelPowerW(e.target.value)}
                placeholder="400"
                min="100"
                max="1000"
                step="50"
              />
              <p className="text-xs text-muted-foreground">
                Puissance nominale d'un panneau en watts (ex: 400W)
              </p>
            </div>

            {/* Rendement du panneau (optionnel) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Rendement du panneau (%)</label>
              <Input
                type="number"
                value={panelEfficiency}
                onChange={(e) => setPanelEfficiency(e.target.value)}
                placeholder="20"
                min="10"
                max="30"
                step="0.5"
              />
              <p className="text-xs text-muted-foreground">
                Rendement de conversion solaire en électricité (ex: 20%)
              </p>
            </div>

            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground">
                Les paramètres sont sauvegardés automatiquement et utilisés pour les calculs de potentiel solaire.
              </p>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
