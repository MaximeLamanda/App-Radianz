"use client";

import { useMemo } from "react";
import { Zap, FileCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  radianzCardBorderStyle,
  radianzDefaultCardClass,
  radianzMonoLabelClass,
} from "@/lib/radianz-card-primitives";
import { EquipmentSelectCard, EquipmentThumbnail } from "@/components/solar-scout/EquipmentSelectCard";
import { BatterySelectCard } from "@/components/solar-scout/BatterySelectCard";
import { getCountryFlagUrl } from "@/lib/solar-settings";
import type { PanelReference, InverterReference, BatteryReference } from "@/types";

function formatPower(powerW: number) {
  if (!Number.isFinite(powerW)) return "—";
  if (powerW >= 1000) return `${(powerW / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}kW`;
  return `${Math.round(powerW)}W`;
}

export type DiscoveryDrawerEquipmentComposition = { model: BatteryReference; count: number } | null;

type Props = {
  panelsData: PanelReference[] | undefined;
  invertersData: InverterReference[] | undefined;
  batteriesData: BatteryReference[] | undefined;
  usedPanelRef: PanelReference | null;
  onPanelChange: (p: PanelReference | null) => void;
  usedInverterRef: InverterReference | null;
  onInverterChange: (i: InverterReference | null) => void;
  usedBatteryRef: BatteryReference | null;
  onBatteryChange: (b: BatteryReference | null) => void;
  batteryCount: number;
  onBatteryCountChange: (n: number) => void;
  panelCountBadge: number;
  inverterCountBadge: number;
  inverterCountExceedsLimit: boolean;
  includeBattery: boolean;
  recommendedBatteryComposition: DiscoveryDrawerEquipmentComposition;
};

/**
 * Carte « Équipement » (onglet Solaire · mode Découverte) — même présentation que `ProspectSharePage`.
 */
export function DiscoveryDrawerEquipmentPanel({
  panelsData,
  invertersData,
  batteriesData,
  usedPanelRef,
  onPanelChange,
  usedInverterRef,
  onInverterChange,
  usedBatteryRef,
  onBatteryChange,
  batteryCount,
  onBatteryCountChange,
  panelCountBadge,
  inverterCountBadge,
  inverterCountExceedsLimit,
  includeBattery,
  recommendedBatteryComposition,
}: Props) {
  const visiblePanels = useMemo(() => {
    const withVisible = panelsData?.filter((p) => p.visible === true) ?? [];
    if (withVisible.length > 0) return withVisible;
    if (panelsData && panelsData.length > 0) {
      const fallback = panelsData.find((p) => p.recommended === true) ?? panelsData[0];
      return fallback ? [fallback] : [];
    }
    return [];
  }, [panelsData]);

  const visibleInverters = useMemo(
    () => invertersData?.filter((r) => r.visible !== false) ?? [],
    [invertersData]
  );

  const visibleBatteries = useMemo(
    () => batteriesData?.filter((b) => b.visible !== false) ?? [],
    [batteriesData]
  );

  const panelOptions =
    panelsData && panelsData.filter((p) => p.visible === true).length > 0
      ? panelsData.filter((p) => p.visible === true)
      : (panelsData ?? []);

  const showBlock =
    visiblePanels.length > 0 ||
    visibleInverters.length > 0 ||
    (includeBattery && visibleBatteries.length > 0) ||
    panelsData !== undefined ||
    invertersData !== undefined ||
    batteriesData !== undefined;

  if (!showBlock) return null;

  return (
    <div className={cn("min-w-0 py-3 px-4 overflow-auto", radianzDefaultCardClass)} style={radianzCardBorderStyle}>
      <div className={cn(radianzMonoLabelClass, "mb-3")}>Équipement</div>
      <div className="space-y-2">
        {visiblePanels.length > 0 ? (
          <div>
            <EquipmentSelectCard<PanelReference>
              value={usedPanelRef}
              options={panelOptions.length > 0 ? panelOptions : visiblePanels}
              onChange={(p) => onPanelChange(p)}
              getItemId={(p) => p.id}
              showRecommendedBadge={!!usedPanelRef?.recommended}
              rightBadge={usedPanelRef ? String(panelCountBadge) : undefined}
              placeholder={
                <span className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Choisir un panneau
                </span>
              }
              renderTriggerContent={(p, { badges }) => (
                <>
                  <EquipmentThumbnail imageUrl={p.imageUrl} alt={p.name} fallback={<span className="text-muted-foreground text-xs">—</span>} />
                  <div className="flex-1 min-w-0 flex flex-col justify-center text-left">
                    <div className="flex w-full items-start justify-between gap-2">
                      <div className="flex-1 min-w-0 font-semibold text-xs text-foreground truncate">{p.name}</div>
                      <div className="flex items-center gap-1.5 shrink-0">{badges}</div>
                    </div>
                    <div className="flex items-center gap-1 mt-0 flex-wrap leading-none">
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">€{p.costEur}</span>
                      <span className="text-muted-foreground/40 text-[10px]">|</span>
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Zap className="h-2.5 w-2.5 text-muted-foreground/80" />
                        {formatPower(p.powerW)}
                      </span>
                      {p.warrantyYears != null && (
                        <>
                          <span className="text-muted-foreground/40 text-[10px]">|</span>
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <FileCheck className="h-2.5 w-2.5 text-muted-foreground/80" />
                            {p.warrantyYears}y
                          </span>
                        </>
                      )}
                      {p.countryCode && (
                        <>
                          <span className="text-muted-foreground/40 text-xs">|</span>
                          <span className="inline-flex shrink-0" title={p.countryOfOrigin}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getCountryFlagUrl(p.countryCode)}
                              alt=""
                              className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50"
                            />
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
              renderOptionContent={(p) => (
                <>
                  <EquipmentThumbnail imageUrl={p.imageUrl} alt="" fallback={<span className="text-muted-foreground text-xs">—</span>} size="sm" />
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="font-medium text-xs text-foreground truncate">{p.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] text-muted-foreground">
                      <span>€{p.costEur}</span>
                      <span>·</span>
                      <span>{formatPower(p.powerW)}</span>
                      {p.recommended && (
                        <span className="inline-flex items-center rounded bg-gray-900 px-1 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                      )}
                    </div>
                  </div>
                </>
              )}
            />
          </div>
        ) : panelsData !== undefined ? (
          <p className="text-xs text-muted-foreground py-2">Aucun panneau configuré</p>
        ) : null}

        {visibleInverters.length > 0 ? (
          <div>
            <EquipmentSelectCard<InverterReference>
              value={usedInverterRef}
              options={visibleInverters}
              onChange={(i) => onInverterChange(i)}
              getItemId={(i) => i.id}
              showRecommendedBadge={!!usedInverterRef?.recommended && !inverterCountExceedsLimit}
              warningBadge={
                inverterCountExceedsLimit ? (
                  <span
                    className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                    title="Plus de 8 onduleurs : choisir un modèle plus puissant"
                  >
                    Changer de modèle
                  </span>
                ) : undefined
              }
              rightBadge={usedInverterRef ? String(inverterCountBadge) : undefined}
              placeholder={
                <span className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Choisir un onduleur
                </span>
              }
              renderTriggerContent={(i, { badges }) => (
                <>
                  <EquipmentThumbnail imageUrl={i.imageUrl} alt={i.name} fallback={<span className="text-muted-foreground text-xs">—</span>} />
                  <div className="flex-1 min-w-0 flex flex-col justify-center text-left">
                    <div className="flex w-full items-start justify-between gap-2">
                      <div className="flex-1 min-w-0 font-semibold text-xs text-foreground truncate">{i.name}</div>
                      <div className="flex items-center gap-1.5 shrink-0">{badges}</div>
                    </div>
                    <div className="flex items-center gap-1 mt-0 flex-wrap leading-none">
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">€{i.costEur}</span>
                      <span className="text-muted-foreground/40 text-[10px]">|</span>
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Zap className="h-2.5 w-2.5 text-muted-foreground/80" />
                        {formatPower(i.powerW)}
                      </span>
                      {i.warrantyYears != null && (
                        <>
                          <span className="text-muted-foreground/40 text-[10px]">|</span>
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <FileCheck className="h-2.5 w-2.5 text-muted-foreground/80" />
                            {i.warrantyYears}y
                          </span>
                        </>
                      )}
                      {i.countryCode && (
                        <>
                          <span className="text-muted-foreground/40 text-xs">|</span>
                          <span className="inline-flex shrink-0" title={i.countryOfOrigin}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getCountryFlagUrl(i.countryCode)}
                              alt=""
                              className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50"
                            />
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
              renderOptionContent={(i) => (
                <>
                  <EquipmentThumbnail imageUrl={i.imageUrl} alt="" fallback={<span className="text-muted-foreground text-xs">—</span>} size="sm" />
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="font-medium text-xs text-foreground truncate">{i.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] text-muted-foreground">
                      <span>€{i.costEur}</span>
                      <span>·</span>
                      <span>{formatPower(i.powerW)}</span>
                      {i.recommended && (
                        <span className="inline-flex items-center rounded bg-gray-900 px-1 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                      )}
                    </div>
                  </div>
                </>
              )}
            />
          </div>
        ) : invertersData !== undefined ? (
          <p className="text-xs text-muted-foreground py-2">Aucun onduleur configuré</p>
        ) : null}

        {includeBattery ? (
          visibleBatteries.length > 0 ? (
            <div>
              <BatterySelectCard
                value={usedBatteryRef}
                onChange={(b) => onBatteryChange(b)}
                count={batteryCount}
                onCountChange={onBatteryCountChange}
                maxCount={usedBatteryRef?.maxBatteriesPerRack ?? 20}
                batteries={visibleBatteries}
                isRecommendedForProspect={
                  !!recommendedBatteryComposition &&
                  usedBatteryRef?.id === recommendedBatteryComposition.model.id &&
                  batteryCount === recommendedBatteryComposition.count
                }
                recommendedBatteryIdForProspect={recommendedBatteryComposition?.model.id ?? null}
                recommendedBatteryCountForProspect={recommendedBatteryComposition?.count ?? null}
              />
            </div>
          ) : batteriesData !== undefined ? (
            <p className="text-xs text-muted-foreground py-2">Aucune batterie configurée</p>
          ) : null
        ) : (
          <p className="text-xs text-muted-foreground py-2">Batterie non incluse</p>
        )}
      </div>
    </div>
  );
}
