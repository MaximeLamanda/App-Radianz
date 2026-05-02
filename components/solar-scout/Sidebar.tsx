"use client";

import { useState, useEffect, useRef, useMemo, type RefObject } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Image from "next/image";
import {
  Plus,
  Loader2,
  Trash2,
  Zap,
  FileCheck,
  Pencil,
  ImagePlus,
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import {
  collectSirensFromMatchingV5Row,
  parsePasserelleAddressesJson,
  parseSiretsMatchJson,
  type ScoutMatchingV5Row,
} from "@/lib/scout-matching-v5-map";
import { labelTrancheEffectifs } from "@/lib/sirene-tranche-effectifs";
import type {
  AddressCoordinates,
  Prospect,
  SolarPanelType,
  InverterType,
  SolarEquipmentSettings,
  PanelReference,
  InverterReference,
  BatteryReference,
} from "@/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPanelReferences, savePanelReferences, getInverterReferences, saveInverterReferences, PANEL_TYPE_CHARACTERISTICS, getCountryFlagUrl } from "@/lib/solar-settings";
import {
  savePanelReferenceToFirebase,
  deletePanelReferenceFromFirebase,
} from "@/lib/firestore-panel-references";
import {
  saveInverterReferenceToFirebase,
  deleteInverterReferenceFromFirebase,
} from "@/lib/firestore-inverter-references";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { fetchWithAuth } from "@/lib/api-client";
import { centroidFromGeoJsonPolygonLike } from "@/lib/matching-v5-google-poi-fallback";

type MatchingV5ApiNomEntry = { status: "loading" | "ok" | "err"; name?: string };

function MatchingV5ScrollArrows({
  targetRef,
  step = 110,
  className,
}: {
  targetRef: RefObject<HTMLDivElement | null>;
  step?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1 justify-center shrink-0 py-0.5", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        aria-label="Défiler la liste vers le haut"
        onClick={() => targetRef.current?.scrollBy({ top: -step, behavior: "smooth" })}
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        aria-label="Défiler la liste vers le bas"
        onClick={() => targetRef.current?.scrollBy({ top: step, behavior: "smooth" })}
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function PanelReferenceForm({
  initialRef,
  onSave,
  onCancel,
  allReferences = [],
  onDelete,
  userId,
}: {
  initialRef?: PanelReference | null;
  onSave: (ref: PanelReference) => void;
  onCancel: () => void;
  allReferences?: PanelReference[];
  onDelete?: (id: string) => void;
  /** UID pour le chemin Storage users/{userId}/panel_references/ */
  userId?: string | null;
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
      const path = userId
        ? `users/${userId}/panel_references/${Date.now()}_${file.name.replace(/\s+/g, "_")}`
        : `panel_references/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
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
  userId,
}: {
  initialRef?: InverterReference | null;
  onSave: (ref: InverterReference) => void;
  onCancel: () => void;
  allReferences?: InverterReference[];
  onDelete?: (id: string) => void;
  /** UID pour le chemin Storage users/{userId}/inverter_references/ */
  userId?: string | null;
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
      const path = userId
        ? `users/${userId}/inverter_references/${Date.now()}_${file.name.replace(/\s+/g, "_")}`
        : `inverter_references/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
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

export function BatteryReferenceForm({
  initialRef,
  onSave,
  onCancel,
  allReferences = [],
  onDelete,
  userId,
}: {
  initialRef?: BatteryReference | null;
  onSave: (ref: BatteryReference) => void;
  onCancel: () => void;
  allReferences?: BatteryReference[];
  onDelete?: (id: string) => void;
  userId?: string | null;
}) {
  const isEdit = Boolean(initialRef);
  const [name, setName] = useState(initialRef?.name ?? "");
  const [capacityKwh, setCapacityKwh] = useState(initialRef?.capacityKwh != null ? String(initialRef.capacityKwh) : "");
  const [powerChargeKw, setPowerChargeKw] = useState(initialRef?.powerChargeKw != null ? String(initialRef.powerChargeKw) : "");
  const [powerDischargeKw, setPowerDischargeKw] = useState(initialRef?.powerDischargeKw != null ? String(initialRef.powerDischargeKw) : "");
  const [roundTripEfficiencyPercent, setRoundTripEfficiencyPercent] = useState(initialRef?.roundTripEfficiencyPercent != null ? String(initialRef.roundTripEfficiencyPercent) : "90");
  const [costEur, setCostEur] = useState(initialRef?.costEur != null ? String(initialRef.costEur) : "");
  const [countryOfOrigin, setCountryOfOrigin] = useState(initialRef?.countryOfOrigin ?? "");
  const [countryCode, setCountryCode] = useState(initialRef?.countryCode ?? "");
  const [imageUrl, setImageUrl] = useState(initialRef?.imageUrl ?? "");
  const [warrantyYears, setWarrantyYears] = useState(initialRef?.warrantyYears != null ? String(initialRef.warrantyYears) : "");
  const [recommended, setRecommended] = useState(initialRef?.recommended ?? false);
  const [maxKwpRecommended, setMaxKwpRecommended] = useState(initialRef?.maxKwpRecommended != null ? String(initialRef.maxKwpRecommended) : "");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (nameInputRef.current) nameInputRef.current.focus();
  }, []);

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setUploadError("Veuillez sélectionner une image (JPEG, PNG, etc.).");
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    try {
      const path = userId
        ? `users/${userId}/battery_references/${Date.now()}_${file.name.replace(/\s+/g, "_")}`
        : `battery_references/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cap = parseFloat(capacityKwh);
    const pCh = parseFloat(powerChargeKw);
    const pDch = parseFloat(powerDischargeKw);
    const eff = parseFloat(roundTripEfficiencyPercent);
    const cost = parseFloat(costEur);
    const warranty = warrantyYears ? parseInt(warrantyYears, 10) : undefined;
    const maxKwp = maxKwpRecommended.trim() ? parseFloat(maxKwpRecommended) : undefined;
    if (!name.trim() || Number.isNaN(cap) || cap <= 0 || Number.isNaN(pCh) || pCh < 0 || Number.isNaN(pDch) || pDch < 0 || Number.isNaN(eff) || eff <= 0 || Number.isNaN(cost) || cost < 0) return;

    const updatedRef: BatteryReference = {
      id: initialRef?.id ?? `battery-ref-${Date.now()}`,
      name: name.trim(),
      capacityKwh: cap,
      powerChargeKw: pCh,
      powerDischargeKw: pDch,
      roundTripEfficiencyPercent: eff,
      costEur: cost,
      countryOfOrigin: countryOfOrigin.trim() || "—",
      countryCode: countryCode.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
      warrantyYears: warranty && warranty > 0 ? warranty : undefined,
      recommended: recommended || undefined,
      maxKwpRecommended: maxKwp != null && !Number.isNaN(maxKwp) && maxKwp > 0 ? maxKwp : undefined,
    };
    onSave(updatedRef);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label>Photo</Label>
        <div className="flex items-start gap-3">
          <div
            role="button"
            tabIndex={0}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) uploadImage(f); }}
            onDragOver={(e) => e.preventDefault()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
            className="group relative shrink-0 w-24 h-24 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 bg-muted/30 hover:bg-muted/50 cursor-pointer overflow-hidden"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="absolute inset-0 z-10 w-full h-full cursor-pointer opacity-0 text-[0]"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }}
              disabled={isUploading}
            />
            {isUploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground relative z-0 pointer-events-none" />
            ) : imageUrl ? (
              <Image src={imageUrl} alt="Batterie" fill className="object-cover pointer-events-none" unoptimized />
            ) : (
              <ImagePlus className="h-6 w-6 text-muted-foreground relative z-0 pointer-events-none" />
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            {imageUrl && !isUploading && (
              <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setImageUrl("")}>Supprimer</Button>
            )}
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            <Input placeholder="Ou coller une URL" value={imageUrl} onChange={(e) => { setImageUrl(e.target.value); setUploadError(null); }} />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="battery-name">Nom / modèle</Label>
        <Input ref={nameInputRef} id="battery-name" placeholder="Ex. LUNA2000-7-S1" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="capacity">Capacité (kWh)</Label>
          <Input id="capacity" type="number" placeholder="7" value={capacityKwh} onChange={(e) => setCapacityKwh(e.target.value)} min={0.1} step={0.1} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cost">Coût (€)</Label>
          <Input id="cost" type="number" placeholder="4500" value={costEur} onChange={(e) => setCostEur(e.target.value)} min={0} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="powerCharge">Puissance charge (kW)</Label>
          <Input id="powerCharge" type="number" placeholder="10.5" value={powerChargeKw} onChange={(e) => setPowerChargeKw(e.target.value)} min={0} step={0.1} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="powerDischarge">Puissance décharge (kW)</Label>
          <Input id="powerDischarge" type="number" placeholder="10.5" value={powerDischargeKw} onChange={(e) => setPowerDischargeKw(e.target.value)} min={0} step={0.1} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="efficiency">Rendement aller-retour (%)</Label>
          <Input id="efficiency" type="number" placeholder="90" value={roundTripEfficiencyPercent} onChange={(e) => setRoundTripEfficiencyPercent(e.target.value)} min={50} max={100} step={0.5} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxKwp">kWp max recommandé</Label>
          <Input id="maxKwp" type="number" placeholder="100" value={maxKwpRecommended} onChange={(e) => setMaxKwpRecommended(e.target.value)} min={0} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="country">Pays d&apos;origine</Label>
          <Input id="country" placeholder="Ex. Chine" value={countryOfOrigin} onChange={(e) => setCountryOfOrigin(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="countryCode">Code pays</Label>
          <Input id="countryCode" placeholder="Ex. cn" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} maxLength={2} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="warranty">Garantie (ans)</Label>
        <Input id="warranty" type="number" placeholder="10" value={warrantyYears} onChange={(e) => setWarrantyYears(e.target.value)} min={0} max={30} />
      </div>
      <div className="flex items-center space-x-2">
        <Switch id="battery-recommended" checked={recommended} onCheckedChange={setRecommended} />
        <Label htmlFor="battery-recommended" className="cursor-pointer">Recommandé</Label>
      </div>
      <div className="flex gap-2 pt-4">
        {isEdit && onDelete && (
          <Button type="button" variant="outline" onClick={() => initialRef?.id && onDelete(initialRef.id)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
            <Trash2 className="h-4 w-4 mr-2" /> Supprimer
          </Button>
        )}
        <Button type="submit" className="flex-1">{isEdit ? "Enregistrer" : "Ajouter"}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Annuler</Button>
      </div>
    </form>
  );
}

interface SidebarProps {
  onProspectUpdate?: (patch: Partial<Prospect>) => void;
  onRefreshDiscovery?: () => void;
  /** Couche « Découverte » (export local /geo/matching-v5-33318.geojson) */
  discoveryState?: {
    loading: boolean;
    count: number;
    error?: string | null;
    rows?: ScoutMatchingV5Row[];
    selectedId?: string | null;
    selectedGroupRows?: ScoutMatchingV5Row[];
    onSelectRow?: (id: string) => void;
  };
}

export function Sidebar({
  onProspectUpdate,
  onRefreshDiscovery,
  discoveryState,
}: SidebarProps) {
  const selectedMatchingV5Row = useMemo(
    () => discoveryState?.rows?.find((r) => r.id === discoveryState?.selectedId) ?? null,
    [discoveryState?.rows, discoveryState?.selectedId]
  );

  /** Adresse PPM absente ou aucun établissement issu du matching adresse → proposer le test Google. */
  const matchingV5ShowGooglePoiTest = useMemo(() => {
    if (!selectedMatchingV5Row) return false;
    if (!selectedMatchingV5Row.passerelleAddress?.trim()) return true;
    return parseSiretsMatchJson(selectedMatchingV5Row.siretsJson).length === 0;
  }, [selectedMatchingV5Row]);

  const matchingV5PasserelleSirenSet = useMemo(() => {
    if (!selectedMatchingV5Row) return new Set<string>();
    return new Set(collectSirensFromMatchingV5Row(selectedMatchingV5Row));
  }, [selectedMatchingV5Row]);

  const matchingV5MainListRef = useRef<HTMLDivElement>(null);
  const matchingV5PpmListRef = useRef<HTMLDivElement>(null);
  const matchingV5SiretListRef = useRef<HTMLDivElement>(null);
  const matchingV5ApiNomFetchedRef = useRef<Set<string>>(new Set());
  const [matchingV5ApiNomBySiren, setMatchingV5ApiNomBySiren] = useState<
    Record<string, MatchingV5ApiNomEntry>
  >({});

  const [v5GoogleFbLoading, setV5GoogleFbLoading] = useState(false);
  const [v5GoogleFbErr, setV5GoogleFbErr] = useState<string | null>(null);
  const [v5GoogleFbData, setV5GoogleFbData] = useState<Record<string, unknown> | null>(null);
  const [v5GoogleFbJsonOpen, setV5GoogleFbJsonOpen] = useState(false);

  useEffect(() => {
    setV5GoogleFbErr(null);
    setV5GoogleFbData(null);
    setV5GoogleFbJsonOpen(false);
  }, [selectedMatchingV5Row?.id]);

  useEffect(() => {
    if (!selectedMatchingV5Row) return;
    const sirens = collectSirensFromMatchingV5Row(selectedMatchingV5Row);
    for (const siren of sirens) {
      if (matchingV5ApiNomFetchedRef.current.has(siren)) continue;
      matchingV5ApiNomFetchedRef.current.add(siren);
      setMatchingV5ApiNomBySiren((prev) =>
        prev[siren]?.status === "ok" ? prev : { ...prev, [siren]: { status: "loading" } }
      );
      void (async () => {
        try {
          const res = await fetch(
            `/api/recherche-entreprises?q=${encodeURIComponent(siren)}&per_page=1`
          );
          if (!res.ok) {
            setMatchingV5ApiNomBySiren((prev) => ({ ...prev, [siren]: { status: "err" } }));
            return;
          }
          const data = (await res.json()) as { result?: { companyLegalName?: string | null } };
          const name = data.result?.companyLegalName?.trim() || undefined;
          setMatchingV5ApiNomBySiren((prev) => ({
            ...prev,
            [siren]: { status: "ok", name },
          }));
        } catch {
          setMatchingV5ApiNomBySiren((prev) => ({ ...prev, [siren]: { status: "err" } }));
        }
      })();
    }
  }, [
    selectedMatchingV5Row?.id,
    selectedMatchingV5Row?.siretsJson,
    selectedMatchingV5Row?.passerelleAddressesJson,
  ]);

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

  function matchingV5ApiNomBlock(siren: string | undefined | null) {
    const s = siren?.trim();
    if (!s || !/^\d{9}$/.test(s)) return null;
    const st = matchingV5ApiNomBySiren[s];
    if (st?.status === "loading")
      return (
        <div className="mt-0.5 text-[10px] text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span>Nom officiel (API)…</span>
        </div>
      );
    if (st?.status === "ok" && st.name)
      return (
        <div className="mt-0.5 text-[10px] leading-snug">
          <span className="text-muted-foreground">recherche-entreprises · </span>
          <span className="font-medium text-foreground">{st.name}</span>
        </div>
      );
    if (st?.status === "err")
      return (
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          recherche-entreprises · indisponible
        </div>
      );
    return null;
  }

  return (
    <div className="w-[min(100vw-2rem,36rem)] max-w-[36rem] flex flex-col gap-4 max-h-[calc(100vh-48px)] overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
              <Card className="rounded-xl">
                <CardContent className="space-y-3 p-3 md:p-3 lg:p-4">
                  <div className="text-sm font-semibold text-foreground">Découverte</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    Cadastre, IRIS, BDNB et personnes morales (Pessac). Fichier{" "}
                    <span className="font-mono">/geo/matching-v5-33318.geojson</span> —{" "}
                    <span className="font-mono">npm run pipeline:matching-v5:run</span>.
                  </div>
                  <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
                    {discoveryState?.loading ? (
                      "Chargement…"
                    ) : (
                      <div>{discoveryState?.count ?? 0} entité(s) sur la carte</div>
                    )}
                  </div>
                  {discoveryState?.rows && discoveryState.rows.length > 0 ? (
                    <div className="flex gap-1.5 items-stretch">
                      <div
                        ref={matchingV5MainListRef}
                        className="min-h-0 max-h-52 flex-1 overflow-y-auto rounded-lg border border-border/60 bg-background/80 text-xs"
                      >
                        <ul className="divide-y divide-border/60">
                          {discoveryState.rows.map((row) => {
                            const group = discoveryState?.selectedGroupRows ?? [];
                            const inGroup =
                              group.length > 0 ? group.some((r) => r.id === row.id) : false;
                            const isAnchor = discoveryState?.selectedId === row.id;
                            const listHighlight = inGroup || isAnchor;
                            return (
                              <li key={row.id}>
                                <button
                                  type="button"
                                  onClick={() => discoveryState?.onSelectRow?.(row.id)}
                                  className={`w-full text-left px-3 py-2 space-y-0.5 transition-colors border-l-2 ${
                                    listHighlight
                                      ? isAnchor
                                        ? "bg-emerald-500/15 border-emerald-600 text-emerald-950 dark:text-emerald-100"
                                        : "bg-emerald-500/10 border-emerald-500/70 text-emerald-950/90 dark:text-emerald-100/90"
                                      : "border-transparent hover:bg-muted/50"
                                  }`}
                                >
                                  <div
                                    className={`font-medium truncate ${listHighlight ? "" : "text-foreground"}`}
                                  >
                                    {row.label}
                                    {isAnchor && inGroup && group.length > 1 ? (
                                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                                        (vue principale)
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="font-mono text-[10px] text-muted-foreground truncate">
                                    {row.grain === "building" ? "Bâtiment" : "Parcelle"} ·{" "}
                                    {row.statusMetier || "none"} · {row.siretCount} SIRET · {row.nbBatiments}{" "}
                                    bât. · {Math.round(row.footprintSumM2)} m²
                                  </div>
                                  {row.passerelleAddress ? (
                                    <div className="text-[11px] text-muted-foreground truncate">
                                      {row.passerelleAddress}
                                    </div>
                                  ) : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                      <MatchingV5ScrollArrows targetRef={matchingV5MainListRef} />
                    </div>
                  ) : !discoveryState?.loading ? (
                    <div className="text-xs text-muted-foreground">
                      Aucune donnée ou fichier absent. Générez le GeoJSON puis rechargez (bouton ci-dessous).
                    </div>
                  ) : null}
                  {discoveryState?.selectedId && selectedMatchingV5Row ? (
                    <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/25 p-3 space-y-2 text-xs">
                      {discoveryState.selectedGroupRows &&
                      discoveryState.selectedGroupRows.length > 1 ? (
                        <div className="rounded-md border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/25 p-2.5 space-y-2">
                          <div className="text-[11px] font-semibold text-violet-900 dark:text-violet-100">
                            {discoveryState.selectedGroupRows.length} cadastres liés · même bâtiment
                            (multi-parcelles)
                          </div>
                          <ul className="space-y-2 max-h-40 overflow-y-auto">
                            {discoveryState.selectedGroupRows.map((r) => (
                              <li
                                key={r.id}
                                className={`rounded border border-border/60 bg-background/70 px-2 py-1.5 text-[10px] space-y-0.5 ${
                                  discoveryState?.selectedId === r.id
                                    ? "ring-1 ring-emerald-500/50"
                                    : ""
                                }`}
                              >
                                <div className="font-mono font-medium text-foreground">
                                  {r.section} {r.numeroNorm} · INSEE {r.codeInsee}
                                </div>
                                <div className="text-muted-foreground">
                                  SIREN : {r.sirenStatus || "—"} · {r.siretCount} SIRET ·{" "}
                                  {r.statusTechnique || "—"}
                                </div>
                                {r.passerelleAddress ? (
                                  <div className="text-muted-foreground truncate" title={r.passerelleAddress}>
                                    PPM : {r.passerelleAddress}
                                  </div>
                                ) : (
                                  <div className="text-muted-foreground italic">Pas d’adresse PPM</div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <dl className="space-y-1 text-[11px]">
                        <div className="flex gap-2">
                          <dt className="text-muted-foreground w-28 shrink-0">Grain</dt>
                          <dd className="font-mono">{selectedMatchingV5Row.grain}</dd>
                        </div>
                        {selectedMatchingV5Row.batimentGroupeId ? (
                          <div className="flex gap-2">
                            <dt className="text-muted-foreground w-28 shrink-0">bdnb_id</dt>
                            <dd className="font-mono break-all">{selectedMatchingV5Row.batimentGroupeId}</dd>
                          </div>
                        ) : null}
                        {matchingV5ShowGooglePoiTest ? (
                          <div className="rounded-md border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 p-2 space-y-2">
                            <p className="text-[10px] text-muted-foreground leading-snug">
                              {selectedMatchingV5Row.passerelleAddress?.trim()
                                ? "Aucun établissement SIRENE retenu pour cette adresse. Test optionnel : Nearby + détails Google (coût API), puis api.gouv."
                                : "Aucune adresse passerelle (PPM). Test manuel : Nearby + détails Google (coût API), puis api.gouv."}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs w-full border-amber-300/80 dark:border-amber-800"
                              disabled={v5GoogleFbLoading}
                              onClick={async () => {
                                const row = selectedMatchingV5Row;
                                if (!row || (row.grain !== "parcelle" && row.grain !== "building")) return;
                                const c = centroidFromGeoJsonPolygonLike(row.geometry);
                                if (!c) {
                                  toast.error("Impossible de calculer le centroïde (géométrie).");
                                  return;
                                }
                                setV5GoogleFbLoading(true);
                                setV5GoogleFbErr(null);
                                setV5GoogleFbData(null);
                                try {
                                  const res = await fetchWithAuth(
                                    "/api/matching-v5/google-poi-fallback",
                                    {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        lat: c.lat,
                                        lng: c.lng,
                                        parcelGeometry: row.geometry,
                                      }),
                                    }
                                  );
                                  const data = (await res.json()) as Record<string, unknown>;
                                  if (!res.ok) {
                                    const msg =
                                      typeof data.error === "string"
                                        ? data.error
                                        : `HTTP ${res.status}`;
                                    if (res.status === 429) {
                                      const wait =
                                        typeof data.retryAfterSeconds === "number"
                                          ? data.retryAfterSeconds
                                          : undefined;
                                      toast.error(
                                        wait != null
                                          ? `${msg} Réessayez dans ~${wait}s.`
                                          : msg
                                      );
                                    }
                                    setV5GoogleFbErr(msg);
                                    return;
                                  }
                                  setV5GoogleFbData(data);
                                } catch {
                                  setV5GoogleFbErr("Erreur réseau");
                                } finally {
                                  setV5GoogleFbLoading(false);
                                }
                              }}
                            >
                              {v5GoogleFbLoading ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin shrink-0" />
                                  Appel Google…
                                </>
                              ) : (
                                "Fallback Google (test)"
                              )}
                            </Button>
                            {v5GoogleFbErr ? (
                              <div className="text-[10px] text-destructive">{v5GoogleFbErr}</div>
                            ) : null}
                            {v5GoogleFbData?.google &&
                            typeof v5GoogleFbData.google === "object" &&
                            v5GoogleFbData.google !== null ? (
                              <div className="text-[10px] space-y-1.5">
                                {(() => {
                                  const g = v5GoogleFbData.google as Record<string, unknown>;
                                  const w = g.winner as Record<string, unknown> | null | undefined;
                                  const excludedOutside =
                                    typeof g.excludedOutsideParcel === "number"
                                      ? g.excludedOutsideParcel
                                      : 0;
                                  const ranked = Array.isArray(g.ranked)
                                    ? (g.ranked as Array<{
                                        place_id?: string;
                                        name?: string;
                                        vicinity?: string;
                                        types?: string[];
                                        distanceM?: number;
                                        relevanceScore?: number;
                                        insideParcel?: boolean;
                                      }>)
                                    : [];

                                  if (ranked.length > 0) {
                                    return (
                                      <div className="space-y-2">
                                        <div className="font-semibold text-foreground">
                                          POI proches (Nearby — 1 appel)
                                        </div>
                                        <p className="text-[9px] text-muted-foreground leading-snug">
                                          Seuls les POI dont la position GPS est dans le polygone parcelle (export V5)
                                          sont gardés ; bonus de pertinence +0,2. Adresse formatée : n°1 uniquement
                                          (1× Place Details).
                                        </p>
                                        {excludedOutside > 0 ? (
                                          <p className="text-[9px] text-amber-800 dark:text-amber-200/90">
                                            {excludedOutside} POI Nearby exclus (hors emprise parcelle).
                                          </p>
                                        ) : null}
                                        <ol className="list-decimal pl-4 space-y-2 marker:text-muted-foreground">
                                          {ranked.map((p, i) => {
                                            const typesStr = (p.types ?? [])
                                              .slice(0, 4)
                                              .filter(Boolean)
                                              .join(", ");
                                            const isWinner = i === 0;
                                            return (
                                              <li key={p.place_id ?? i} className="pl-0.5">
                                                <div className="font-medium text-foreground">
                                                  {p.name ?? "—"}
                                                  {p.insideParcel ? (
                                                    <span className="ml-1 font-normal text-xs text-sky-700 dark:text-sky-300">
                                                      (sur parcelle)
                                                    </span>
                                                  ) : null}
                                                  {isWinner ? (
                                                    <span className="ml-1 font-normal text-emerald-700 dark:text-emerald-400">
                                                      (retenu)
                                                    </span>
                                                  ) : null}
                                                </div>
                                                {p.vicinity ? (
                                                  <div className="text-muted-foreground mt-0.5">
                                                    {p.vicinity}
                                                  </div>
                                                ) : null}
                                                <div className="text-muted-foreground mt-0.5">
                                                  {typeof p.distanceM === "number"
                                                    ? `~${p.distanceM} m`
                                                    : null}
                                                  {typeof p.relevanceScore === "number"
                                                    ? ` · pertinence ${p.relevanceScore}`
                                                    : null}
                                                  {typesStr ? ` · ${typesStr}` : null}
                                                </div>
                                                {isWinner &&
                                                w &&
                                                typeof w.formatted_address === "string" ? (
                                                  <div className="mt-1.5 rounded border border-emerald-200/70 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/30 px-2 py-1">
                                                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                                                      Place Details (facturé)
                                                    </div>
                                                    <div className="text-foreground mt-0.5">
                                                      {w.formatted_address}
                                                    </div>
                                                  </div>
                                                ) : null}
                                              </li>
                                            );
                                          })}
                                        </ol>
                                      </div>
                                    );
                                  }

                                  if (g.rawNearbyCount === 0) {
                                    return (
                                      <div className="text-muted-foreground">
                                        Aucun résultat Nearby dans le rayon.
                                      </div>
                                    );
                                  }
                                  return (
                                    <div className="text-muted-foreground">
                                      {excludedOutside > 0
                                        ? `Aucun POI dans l’emprise parcelle (${excludedOutside} exclus hors polygone).`
                                        : "Aucun POI après classement (distance / types)."}
                                    </div>
                                  );
                                })()}
                                {(() => {
                                  const ea = v5GoogleFbData.etablissementsAtAddress;
                                  if (!ea || typeof ea !== "object") return null;
                                  const o = ea as Record<string, unknown>;
                                  const anchor =
                                    typeof o.anchorAddress === "string" ? o.anchorAddress : "";
                                  const cp =
                                    typeof o.codePostal === "string" ? o.codePostal : "";
                                  const query = typeof o.query === "string" ? o.query : "";
                                  const total =
                                    typeof o.totalApiResults === "number"
                                      ? o.totalApiResults
                                      : null;
                                  const skipped = o.skipped === true;
                                  const reason = typeof o.reason === "string" ? o.reason : "";
                                  const etabs = Array.isArray(o.etablissements)
                                    ? o.etablissements
                                    : [];
                                  return (
                                    <div className="border-t border-border/60 pt-1.5 mt-1 space-y-2">
                                      <div className="font-semibold text-foreground text-[11px]">
                                        api.gouv — Établissements à l’adresse
                                      </div>
                                      {anchor ? (
                                        <p className="text-[9px] text-muted-foreground leading-snug break-words">
                                          Adresse d’ancrage (Place Details POI #1) :{" "}
                                          <span className="text-foreground/90">{anchor}</span>
                                          {cp ? <> · CP filtre <span className="font-mono">{cp}</span></> : null}
                                        </p>
                                      ) : null}
                                      {query ? (
                                        <p className="text-[9px] text-muted-foreground break-words">
                                          Requête : {query}
                                          {total != null ? ` · total api.gouv : ${total}` : null}
                                          {!skipped && cp
                                            ? ` · gardés au CP ${cp} : ${etabs.length}`
                                            : null}
                                        </p>
                                      ) : null}
                                      {skipped ? (
                                        <div className="text-[10px] text-muted-foreground">
                                          api.gouv : {reason || "Étape ignorée."}
                                        </div>
                                      ) : etabs.length === 0 ? (
                                        <div className="text-[10px] text-muted-foreground">
                                          Aucun établissement actif au CP {cp || "—"}.
                                        </div>
                                      ) : (
                                        <ol className="list-decimal pl-4 space-y-1.5 marker:text-muted-foreground text-[10px]">
                                          {etabs.map((item, i) => {
                                            const e = item as Record<string, unknown>;
                                            const siren = String(e.siren ?? "");
                                            const siret = String(e.siret ?? "");
                                            const nom = String(e.nom_complet ?? "—");
                                            const adr = String(e.adresse ?? "");
                                            const ecp = String(e.code_postal ?? "");
                                            const naf =
                                              typeof e.activite_principale === "string"
                                                ? e.activite_principale
                                                : "";
                                            const eff =
                                              typeof e.tranche_effectif_salarie === "string"
                                                ? e.tranche_effectif_salarie
                                                : "";
                                            const dirig =
                                              typeof e.company_manager_name === "string"
                                                ? e.company_manager_name
                                                : "";
                                            const onPasserelle =
                                              siren.length === 9 &&
                                              matchingV5PasserelleSirenSet.has(siren);
                                            return (
                                              <li key={`${siret || siren}-${i}`} className="pl-0.5">
                                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                                  <span className="font-mono">{siret || "—"}</span>
                                                  <span className="font-mono text-muted-foreground">
                                                    SIREN {siren || "—"}
                                                  </span>
                                                  {onPasserelle ? (
                                                    <span className="text-[9px] rounded bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 px-1 py-0">
                                                      sur passerelle
                                                    </span>
                                                  ) : null}
                                                </div>
                                                <div className="text-foreground mt-0.5">{nom}</div>
                                                {adr || ecp ? (
                                                  <div className="text-muted-foreground mt-0.5">
                                                    {[adr, ecp].filter(Boolean).join(" · ")}
                                                  </div>
                                                ) : null}
                                                {naf || eff || dirig ? (
                                                  <div className="text-muted-foreground mt-0.5 break-words">
                                                    {naf ? <>NAF <span className="font-mono">{naf}</span></> : null}
                                                    {naf && (eff || dirig) ? " · " : null}
                                                    {eff ? <>effectif <span className="font-mono">{eff}</span></> : null}
                                                    {eff && dirig ? " · " : null}
                                                    {dirig ? <>{dirig}</> : null}
                                                  </div>
                                                ) : null}
                                              </li>
                                            );
                                          })}
                                        </ol>
                                      )}
                                    </div>
                                  );
                                })()}
                                <button
                                  type="button"
                                  className="text-[10px] text-primary underline-offset-2 hover:underline"
                                  onClick={() => setV5GoogleFbJsonOpen((o) => !o)}
                                >
                                  {v5GoogleFbJsonOpen ? "Masquer" : "Voir"} la réponse JSON
                                </button>
                                {v5GoogleFbJsonOpen ? (
                                  <pre className="max-h-40 overflow-auto rounded bg-muted/50 p-2 text-[9px] leading-tight whitespace-pre-wrap break-all">
                                    {JSON.stringify(v5GoogleFbData, null, 2)}
                                  </pre>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {selectedMatchingV5Row.grain === "parcelle" ? (
                          <>
                            <div className="flex gap-2">
                              <dt className="text-muted-foreground w-28 shrink-0">Parcelle</dt>
                              <dd className="font-mono">
                                {selectedMatchingV5Row.section} {selectedMatchingV5Row.numeroNorm}
                              </dd>
                            </div>
                            <div className="flex gap-2">
                              <dt className="text-muted-foreground w-28 shrink-0">Etat métier</dt>
                              <dd className="font-mono">{selectedMatchingV5Row.statusMetier || "none"}</dd>
                            </div>
                            <div className="flex gap-2">
                              <dt className="text-muted-foreground w-28 shrink-0">Etat technique</dt>
                              <dd className="font-mono">{selectedMatchingV5Row.statusTechnique || "—"}</dd>
                            </div>
                            <div className="flex gap-2">
                              <dt className="text-muted-foreground w-28 shrink-0">SIRET détectés</dt>
                              <dd className="font-mono">{selectedMatchingV5Row.siretCount}</dd>
                            </div>
                            <div className="flex gap-2">
                              <dt className="text-muted-foreground w-28 shrink-0">Σ footprints</dt>
                              <dd className="font-mono">{Math.round(selectedMatchingV5Row.footprintSumM2)} m²</dd>
                            </div>
                        <div className="flex gap-2">
                          <dt className="text-muted-foreground w-28 shrink-0">Adresse</dt>
                          <dd className="break-words">{selectedMatchingV5Row.passerelleAddress || "—"}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-muted-foreground w-28 shrink-0">IRIS</dt>
                              <dd>
                                {selectedMatchingV5Row.codeIris || "—"}{" "}
                                {selectedMatchingV5Row.nomIris ? `· ${selectedMatchingV5Row.nomIris}` : ""}
                              </dd>
                            </div>
                            <div className="mt-3 space-y-3 border-t border-emerald-200/50 dark:border-emerald-800/50 pt-3">
                              <div>
                                <div className="text-[11px] font-semibold text-foreground">
                                  Passerelle — SIREN (PPM)
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  {(() => {
                                    const ppm = parsePasserelleAddressesJson(
                                      selectedMatchingV5Row.passerelleAddressesJson
                                    );
                                    return `${ppm.length} SIREN déclaré(s) · statut parcelle ${selectedMatchingV5Row.sirenStatus || "—"}`;
                                  })()}
                                </p>
                                <div className="mt-1.5 flex gap-1.5 items-stretch">
                                  <div
                                    ref={matchingV5PpmListRef}
                                    className="min-h-0 max-h-36 flex-1 space-y-1.5 overflow-y-auto"
                                  >
                                    {parsePasserelleAddressesJson(
                                      selectedMatchingV5Row.passerelleAddressesJson
                                    ).map((p, i) => (
                                      <div
                                        key={`${p.siren ?? "x"}-${i}`}
                                        className="rounded-md border border-border/60 bg-background/90 px-2 py-1.5 text-[10px] leading-snug"
                                      >
                                        <div className="font-mono text-[11px] font-medium">
                                          {p.siren || "—"}
                                        </div>
                                        {p.denomination ? (
                                          <div className="text-foreground mt-0.5">{p.denomination}</div>
                                        ) : null}
                                        {matchingV5ApiNomBlock(p.siren)}
                                        {p.address ? (
                                          <div className="text-muted-foreground mt-0.5">{p.address}</div>
                                        ) : null}
                                        {typeof p.rows === "number" ? (
                                          <div className="text-muted-foreground mt-0.5">
                                            {p.rows} ligne(s) PPM
                                          </div>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                  <MatchingV5ScrollArrows
                                    targetRef={matchingV5PpmListRef}
                                    step={90}
                                    className="self-center"
                                  />
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] font-semibold text-foreground">
                                  SIRENE — établissements (matching adresse)
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  {selectedMatchingV5Row.siretCount} SIRET · confiance{" "}
                                  {Math.round(selectedMatchingV5Row.matchingConfidence)} ·{" "}
                                  {selectedMatchingV5Row.matchingReason || "—"}
                                </p>
                                <div className="mt-1.5 flex gap-1.5 items-stretch">
                                  <div
                                    ref={matchingV5SiretListRef}
                                    className="min-h-0 max-h-64 flex-1 space-y-2 overflow-y-auto"
                                  >
                                    {parseSiretsMatchJson(selectedMatchingV5Row.siretsJson).map((e) => (
                                      <div
                                        key={e.siret}
                                        className="rounded-md border border-border/60 bg-background/90 px-2 py-2 text-[10px] leading-snug"
                                      >
                                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                          <span className="font-mono text-[11px] font-semibold">{e.siret}</span>
                                          {e.siren ? (
                                            <span className="font-mono text-[10px] text-muted-foreground">
                                              SIREN {e.siren}
                                            </span>
                                          ) : null}
                                          {e.score != null ? (
                                            <span className="text-[10px] text-muted-foreground">
                                              score {Math.round(e.score)}
                                            </span>
                                          ) : null}
                                        </div>
                                        {e.denomination ? (
                                          <div className="text-foreground mt-1 font-medium">{e.denomination}</div>
                                        ) : null}
                                        {matchingV5ApiNomBlock(e.siren)}
                                        {e.adresse_etablissement ? (
                                          <div className="text-muted-foreground mt-1">{e.adresse_etablissement}</div>
                                        ) : null}
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                                          {e.tranche_effectifs ? (
                                            <span>
                                              Effectifs : {labelTrancheEffectifs(e.tranche_effectifs)} (
                                              {e.tranche_effectifs})
                                              {e.annee_effectifs
                                                ? ` · millésime ${e.annee_effectifs}`
                                                : ""}
                                            </span>
                                          ) : e.annee_effectifs ? (
                                            <span>Effectifs : — · millésime {e.annee_effectifs}</span>
                                          ) : (
                                            <span>Effectifs : —</span>
                                          )}
                                        </div>
                                        {e.activite_principale ? (
                                          <div className="mt-0.5 font-mono text-[10px]">
                                            APE {e.activite_principale}
                                          </div>
                                        ) : null}
                                        {e.reason ? (
                                          <div className="mt-1 text-[10px] text-muted-foreground">
                                            Règle : {e.reason}
                                          </div>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                  <MatchingV5ScrollArrows
                                    targetRef={matchingV5SiretListRef}
                                    step={100}
                                    className="self-center"
                                  />
                                </div>
                                {parseSiretsMatchJson(selectedMatchingV5Row.siretsJson).length === 0 &&
                                selectedMatchingV5Row.statusMetier === "none" ? (
                                  <p className="text-[10px] text-muted-foreground mt-1">
                                    Aucun établissement retenu. Vérifiez l’adresse passerelle et le référentiel{" "}
                                    <span className="font-mono">scout_etablissements</span>.
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </>
                        ) : null}
                      </dl>
                      {selectedMatchingV5Row.passerelleAddressesJson &&
                      parsePasserelleAddressesJson(selectedMatchingV5Row.passerelleAddressesJson).length === 0 ? (
                        <pre className="mt-2 max-h-24 overflow-auto rounded bg-muted/50 p-2 text-[10px] leading-snug">
                          {selectedMatchingV5Row.passerelleAddressesJson}
                        </pre>
                      ) : null}
                      {selectedMatchingV5Row.parcellesJson ? (
                        <pre className="mt-2 max-h-36 overflow-auto rounded bg-muted/50 p-2 text-[10px] leading-snug">
                          {(() => {
                            try {
                              return JSON.stringify(
                                JSON.parse(selectedMatchingV5Row.parcellesJson),
                                null,
                                2
                              );
                            } catch {
                              return selectedMatchingV5Row.parcellesJson;
                            }
                          })()}
                        </pre>
                      ) : null}
                      {selectedMatchingV5Row.buildingsJson ? (
                        <pre className="mt-2 max-h-36 overflow-auto rounded bg-muted/50 p-2 text-[10px] leading-snug">
                          {(() => {
                            try {
                              return JSON.stringify(
                                JSON.parse(selectedMatchingV5Row.buildingsJson),
                                null,
                                2
                              );
                            } catch {
                              return selectedMatchingV5Row.buildingsJson;
                            }
                          })()}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                  {discoveryState?.error ? (
                    <div className="text-xs text-destructive bg-destructive/10 rounded-md p-2">{discoveryState.error}</div>
                  ) : null}
                  <Button
                    type="button"
                    onClick={() => onRefreshDiscovery?.()}
                    className="w-full cursor-pointer"
                    disabled={discoveryState?.loading}
                  >
                    {discoveryState?.loading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Chargement...
                      </>
                    ) : (
                      "Recharger la couche"
                    )}
                  </Button>
                </CardContent>
              </Card>

    </div>
  );
}
