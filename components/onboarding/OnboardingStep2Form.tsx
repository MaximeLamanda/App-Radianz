"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REGIONS } from "@/lib/regions-france";
import type { UserProfile } from "@/lib/firestore-user-profile";

const COMPANY_SIZES = [
  { value: "solo", label: "Solo" },
  { value: "2-10", label: "2-10" },
  { value: "11-50", label: "11-50" },
  { value: "50+", label: "50+" },
] as const;

interface OnboardingStep2FormProps {
  formId: string;
  initialValues?: Partial<UserProfile> | null;
  onSubmit: (data: Partial<UserProfile>) => void;
  isSubmitting?: boolean;
  /** Appelé à chaque changement des zones sélectionnées (pour mise à jour de la carte en temps réel) */
  onGeoZonesChange?: (geoZones: string[]) => void;
}

export function OnboardingStep2Form({
  formId,
  initialValues,
  onSubmit,
  isSubmitting = false,
  onGeoZonesChange,
}: OnboardingStep2FormProps) {
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
  }, []); // au montage, synchroniser l'illustration avec les valeurs initiales

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validCompanySize =
      companySize && ["solo", "2-10", "11-50", "50+"].includes(companySize)
        ? (companySize as "solo" | "2-10" | "11-50" | "50+")
        : undefined;
    onSubmit({
      companySize: validCompanySize,
      geoZones: geoZones.length > 0 ? geoZones : undefined,
    });
  };

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
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
