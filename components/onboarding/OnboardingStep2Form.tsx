"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { REGIONS } from "@/lib/regions-france";
import type { UserProfile } from "@/lib/firestore-user-profile";
import { ImagePlus, Loader2 } from "lucide-react";

const COMPANY_SIZES = [
  { value: "solo", label: "Solo" },
  { value: "2-10", label: "2-10" },
  { value: "11-50", label: "11-50" },
  { value: "50+", label: "50+" },
] as const;

interface OnboardingStep2FormProps {
  formId: string;
  userId: string;
  initialValues?: Partial<UserProfile> | null;
  onSubmit: (data: Partial<UserProfile>) => void;
  isSubmitting?: boolean;
  /** Appelé à chaque changement des zones sélectionnées (pour mise à jour de la carte en temps réel) */
  onGeoZonesChange?: (geoZones: string[]) => void;
}

export function OnboardingStep2Form({
  formId,
  userId,
  initialValues,
  onSubmit,
  isSubmitting = false,
  onGeoZonesChange,
}: OnboardingStep2FormProps) {
  const [companyName, setCompanyName] = useState(initialValues?.companyName ?? "");
  const [companyLogoUrl, setCompanyLogoUrl] = useState(initialValues?.companyLogoUrl ?? "");
  const [logoUploading, setLogoUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [companySize, setCompanySize] = useState(initialValues?.companySize ?? "");
  const [geoZones, setGeoZones] = useState<string[]>(initialValues?.geoZones ?? []);

  const toggleRegion = (region: string) => {
    const next = geoZones.includes(region)
      ? geoZones.filter((r) => r !== region)
      : [...geoZones, region];
    setGeoZones(next);
    onGeoZonesChange?.(next);
  };

  useEffect(() => {
    onGeoZonesChange?.(geoZones);
  }, []);

  const uploadLogo = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setLogoUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `users/${userId}/company-logo.${ext}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setCompanyLogoUrl(url);
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validCompanySize =
      companySize && ["solo", "2-10", "11-50", "50+"].includes(companySize)
        ? (companySize as "solo" | "2-10" | "11-50" | "50+")
        : undefined;
    onSubmit({
      companyName: companyName.trim() || undefined,
      companyLogoUrl: companyLogoUrl || undefined,
      companySize: validCompanySize,
      geoZones: geoZones.length > 0 ? geoZones : undefined,
    });
  };

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-end">
        <div className="space-y-2">
          <Label>Logo entreprise</Label>
          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadLogo(file);
                e.target.value = "";
              }}
            />
            {companyLogoUrl ? (
              <div className="relative">
                <img
                  src={companyLogoUrl}
                  alt="Logo"
                  className="h-16 w-16 rounded-lg border object-cover"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute -right-2 -top-2 h-6 w-6"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={logoUploading}
                  aria-label="Modifier le logo"
                >
                  {logoUploading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <ImagePlus className="size-3" />
                  )}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={logoUploading}
              >
                {logoUploading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <ImagePlus className="mr-2 size-4" />
                )}
                Ajouter un logo
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="companyName">Entreprise</Label>
          <Input
            id="companyName"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Mon entreprise solaire"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Taille de l&apos;entreprise</Label>
        <Select value={companySize} onValueChange={setCompanySize}>
          <SelectTrigger>
            <SelectValue placeholder="Sélectionner" />
          </SelectTrigger>
          <SelectContent>
            {COMPANY_SIZES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Zone(s) géographique(s)</Label>
        <div className="max-h-32 overflow-y-auto rounded-md border p-2">
          <div className="flex flex-wrap gap-2">
            {REGIONS.map((region) => (
              <label
                key={region}
                className="flex cursor-pointer items-center gap-2 rounded border px-2 py-1 text-sm hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={geoZones.includes(region)}
                  onChange={() => toggleRegion(region)}
                  className="rounded"
                />
                {region}
              </label>
            ))}
          </div>
        </div>
      </div>

    </form>
  );
}
