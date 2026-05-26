"use client";

import { useState } from "react";
import { Battery, FileCheck } from "lucide-react";
import { getCountryFlagUrl } from "@/lib/solar-settings";
import type { BatteryReference } from "@/types";
import { EquipmentSelectCard, EquipmentThumbnail } from "./EquipmentSelectCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

export function BatterySelectCard({
  value,
  onChange,
  batteries,
  count = 1,
  onCountChange,
  maxCount = 20,
  isRecommendedForProspect,
  recommendedBatteryIdForProspect,
  recommendedBatteryCountForProspect,
}: {
  value: BatteryReference | null;
  onChange: (b: BatteryReference | null) => void;
  batteries: BatteryReference[];
  count?: number;
  onCountChange?: (n: number) => void;
  maxCount?: number;
  /** Badge « recommandé » (dimensionnement calculé pour ce prospect) — ne pas confondre avec le flag catalogue `value.recommended` */
  isRecommendedForProspect?: boolean;
  /** Modèle dont la ligne affiche « recommandé » dans la liste (= dimensionnement calculé, un seul id) */
  recommendedBatteryIdForProspect?: string | null;
  /** Nombre recommandé pour le modèle dimensionné (popover nombre). */
  recommendedBatteryCountForProspect?: number | null;
}) {
  const showRecommended = isRecommendedForProspect === true;
  const [countPopoverOpen, setCountPopoverOpen] = useState(false);
  const effectiveMax = Math.max(1, maxCount);
  const clampedCount = Math.min(effectiveMax, Math.max(1, count));
  const recommendedCount =
    recommendedBatteryCountForProspect != null && recommendedBatteryCountForProspect >= 1
      ? recommendedBatteryCountForProspect
      : null;
  const recommendedModel =
    recommendedBatteryIdForProspect != null
      ? batteries.find((b) => b.id === recommendedBatteryIdForProspect) ?? null
      : null;
  const recommendedCountForCurrentModel =
    recommendedCount != null &&
    value != null &&
    recommendedBatteryIdForProspect != null &&
    value.id === recommendedBatteryIdForProspect
      ? Math.min(effectiveMax, recommendedCount)
      : null;

  const countBadge = (
    <Popover open={countPopoverOpen} onOpenChange={setCountPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded-md bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 cursor-pointer hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
          title="Paramètres utilisés dans les calculs (injection / tirage batterie). Cliquer pour modifier le nombre."
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {clampedCount}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="end">
        <div className="space-y-2">
          {recommendedCountForCurrentModel != null && (
            <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Nombre recommandé
              </span>
              <span className="text-xs font-semibold tabular-nums">{recommendedCountForCurrentModel}</span>
            </div>
          )}
          {recommendedCount != null &&
            recommendedCountForCurrentModel == null &&
            recommendedModel != null && (
              <div className="rounded-md bg-muted/50 px-2 py-1.5 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    Nombre recommandé
                  </span>
                  <span className="text-xs font-semibold tabular-nums">{recommendedCount}</span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Pour {recommendedModel.name}
                </p>
              </div>
            )}
          <Label htmlFor="battery-count">Nombre de batteries</Label>
          <Input
            id="battery-count"
            type="number"
            min={1}
            max={effectiveMax}
            value={clampedCount}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 1 && v <= effectiveMax) {
                onCountChange?.(v);
              }
            }}
            onBlur={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 1 && v <= effectiveMax) {
                onCountChange?.(v);
              }
            }}
          />
          <p className="text-[10px] text-muted-foreground">1 à {effectiveMax} (max par rack)</p>
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <EquipmentSelectCard<BatteryReference>
      value={value}
      options={batteries}
      onChange={onChange}
      getItemId={(b) => b.id}
      showRecommendedBadge={showRecommended}
      rightBadge={onCountChange ? countBadge : clampedCount}
      rightBadgeTitle="Paramètres utilisés dans les calculs (injection / tirage batterie)"
      placeholder={
        <>
          <Battery className="h-5 w-5" />
          Choisir une batterie
        </>
      }
      renderTriggerContent={(b, { badges }) => (
        <>
          <EquipmentThumbnail imageUrl={b.imageUrl} alt={b.name} fallback={<Battery className="h-6 w-6 text-muted-foreground" />} />
          <div className="flex-1 min-w-0 flex flex-col justify-center text-left">
            <div className="flex w-full items-start justify-between gap-2">
              <div className="flex-1 min-w-0 font-semibold text-xs text-foreground truncate">{b.name}</div>
              <div className="flex items-center gap-1.5 shrink-0">{badges}</div>
            </div>
            <div className="flex items-center gap-1 mt-0 flex-wrap leading-none">
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">€{b.costEur}</span>
              <span className="text-muted-foreground/40 text-[10px]">|</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="Capacité utilisée dans la simulation">
                <Battery className="h-2.5 w-2.5 text-muted-foreground/80" />
                {b.capacityKwh} kWh
              </span>
              {b.warrantyYears != null && (
                <>
                  <span className="text-muted-foreground/40 text-[10px]">|</span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <FileCheck className="h-2.5 w-2.5 text-muted-foreground/80" />
                    {b.warrantyYears}y
                  </span>
                </>
              )}
              {b.countryCode && (
                <>
                  <span className="text-muted-foreground/40 text-[10px]">|</span>
                  <span className="inline-flex shrink-0" title={b.countryOfOrigin}>
                    <img
                      src={getCountryFlagUrl(b.countryCode)}
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
        </>
      )}
      renderOptionContent={(b, selected) => (
        <>
          <EquipmentThumbnail imageUrl={b.imageUrl} alt="" fallback={<Battery className="h-5 w-5 text-muted-foreground" />} size="sm" />
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <div className="font-medium text-xs text-foreground truncate">{b.name}</div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] text-muted-foreground">
              <span>€{b.costEur}</span>
              <span>·</span>
              <span>{b.capacityKwh} kWh</span>
              <span>·</span>
              <span>{b.powerChargeKw} kW</span>
              {b.id === recommendedBatteryIdForProspect && (
                <span className="inline-flex items-center rounded bg-gray-900 px-1 py-0.5 text-[10px] font-medium text-white">
                  recommandé
                </span>
              )}
            </div>
          </div>
        </>
      )}
    />
  );
}
