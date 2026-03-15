"use client";

import { Battery, FileCheck } from "lucide-react";
import { getCountryFlagUrl } from "@/lib/solar-settings";
import type { BatteryReference } from "@/types";
import { EquipmentSelectCard, EquipmentThumbnail } from "./EquipmentSelectCard";

export function BatterySelectCard({
  value,
  onChange,
  batteries,
  isRecommendedForProspect,
}: {
  value: BatteryReference | null;
  onChange: (b: BatteryReference | null) => void;
  batteries: BatteryReference[];
  /** Affiche le badge "recommandé" quand la batterie est celle recommandée pour ce prospect (ex. calcul surplus) */
  isRecommendedForProspect?: boolean;
}) {
  const showRecommended = value?.recommended === true || isRecommendedForProspect === true;

  return (
    <EquipmentSelectCard<BatteryReference>
      value={value}
      options={batteries}
      onChange={onChange}
      getItemId={(b) => b.id}
      showRecommendedBadge={showRecommended}
      rightBadge="1"
      rightBadgeTitle="Paramètres utilisés dans les calculs (injection / tirage batterie)"
      placeholder={
        <>
          <Battery className="h-5 w-5" />
          Choisir une batterie
        </>
      }
      renderTriggerContent={(b) => (
        <>
          <EquipmentThumbnail imageUrl={b.imageUrl} alt={b.name} fallback={<Battery className="h-6 w-6 text-muted-foreground" />} />
          <div className="flex-1 min-w-0 flex flex-col justify-center text-left">
            <div className="font-semibold text-xs text-foreground truncate">{b.name}</div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">€{b.costEur}</span>
              <span className="text-muted-foreground/40 text-xs">|</span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Capacité utilisée dans la simulation">
                <Battery className="h-3 w-3 text-muted-foreground/80" />
                {b.capacityKwh} kWh
              </span>
              {b.warrantyYears != null && (
                <>
                  <span className="text-muted-foreground/40 text-xs">|</span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <FileCheck className="h-3 w-3 text-muted-foreground/80" />
                    {b.warrantyYears}y
                  </span>
                </>
              )}
              {b.countryCode && (
                <>
                  <span className="text-muted-foreground/40 text-xs">|</span>
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
              {b.recommended && (
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
