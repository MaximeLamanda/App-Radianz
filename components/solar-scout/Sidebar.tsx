"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import Image from "next/image";
import { Search, Plus, Loader2, MapPin, X, Trash2, Zap, FileCheck, MoreVertical, Pencil, ImagePlus, ArrowLeft, Building2 } from "lucide-react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { searchPlacesByType } from "@/lib/places-search";
import { SatelliteImage } from "./SatelliteImage";
import type { AddressCoordinates, PlaceSearchResult, PlaceSearchType, Prospect, SolarPanelType, InverterType, SolarEquipmentSettings, PanelReference, InverterReference } from "@/types";
import { getPanelReferences, savePanelReferences, getInverterReferences, saveInverterReferences, PANEL_TYPE_CHARACTERISTICS, getCountryFlagUrl } from "@/lib/solar-settings";
import {
  savePanelReferenceToFirebase,
  deletePanelReferenceFromFirebase,
  initializePanelReferencesInFirebase,
} from "@/lib/firestore-panel-references";
import {
  saveInverterReferenceToFirebase,
  deleteInverterReferenceFromFirebase,
  initializeInverterReferencesInFirebase,
} from "@/lib/firestore-inverter-references";
import { fetchWithAuth } from "@/lib/api-client";

export function PanelReferenceForm({
  initialRef,
  onSave,
  onCancel,
  allReferences = [],
  onDelete,
}: {
  initialRef?: PanelReference | null;
  onSave: (ref: PanelReference) => void;
  onCancel: () => void;
  allReferences?: PanelReference[];
  onDelete?: (id: string) => void;
}) {
  const isEdit = Boolean(initialRef);
  const [name, setName] = useState(initialRef?.name ?? "");
  const [panelType, setPanelType] = useState<SolarPanelType>(initialRef?.panelType ?? "monocrystalline");
  const [powerW, setPowerW] = useState(initialRef?.powerW != null ? String(initialRef.powerW) : "");
  const [efficiencyPercent, setEfficiencyPercent] = useState(initialRef?.efficiencyPercent != null ? String(initialRef.efficiencyPercent) : "");
  const [countryOfOrigin, setCountryOfOrigin] = useState(initialRef?.countryOfOrigin ?? "");
  const [countryCode, setCountryCode] = useState(initialRef?.countryCode ?? "");
  const [costEur, setCostEur] = useState(initialRef?.costEur != null ? String(initialRef.costEur) : "");
  // Dimensions en mm pour l'affichage/saisie, converties en m pour le stockage
  const [widthMm, setWidthMm] = useState(initialRef?.widthM != null ? String(Math.round(initialRef.widthM * 1000)) : "");
  const [lengthMm, setLengthMm] = useState(initialRef?.lengthM != null ? String(Math.round(initialRef.lengthM * 1000)) : "");
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (fileInputRef.current && !isUploading) {
        fileInputRef.current.click();
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const power = parseInt(powerW, 10);
    const eff = parseFloat(efficiencyPercent);
    const cost = parseFloat(costEur);
    const wMm = widthMm.trim() ? parseFloat(widthMm) : undefined;
    const lMm = lengthMm.trim() ? parseFloat(lengthMm) : undefined;
    const warranty = warrantyYears ? parseInt(warrantyYears, 10) : undefined;
    if (!name.trim() || Number.isNaN(power) || power <= 0 || Number.isNaN(eff) || eff <= 0 || Number.isNaN(cost) || cost < 0) return;
    if (wMm != null && (Number.isNaN(wMm) || wMm <= 0 || wMm > 5000)) return;
    if (lMm != null && (Number.isNaN(lMm) || lMm <= 0 || lMm > 5000)) return;
    
    // Conversion mm → m pour le stockage
    const w = wMm != null && wMm > 0 ? wMm / 1000 : undefined;
    const l = lMm != null && lMm > 0 ? lMm / 1000 : undefined;
    
    const updatedRef: PanelReference = {
      id: initialRef?.id ?? `ref-${Date.now()}`,
      name: name.trim(),
      panelType,
      powerW: power,
      efficiencyPercent: eff,
      countryOfOrigin: countryOfOrigin.trim() || "—",
      countryCode: countryCode.trim() || undefined,
      costEur: cost,
      widthM: w,
      lengthM: l,
      warrantyYears: warranty && warranty > 0 ? warranty : undefined,
      imageUrl: imageUrl.trim() || undefined,
      recommended: recommended || undefined,
    };
    
    // Si cette référence devient recommandée, désactiver les autres
    if (recommended) {
      // Cette logique sera gérée par le parent qui mettra à jour toutes les références
    }
    
    onSave(updatedRef);
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
            onKeyDown={handleKeyDown}
            className="group relative shrink-0 w-24 h-24 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors overflow-hidden"
          >
            {/* Input invisible par-dessus : le clic utilisateur ouvre le sélecteur (les clics programmatiques sont bloqués par le navigateur) */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="absolute inset-0 z-10 w-full h-full cursor-pointer opacity-0 text-[0] file:border-0 file:bg-transparent file:text-transparent"
              onChange={handleFileChange}
              disabled={isUploading}
              title="Choisir une photo"
            />
            {isUploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground relative z-0 pointer-events-none" />
            ) : imageUrl ? (
              <>
                <div className="absolute inset-0 pointer-events-none z-0">
                  <Image src={imageUrl} alt="Photo du panneau" fill className="object-cover pointer-events-none" unoptimized />
                </div>
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none z-0 flex items-center justify-center">
                  <ImagePlus className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                </div>
              </>
            ) : (
              <ImagePlus className="h-6 w-6 text-muted-foreground relative z-0 pointer-events-none" />
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

      {/* Dimensions d'un panneau en mm */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="widthMm">Largeur (mm)</Label>
          <Input
            id="widthMm"
            type="number"
            placeholder="1762"
            value={widthMm}
            onChange={(e) => setWidthMm(e.target.value)}
            min={300}
            max={5000}
            step={1}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lengthMm">Longueur (mm)</Label>
          <Input
            id="lengthMm"
            type="number"
            placeholder="1134"
            value={lengthMm}
            onChange={(e) => setLengthMm(e.target.value)}
            min={300}
            max={5000}
            step={1}
          />
        </div>
      </div>

      {/* Pays */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="country">Pays d&apos;origine</Label>
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
        <Switch
          id="recommended"
          checked={recommended}
          onCheckedChange={(checked) => {
            setRecommended(checked);
          }}
        />
        <Label htmlFor="recommended" className="cursor-pointer">Recommandé</Label>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4">
        {isEdit && onDelete && (
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => {
              if (initialRef?.id && onDelete) {
                onDelete(initialRef.id);
              }
            }}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Supprimer
          </Button>
        )}
        <Button type="submit" className="flex-1">{isEdit ? "Enregistrer" : "Ajouter"}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Annuler</Button>
      </div>
    </form>
  );
}

export function InverterReferenceForm({
  initialRef,
  onSave,
  onCancel,
  allReferences = [],
  onDelete,
}: {
  initialRef?: InverterReference | null;
  onSave: (ref: InverterReference) => void;
  onCancel: () => void;
  allReferences?: InverterReference[];
  onDelete?: (id: string) => void;
}) {
  const isEdit = Boolean(initialRef);
  const [name, setName] = useState(initialRef?.name ?? "");
  const [inverterType, setInverterType] = useState<InverterType>(initialRef?.inverterType ?? "string_inverter");
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
      const path = `inverter_references/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setImageUrl(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Erreur lors de l'upload.");
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (fileInputRef.current && !isUploading) {
        fileInputRef.current.click();
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const power = parseInt(powerW, 10);
    const eff = parseFloat(efficiencyPercent);
    const cost = parseFloat(costEur);
    const warranty = warrantyYears ? parseInt(warrantyYears, 10) : undefined;
    if (!name.trim() || Number.isNaN(power) || power <= 0 || Number.isNaN(eff) || eff <= 0 || Number.isNaN(cost) || cost < 0) return;
    
    const updatedRef: InverterReference = {
      id: initialRef?.id ?? `ref-${Date.now()}`,
      name: name.trim(),
      inverterType,
      powerW: power,
      efficiencyPercent: eff,
      countryOfOrigin: countryOfOrigin.trim() || "—",
      countryCode: countryCode.trim() || undefined,
      costEur: cost,
      warrantyYears: warranty && warranty > 0 ? warranty : undefined,
      imageUrl: imageUrl.trim() || undefined,
      recommended: recommended || undefined,
    };
    
    onSave(updatedRef);
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
            onKeyDown={handleKeyDown}
            className="group relative shrink-0 w-24 h-24 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors overflow-hidden"
          >
            {/* Input invisible par-dessus : le clic utilisateur ouvre le sélecteur (les clics programmatiques sont bloqués par le navigateur) */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="absolute inset-0 z-10 w-full h-full cursor-pointer opacity-0 text-[0] file:border-0 file:bg-transparent file:text-transparent"
              onChange={handleFileChange}
              disabled={isUploading}
              title="Choisir une photo"
            />
            {isUploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground relative z-0 pointer-events-none" />
            ) : imageUrl ? (
              <>
                <div className="absolute inset-0 pointer-events-none z-0">
                  <Image src={imageUrl} alt="Photo de l'onduleur" fill className="object-cover pointer-events-none" unoptimized />
                </div>
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none z-0 flex items-center justify-center">
                  <ImagePlus className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                </div>
              </>
            ) : (
              <ImagePlus className="h-6 w-6 text-muted-foreground relative z-0 pointer-events-none" />
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
          placeholder="Ex. SUN2000-10KTL-M1"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* Type d'onduleur */}
      <div className="space-y-2">
        <Label>Type d&apos;onduleur</Label>
        <Select value={inverterType} onValueChange={(v) => setInverterType(v as InverterType)}>
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
      </div>

      {/* Puissance et Rendement */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="power">Puissance (W)</Label>
          <Input
            id="power"
            type="number"
            placeholder="10000"
            value={powerW}
            onChange={(e) => setPowerW(e.target.value)}
            min={100}
            max={100000}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="efficiency">Rendement (%)</Label>
          <Input
            id="efficiency"
            type="number"
            placeholder="97.5"
            value={efficiencyPercent}
            onChange={(e) => setEfficiencyPercent(e.target.value)}
            min={90}
            max={100}
            step={0.1}
          />
        </div>
      </div>

      {/* Pays */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="country">Pays d&apos;origine</Label>
          <Input
            id="country"
            placeholder="Ex. Allemagne"
            value={countryOfOrigin}
            onChange={(e) => setCountryOfOrigin(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="countryCode">Code pays</Label>
          <Input
            id="countryCode"
            placeholder="Ex. de"
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
            placeholder="2000"
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
            placeholder="10"
            value={warrantyYears}
            onChange={(e) => setWarrantyYears(e.target.value)}
            min={0}
            max={30}
          />
        </div>
      </div>

      {/* Recommandé */}
      <div className="flex items-center space-x-2">
        <Switch
          id="recommended"
          checked={recommended}
          onCheckedChange={(checked) => {
            setRecommended(checked);
          }}
        />
        <Label htmlFor="recommended" className="cursor-pointer">Recommandé</Label>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4">
        {isEdit && onDelete && (
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => {
              if (initialRef?.id && onDelete) {
                onDelete(initialRef.id);
              }
            }}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Supprimer
          </Button>
        )}
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
  onSurfaceUpdate?: (surface: { area: number; polygon: Array<{ lat: number; lng: number }>; orientation?: number }) => void;
  onSurfaceDelete?: (surfaceId: string) => void;
  onProspectUpdate?: (prospect: Prospect) => void;
  onValidateDrawing?: () => void;
  searchResults?: PlaceSearchResult[];
  onSearchResults?: (results: PlaceSearchResult[]) => void;
  onSearchResultSelect?: (result: PlaceSearchResult, bdnbData?: { surfaceM2?: number | null; anneeConstruction?: number | null; batiment?: { id: string; polygonSurfaces: Array<{ polygon: Array<{ lat: number; lng: number }>; areaM2: number; orientation: number | null }>; totalAreaM2: number; anneeConstruction: number | null } }) => void;
  getMapCenter?: () => AddressCoordinates | null;
  /** Appelé quand l'utilisateur clique sur "Analyser les bâtiments" */
  onAnalyseBuildings?: () => void;
  /** Chargement en cours de l'analyse OSM des bâtiments */
  isAnalysingBuildings?: boolean;
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
  getMapCenter,
  onAnalyseBuildings,
  isAnalysingBuildings = false,
}: SidebarProps) {
  const [address, setAddress] = useState(initialAddress || ""); // Champ vide par défaut
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  
  // États pour la recherche par type
  const [selectedPlaceType, setSelectedPlaceType] = useState<PlaceSearchType | "">("");
  const DISTANCE_OPTIONS = [1000, 2000, 5000, 10000, 20000] as const;
  const [selectedDistance, setSelectedDistance] = useState<number>(1000);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Données BDNB (surface, année, batiment complet) par placeId pour les résultats de recherche
  const [bdnbByPlaceId, setBdnbByPlaceId] = useState<
    Record<string, {
      surfaceM2?: number | null;
      anneeConstruction?: number | null;
      batiment?: {
        id: string;
        polygonSurfaces: Array<{ polygon: Array<{ lat: number; lng: number }>; areaM2: number; orientation: number | null }>;
        totalAreaM2: number;
        anneeConstruction: number | null;
      };
    }>
  >({});

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
  // Autocomplete (legacy) n'est plus dispo pour les nouveaux clients Google (depuis mars 2025)
  // Si Autocomplete échoue, on utilise le fallback Geocoder via handleSearch
  useEffect(() => {
    if (!inputRef.current) return;
    if (!window.google || !window.google.maps) return;

    const maps = window.google.maps;
    try {
      if (!maps.places?.Autocomplete) return;
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
    } catch {
      // Autocomplete indisponible (nouveau client Google) - fallback via Geocoder dans handleSearch
    }
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

    if (!getMapCenter || typeof getMapCenter !== "function") {
      setSearchError("La fonction de récupération du centre de la carte n'est pas disponible");
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      const coordinates = getMapCenter();
      if (!coordinates) {
        throw new Error("Impossible d'obtenir le centre de la carte");
      }
      if (!coordinates.lat || !coordinates.lng) {
        throw new Error("Coordonnées invalides obtenues du centre de la carte");
      }

      const radius = selectedDistance;
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

  // Enrichir les résultats de recherche avec BDNB (surface, année construction)
  useEffect(() => {
    if (searchResults.length === 0) {
      setBdnbByPlaceId({});
      return;
    }

    const abortController = new AbortController();
    const CONCURRENCY = 5;

    const fetchBdnbForResult = async (
      result: PlaceSearchResult,
      signal: AbortSignal
    ): Promise<{
      placeId: string;
      surfaceM2?: number | null;
      anneeConstruction?: number | null;
      batiment?: { id: string; polygonSurfaces: Array<{ polygon: Array<{ lat: number; lng: number }>; areaM2: number; orientation: number | null }>; totalAreaM2: number; anneeConstruction: number | null };
    } | null> => {
      if (signal.aborted) return null;
      try {
        const res = await fetchWithAuth(
          `/api/bdnb?lat=${result.coordinates.lat}&lng=${result.coordinates.lng}`,
          { signal }
        );
        if (!res.ok || signal.aborted) return null;
        const data = await res.json();
        if (!data.batiment || signal.aborted) {
          return { placeId: result.placeId, surfaceM2: null, anneeConstruction: null };
        }
        const surfaceM2 = data.batiment.totalAreaM2 ?? data.batiment.surfaceM2 ?? null;
        const anneeConstruction = data.batiment.anneeConstruction ?? null;
        const batiment = data.batiment.polygonSurfaces?.length > 0
          ? {
              id: data.batiment.id,
              polygonSurfaces: data.batiment.polygonSurfaces,
              totalAreaM2: data.batiment.totalAreaM2 ?? 0,
              anneeConstruction: data.batiment.anneeConstruction ?? null,
            }
          : undefined;
        return { placeId: result.placeId, surfaceM2, anneeConstruction, batiment };
      } catch {
        if (signal.aborted) return null;
        return { placeId: result.placeId, surfaceM2: null, anneeConstruction: null };
      }
    };

    const runWithConcurrency = async () => {
      const results = [...searchResults];
      setBdnbByPlaceId({});

      for (let i = 0; i < results.length; i += CONCURRENCY) {
        const batch = results.slice(i, i + CONCURRENCY);
        const settled = await Promise.all(
          batch.map((r) => fetchBdnbForResult(r, abortController.signal))
        );
        if (abortController.signal.aborted) return;
        setBdnbByPlaceId((prev) => {
          const out = { ...prev };
          for (const item of settled) {
            if (item) {
              out[item.placeId] = {
                surfaceM2: item.surfaceM2 ?? null,
                anneeConstruction: item.anneeConstruction ?? null,
                batiment: item.batiment,
              };
            }
          }
          return out;
        });
      }
    };

    runWithConcurrency();
    return () => abortController.abort();
  }, [searchResults]);

  // Options de types de lieux avec les types importants en premier
  const placeTypeOptions: { value: PlaceSearchType; label: string }[] = [
    { value: "factory", label: "Usine" },
    { value: "storage", label: "Entrepôt logistique" },
    { value: "industrial", label: "Zone industrielle" },
    { value: "store", label: "Magasin" },
    { value: "supermarket", label: "Supermarché" },
    { value: "office", label: "Bureau" },
    { value: "gym", label: "Salle de sport" },
    { value: "restaurant", label: "Restaurant" },
    { value: "shopping_mall", label: "Centre commercial" },
  ];


  return (
    <div className="w-80 flex flex-col gap-4 max-h-[calc(100vh-48px)] overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
      <Tabs defaultValue={onAnalyseBuildings ? "analyser" : "recherche"} className="w-full">
        <div className="mb-4 flex">
          <TabsList className={`grid gap-1 rounded-xl p-1 h-auto! w-48 ${onAnalyseBuildings ? "grid-cols-2" : "grid-cols-1"}`}>
            {onAnalyseBuildings && (
              <TabsTrigger value="analyser" className="rounded-lg px-3 py-1 text-xs">Analyser</TabsTrigger>
            )}
            <TabsTrigger value="recherche" className="rounded-lg px-3 py-1 text-xs">Recherche</TabsTrigger>
          </TabsList>
        </div>

            {/* Onglet Analyser : même structure que Recherche, zone insights */}
            {onAnalyseBuildings && (
              <TabsContent value="analyser" className="mt-0">
                <Card className="rounded-xl">
                  <CardContent className="space-y-4 p-4">
                    {/* Zone réservée : insights sur les bâtiments analysés */}
                    <div className="rounded-xl border border-dashed border-muted-foreground/25 bg-muted/30 min-h-[140px] flex flex-col items-center justify-center p-4 text-center">
                      <div className="rounded-full bg-muted/60 p-3 mb-3">
                        <Building2 className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium text-foreground mb-1">Insights bâtiments</p>
                      <p className="text-xs text-muted-foreground max-w-[260px]">
                        Statistiques et insights sur les bâtiments sélectionnés — affichés après l&apos;analyse.
                      </p>
                    </div>

                    <Button
                      variant="default"
                      size="sm"
                      onClick={onAnalyseBuildings}
                      disabled={isAnalysingBuildings}
                      className="w-full cursor-pointer relative overflow-hidden disabled:opacity-100 disabled:bg-[#b8d93d] disabled:text-[#0f0f0f] disabled:hover:bg-[#b8d93d]"
                    >
                      {isAnalysingBuildings ? (
                        <>
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                          <span>Analyse en cours…</span>
                          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/30 overflow-hidden rounded-b-xl">
                            <div className="h-full w-1/4 bg-white/90 animate-[progress-slide_1.5s_ease-in-out_infinite]" />
                          </div>
                        </>
                      ) : (
                        "Analyser les bâtiments"
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {/* Onglet Recherche : adresse en premier, par type en dessous (une seule carte) */}
            <TabsContent value="recherche" className="mt-0">
              <Card className="rounded-xl">
                <CardContent className="space-y-4 p-4">
                  {/* Par adresse */}
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

                  {/* Par type */}
                  <div className="space-y-2">
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

                  <div className="flex flex-wrap gap-2">
                    {DISTANCE_OPTIONS.map((d) => {
                      const label = d >= 1000 ? `${d / 1000} km` : `${d} m`;
                      const isSelected = selectedDistance === d;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSelectedDistance(d)}
                          className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                            isSelected
                              ? "border-0 bg-[#E4FE55] text-[#171717]"
                              : "border-0 bg-muted/60 text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  <Button 
                    onClick={handleSearchByType} 
                    className="w-full cursor-pointer"
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
                        <div
                          key={result.placeId}
                          className="rounded-xl px-3 py-2 bg-gray-100 cursor-pointer overflow-hidden transition-colors hover:bg-gray-200/80 flex items-center gap-3 min-h-[80px]"
                          onClick={() => onSearchResultSelect?.(result, bdnbByPlaceId[result.placeId])}
                        >
                          <div className="shrink-0 w-24 h-24 overflow-hidden rounded-xl">
                            <SatelliteImage 
                              coordinates={result.coordinates} 
                              address={result.address}
                              zoom={17}
                              width={96}
                              height={96}
                              showOverlays={false}
                              className="rounded-xl h-full"
                              onClick={() => onSearchResultSelect?.(result, bdnbByPlaceId[result.placeId])}
                            />
                          </div>
                          <div className="flex-1 min-w-0 pl-1 flex flex-col justify-center">
                            <div className="text-sm font-medium truncate">{result.name}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{result.address}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {(() => {
                                const bdnb = bdnbByPlaceId[result.placeId];
                                if (bdnb === undefined) return <span className="italic">…</span>;
                                const surface =
                                  bdnb.surfaceM2 != null ? `${Math.round(bdnb.surfaceM2)} m²` : "—";
                                const annee =
                                  bdnb.anneeConstruction != null
                                    ? String(bdnb.anneeConstruction)
                                    : "—";
                                return (
                                  <span>
                                    Surface: {surface} · Année: {annee}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
      </Tabs>

    </div>
  );
}
