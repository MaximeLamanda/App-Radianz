"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import Image from "next/image";
import { Search, Plus, Loader2, MapPin, Table, Settings, X, Trash2, Zap, FileCheck, MoreVertical, Pencil, ImagePlus } from "lucide-react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
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
import type { AddressCoordinates, PlaceSearchResult, PlaceSearchType, Prospect, SolarPanelType, InverterType, SolarEquipmentSettings, PanelReference } from "@/types";
import { getPanelReferences, savePanelReferences, PANEL_TYPE_CHARACTERISTICS, getCountryFlagUrl } from "@/lib/solar-settings";
import {
  getPanelReferencesFromFirebase,
  savePanelReferenceToFirebase,
  deletePanelReferenceFromFirebase,
  initializePanelReferencesInFirebase,
} from "@/lib/firestore-panel-references";

function PanelReferenceForm({
  initialRef,
  onSave,
  onCancel,
}: {
  initialRef?: PanelReference | null;
  onSave: (ref: PanelReference) => void;
  onCancel: () => void;
}) {
  const isEdit = Boolean(initialRef);
  const [name, setName] = useState(initialRef?.name ?? "");
  const [panelType, setPanelType] = useState<SolarPanelType>(initialRef?.panelType ?? "monocrystalline");
  const [powerW, setPowerW] = useState(initialRef?.powerW != null ? String(initialRef.powerW) : "");
  const [efficiencyPercent, setEfficiencyPercent] = useState(initialRef?.efficiencyPercent != null ? String(initialRef.efficiencyPercent) : "");
  const [countryOfOrigin, setCountryOfOrigin] = useState(initialRef?.countryOfOrigin ?? "");
  const [countryCode, setCountryCode] = useState(initialRef?.countryCode ?? "");
  const [costEur, setCostEur] = useState(initialRef?.costEur != null ? String(initialRef.costEur) : "");
  const [warrantyYears, setWarrantyYears] = useState(initialRef?.warrantyYears != null ? String(initialRef.warrantyYears) : "");
  const [imageUrl, setImageUrl] = useState(initialRef?.imageUrl ?? "");
  const [recommended, setRecommended] = useState(initialRef?.recommended ?? false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus sur le premier champ quand le formulaire s'ouvre
  useEffect(() => {
    if (nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, []);

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setUploadError("Veuillez sélectionner une image (JPEG, PNG, etc.).");
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    try {
      const path = `panel_references/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setImageUrl(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Erreur lors de l’upload.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadImage(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) uploadImage(file);
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const power = parseInt(powerW, 10);
    const eff = parseFloat(efficiencyPercent);
    const cost = parseFloat(costEur);
    const warranty = warrantyYears ? parseInt(warrantyYears, 10) : undefined;
    if (!name.trim() || Number.isNaN(power) || power <= 0 || Number.isNaN(eff) || eff <= 0 || Number.isNaN(cost) || cost < 0) return;
    onSave({
      id: initialRef?.id ?? `ref-${Date.now()}`,
      name: name.trim(),
      panelType,
      powerW: power,
      efficiencyPercent: eff,
      countryOfOrigin: countryOfOrigin.trim() || "—",
      countryCode: countryCode.trim() || undefined,
      costEur: cost,
      warrantyYears: warranty && warranty > 0 ? warranty : undefined,
      imageUrl: imageUrl.trim() || undefined,
      recommended: recommended || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Photo */}
      <div className="space-y-2">
        <Label>Photo</Label>
        <div className="flex items-start gap-3">
          <div
            role="button"
            tabIndex={0}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); fileInputRef.current?.click(); }}
            className="relative flex-shrink-0 w-24 h-24 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors overflow-hidden"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
              disabled={isUploading}
            />
            {isUploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : imageUrl ? (
              <div className="absolute inset-0">
                <Image src={imageUrl} alt="Photo du panneau" fill className="object-cover" unoptimized />
              </div>
            ) : (
              <ImagePlus className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            {imageUrl && !isUploading && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setImageUrl(""); }}
              >
                Supprimer
              </Button>
            )}
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            <Input
              placeholder="Ou coller une URL"
              value={imageUrl}
              onChange={(e) => { setImageUrl(e.target.value); setUploadError(null); }}
            />
          </div>
        </div>
      </div>

      {/* Nom */}
      <div className="space-y-2">
        <Label htmlFor="name">Nom / modèle</Label>
        <Input
          ref={nameInputRef}
          id="name"
          placeholder="Ex. DM450M10RT-B54HBB"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* Type de panneau */}
      <div className="space-y-2">
        <Label>Type de panneau</Label>
        <Select value={panelType} onValueChange={(v) => setPanelType(v as SolarPanelType)}>
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
      </div>

      {/* Puissance et Rendement */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="power">Puissance (W)</Label>
          <Input
            id="power"
            type="number"
            placeholder="400"
            value={powerW}
            onChange={(e) => setPowerW(e.target.value)}
            min={100}
            max={1000}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="efficiency">Rendement (%)</Label>
          <Input
            id="efficiency"
            type="number"
            placeholder="20"
            value={efficiencyPercent}
            onChange={(e) => setEfficiencyPercent(e.target.value)}
            min={10}
            max={30}
            step={0.5}
          />
        </div>
      </div>

      {/* Pays */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="country">Pays d'origine</Label>
          <Input
            id="country"
            placeholder="Ex. Chine"
            value={countryOfOrigin}
            onChange={(e) => setCountryOfOrigin(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="countryCode">Code pays</Label>
          <Input
            id="countryCode"
            placeholder="Ex. cn"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            maxLength={2}
          />
        </div>
      </div>

      {/* Coût et Garantie */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="cost">Coût (€)</Label>
          <Input
            id="cost"
            type="number"
            placeholder="150"
            value={costEur}
            onChange={(e) => setCostEur(e.target.value)}
            min={0}
            step={1}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="warranty">Garantie (ans)</Label>
          <Input
            id="warranty"
            type="number"
            placeholder="25"
            value={warrantyYears}
            onChange={(e) => setWarrantyYears(e.target.value)}
            min={0}
            max={40}
          />
        </div>
      </div>

      {/* Recommandé */}
      <div className="flex items-center space-x-2">
        <Checkbox
          id="recommended"
          checked={recommended}
          onCheckedChange={(checked) => setRecommended(checked === true)}
        />
        <Label htmlFor="recommended" className="cursor-pointer">Recommandé</Label>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4">
        <Button type="submit" className="flex-1">{isEdit ? "Enregistrer" : "Ajouter"}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Annuler</Button>
      </div>
    </form>
  );
}

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
  const [selectedDistance, setSelectedDistance] = useState<number[]>([1000]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // États pour les paramètres d'équipement solaire
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [panelType, setPanelType] = useState<SolarPanelType>("monocrystalline");
  const [inverterType, setInverterType] = useState<InverterType>("string_inverter");
  const [panelPowerW, setPanelPowerW] = useState<string>("400");
  const [panelEfficiency, setPanelEfficiency] = useState<string>("20");
  const [panelReferences, setPanelReferences] = useState<PanelReference[]>([]);
  const [showAddPanelRef, setShowAddPanelRef] = useState(false);
  const [openPanelMenuId, setOpenPanelMenuId] = useState<string | null>(null);
  const [editingRef, setEditingRef] = useState<PanelReference | null>(null);

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

  // Charger les références de panneau (Firebase en priorité, fallback localStorage)
  useEffect(() => {
    if (!isSettingsOpen) return;
    let cancelled = false;
    getPanelReferencesFromFirebase()
      .then(async (fromFirebase) => {
        if (cancelled) return;
        if (fromFirebase.length > 0) {
          setPanelReferences(fromFirebase);
          savePanelReferences(fromFirebase);
        } else {
          await initializePanelReferencesInFirebase().catch(() => {});
          if (cancelled) return;
          const afterInit = await getPanelReferencesFromFirebase();
          if (afterInit.length > 0) {
            setPanelReferences(afterInit);
            savePanelReferences(afterInit);
          } else {
            const fromLocal = getPanelReferences();
            setPanelReferences(fromLocal);
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPanelReferences(getPanelReferences());
      });
    return () => { cancelled = true; };
  }, [isSettingsOpen]);

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
      const radius = selectedDistance[0];
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


  return (
    <div className="w-96 flex flex-col gap-4 max-h-[calc(100vh-48px)] overflow-y-auto">
      {/* Partie 1: Recherche avec onglets */}
      <Tabs defaultValue="address" className="w-full">
        <div className="flex items-center justify-between gap-2 mb-4">
          <TabsList className="grid w-full grid-cols-2 max-w-[240px]">
            <TabsTrigger value="address">Par adresse</TabsTrigger>
            <TabsTrigger value="type">Par type</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsSettingsOpen(true)}
              className="h-8 w-8"
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
              className="h-8 w-8"
              title="Voir la liste des leads"
            >
              <Table className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </div>
            
            {/* Onglet Recherche par adresse */}
            <TabsContent value="address" className="mt-0">
              <Card>
                <CardContent className="p-4">
                  <InputGroup>
                    <InputGroupInput
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
                    <InputGroupAddon 
                      align="inline-end"
                      onClick={handleSearch}
                      className="cursor-pointer hover:text-foreground"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSearch();
                        }
                      }}
                    >
                      <Search className="h-4 w-4" />
                    </InputGroupAddon>
                  </InputGroup>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Onglet Recherche par type */}
            <TabsContent value="type" className="mt-0">
              <Card>
                <CardContent className="space-y-4 p-4">
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

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Distance</label>
                      <span className="text-sm text-muted-foreground">
                        {selectedDistance[0] >= 1000 
                          ? `${(selectedDistance[0] / 1000).toFixed(selectedDistance[0] % 1000 === 0 ? 0 : 1)} km`
                          : `${selectedDistance[0]} m`}
                      </span>
                    </div>
                    <Slider
                      value={selectedDistance}
                      onValueChange={setSelectedDistance}
                      min={500}
                      max={10000}
                      step={100}
                      className="w-full"
                    />
                  </div>

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

                  {searchError && (
                    <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2">
                      {searchError}
                    </div>
                  )}

                  {searchResults.length > 0 && (
                    <div className="text-sm font-medium text-muted-foreground bg-muted/50 rounded-md p-2">
                      {searchResults.length} résultat{searchResults.length > 1 ? "s" : ""} trouvé{searchResults.length > 1 ? "s" : ""}
                    </div>
                  )}

                  {searchResults.length > 0 && (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {searchResults.map((result) => (
                        <Card
                          key={result.placeId}
                          className="cursor-pointer overflow-hidden transition-colors hover:bg-accent/50"
                          onClick={() => onSearchResultSelect?.(result)}
                        >
                          <SatelliteImage 
                            coordinates={result.coordinates} 
                            address={result.address}
                            zoom={17}
                            width={400}
                            height={200}
                            className="rounded-t-lg"
                            onClick={() => onSearchResultSelect?.(result)}
                          />
                          <CardContent className="p-3">
                            <div className="text-sm font-medium">{result.name}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <MapPin className="h-3 w-3 shrink-0" />
                              {result.address}
                            </div>
                            {result.rating && (
                              <div className="text-xs text-muted-foreground mt-1">
                                ⭐ {result.rating.toFixed(1)} {result.userRatingsTotal ? `(${result.userRatingsTotal})` : ""}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
        </Tabs>

      {/* Drawer des paramètres */}
      <Drawer
        open={isSettingsOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsSettingsOpen(false);
            setShowAddPanelRef(false);
            setEditingRef(null);
          }
        }}
        direction="right"
        shouldScaleBackground={false}
      >
        <DrawerContent className="h-full w-[400px] right-0 top-0 left-auto p-0 flex flex-col border-l shadow-xl z-20">
          <DrawerHeader className="border-b bg-white">
            <div className="flex items-center justify-between">
              <DrawerTitle>
                {showAddPanelRef || editingRef 
                  ? (editingRef ? "Modifier le panneau" : "Ajouter une référence")
                  : "Paramètres"}
              </DrawerTitle>
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
            {!(showAddPanelRef || editingRef) && (
              <DrawerDescription>
                Configuration des équipements solaires pour les calculs de potentiel
              </DrawerDescription>
            )}
          </DrawerHeader>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Formulaire d'ajout/modification */}
            {(showAddPanelRef || editingRef) ? (
              <PanelReferenceForm
                key={editingRef?.id ?? "add"}
                initialRef={editingRef ?? undefined}
                onSave={(ref) => {
                  if (editingRef) {
                    setPanelReferences((prev) => {
                      const next = prev.map((r) => (r.id === ref.id ? ref : r));
                      savePanelReferences(next);
                      return next;
                    });
                  } else {
                    setPanelReferences((prev) => {
                      const next = [...prev, ref];
                      savePanelReferences(next);
                      return next;
                    });
                  }
                  savePanelReferenceToFirebase(ref).catch((e) =>
                    console.error("Firebase save panel ref:", e)
                  );
                  setShowAddPanelRef(false);
                  setEditingRef(null);
                }}
                onCancel={() => {
                  setShowAddPanelRef(false);
                  setEditingRef(null);
                }}
              />
            ) : (
              <>
                {/* Références de panneau */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Références de panneau</label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAddPanelRef(true)}
                      className="h-8"
                    >
                      <Plus className="h-3.5 w-3 mr-1" />
                      Ajouter
                    </Button>
                  </div>
              <ul className="space-y-3">
                {panelReferences.map((ref) => (
                  <li
                    key={ref.id}
                    className="rounded-xl border border-border bg-white p-3 shadow-sm flex items-center gap-3"
                  >
                    {/* Photo panneau : carré, premier élément, ancré à gauche */}
                    <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-muted">
                      {ref.imageUrl ? (
                        <Image
                          src={ref.imageUrl}
                          alt={ref.name}
                          width={64}
                          height={64}
                          className="w-full h-full object-cover aspect-square"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">—</div>
                      )}
                    </div>
                    {/* Contenu */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <div className="font-semibold text-sm text-foreground truncate">{ref.name}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">€{ref.costEur}</span>
                        <span className="text-muted-foreground/40 text-xs">|</span>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Zap className="h-3.5 w-3.5 text-muted-foreground/80" />
                          {ref.powerW}W
                        </span>
                        {ref.warrantyYears != null && (
                          <>
                            <span className="text-muted-foreground/40 text-xs">|</span>
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <FileCheck className="h-3.5 w-3.5 text-muted-foreground/80" />
                              {ref.warrantyYears}y
                            </span>
                          </>
                        )}
                        {ref.countryCode && (
                          <>
                            <span className="text-muted-foreground/40 text-xs">|</span>
                            <span className="inline-flex items-center shrink-0" title={ref.countryOfOrigin}>
                              <img
                                src={getCountryFlagUrl(ref.countryCode)}
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
                    <div className="relative flex items-start">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                        onClick={() => setOpenPanelMenuId((id) => (id === ref.id ? null : ref.id))}
                        title="Options"
                        aria-expanded={openPanelMenuId === ref.id}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                      {openPanelMenuId === ref.id && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            aria-hidden
                            onClick={() => setOpenPanelMenuId(null)}
                          />
                          <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-md border border-border bg-popover py-1 shadow-md">
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                              onClick={() => {
                                setEditingRef(ref);
                                setOpenPanelMenuId(null);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Modifier
                            </button>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                              onClick={() => {
                                setOpenPanelMenuId(null);
                                const next = panelReferences.filter((r) => r.id !== ref.id);
                                if (next.length === 0) return;
                                setPanelReferences(next);
                                savePanelReferences(next);
                                deletePanelReferenceFromFirebase(ref.id).catch((e) =>
                                  console.error("Firebase delete panel ref:", e)
                                );
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Supprimer
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </li>
                ))}
                </ul>
              </div>

              <div className="pt-4 border-t">
                <p className="text-xs text-muted-foreground">
                  Les paramètres sont sauvegardés automatiquement et utilisés pour les calculs de potentiel solaire.
                </p>
              </div>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
