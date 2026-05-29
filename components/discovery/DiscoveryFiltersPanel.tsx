"use client";

import { useMemo, type ComponentType } from "react";
import {
  Building2,
  Factory,
  GraduationCap,
  Home,
  Hospital,
  Store,
  type LucideProps,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CombosOverviewSirenRole } from "@/lib/discovery-combos-overview-http";
import type { DiscoveryNafDivisionOption } from "@/lib/discovery-naf-divisions";
import { DiscoveryNafDivisionPicker } from "@/components/discovery/DiscoveryNafDivisionPicker";
import { DiscoverySirenTagsInput } from "@/components/discovery/DiscoverySirenTagsInput";
import { Spinner } from "@/components/ui/spinner";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { RangeSlider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  DISCOVERY_CONSTRUCTION_YEAR_SLIDER_MIN,
  getDiscoveryConstructionYearSliderMax,
} from "@/lib/discovery-construction-year-filter";
import {
  DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT,
  DISCOVERY_FOOTPRINT_RATIO_SLIDER_MIN_PCT,
  DISCOVERY_FOOTPRINT_RATIO_SLIDER_STEP_PCT,
} from "@/lib/discovery-footprint-ratio-defaults";
import {
  DISCOVERY_PARKING_SLIDER_MAX_M2,
  DISCOVERY_SURFACE_SLIDER_MAX_M2,
} from "@/lib/discovery-surface-defaults";
import {
  DISCOVERY_ENEDIS_MWH_SLIDER_MAX,
  DISCOVERY_ENEDIS_MWH_SLIDER_MIN,
  DISCOVERY_ENEDIS_MWH_SLIDER_STEP,
  DISCOVERY_ENEDIS_YEARS,
  type DiscoveryEnedisYear,
} from "@/lib/discovery-enedis-layer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SURFACE_SLIDER_STEP = 50;

const ZONE_ACTIVITY_ICONS: Record<string, ComponentType<LucideProps>> = {
  industrial: Factory,
  commercial: Building2,
  retail: Store,
  education: GraduationCap,
  hospital: Hospital,
  residential: Home,
};

function zoneActivityIcon(tag: string): ComponentType<LucideProps> {
  return ZONE_ACTIVITY_ICONS[tag] ?? Building2;
}

export type DiscoveryFiltersPanelProps = {
  surfaceMinM2: number;
  surfaceMaxM2: number;
  onSurfaceMinChange: (v: number) => void;
  onSurfaceMaxChange: (v: number) => void;
  parkingFilterEnabled: boolean;
  onParkingFilterEnabledChange: (enabled: boolean) => void;
  parkingMinM2: number;
  parkingMaxM2: number;
  onParkingMinChange: (v: number) => void;
  onParkingMaxChange: (v: number) => void;
  footprintRatioMinPct: number;
  footprintRatioMaxPct: number;
  onFootprintRatioMinChange: (v: number) => void;
  onFootprintRatioMaxChange: (v: number) => void;
  constructionYearMin: number;
  constructionYearMax: number;
  onConstructionYearMinChange: (v: number) => void;
  onConstructionYearMaxChange: (v: number) => void;
  osmActivityOptions: Array<{ tag: string; label: string; count: number }>;
  selectedOsmActivityTag: string | null;
  onSelectedOsmActivityTagChange: (tag: string | null) => void;
  sirenRole: CombosOverviewSirenRole;
  onSirenRoleChange: (role: CombosOverviewSirenRole) => void;
  selectedSirens: readonly string[];
  sirenDraft: string;
  onSelectedSirensChange: (sirens: string[]) => void;
  onSirenDraftChange: (value: string) => void;
  nafDivisionQuery: string;
  onNafDivisionQueryChange: (value: string) => void;
  nafDivisionOptions: readonly DiscoveryNafDivisionOption[];
  rowCount: number;
  loading: boolean;
  error: string | null;
  enedisFilterEnabled: boolean;
  onEnedisFilterEnabledChange: (enabled: boolean) => void;
  enedisMwhMin: number;
  enedisMwhMax: number;
  onEnedisMwhMinChange: (v: number) => void;
  onEnedisMwhMaxChange: (v: number) => void;
  enedisYear: DiscoveryEnedisYear;
  onEnedisYearChange: (year: DiscoveryEnedisYear) => void;
  enedisPointCount: number;
  enedisLoading: boolean;
  enedisError: string | null;
  enedisTruncated: boolean;
  className?: string;
};

export function DiscoveryFiltersPanel({
  surfaceMinM2,
  surfaceMaxM2,
  onSurfaceMinChange,
  onSurfaceMaxChange,
  parkingFilterEnabled,
  onParkingFilterEnabledChange,
  parkingMinM2,
  parkingMaxM2,
  onParkingMinChange,
  onParkingMaxChange,
  footprintRatioMinPct,
  footprintRatioMaxPct,
  onFootprintRatioMinChange,
  onFootprintRatioMaxChange,
  constructionYearMin,
  constructionYearMax,
  onConstructionYearMinChange,
  onConstructionYearMaxChange,
  osmActivityOptions,
  selectedOsmActivityTag,
  onSelectedOsmActivityTagChange,
  sirenRole,
  onSirenRoleChange,
  selectedSirens,
  sirenDraft,
  onSelectedSirensChange,
  onSirenDraftChange,
  nafDivisionQuery,
  onNafDivisionQueryChange,
  nafDivisionOptions,
  rowCount,
  loading,
  error,
  enedisFilterEnabled,
  onEnedisFilterEnabledChange,
  enedisMwhMin,
  enedisMwhMax,
  onEnedisMwhMinChange,
  onEnedisMwhMaxChange,
  enedisYear,
  onEnedisYearChange,
  enedisPointCount,
  enedisLoading,
  enedisError,
  enedisTruncated,
  className,
}: DiscoveryFiltersPanelProps) {
  const lo = Math.min(surfaceMinM2, surfaceMaxM2);
  const hi = Math.max(surfaceMinM2, surfaceMaxM2);
  const rangeValue = useMemo(() => [lo, hi] as [number, number], [lo, hi]);
  const pLo = Math.min(parkingMinM2, parkingMaxM2);
  const pHi = Math.max(parkingMinM2, parkingMaxM2);
  const parkingRangeValue = useMemo(() => [pLo, pHi] as [number, number], [pLo, pHi]);
  const rLo = Math.min(footprintRatioMinPct, footprintRatioMaxPct);
  const rHi = Math.max(footprintRatioMinPct, footprintRatioMaxPct);
  const footprintRatioRangeValue = useMemo(() => [rLo, rHi] as [number, number], [rLo, rHi]);

  const constructionYearSliderMax = getDiscoveryConstructionYearSliderMax();
  const yLo = Math.min(constructionYearMin, constructionYearMax);
  const yHi = Math.max(constructionYearMin, constructionYearMax);
  const constructionYearRangeValue = useMemo(
    () => [yLo, yHi] as [number, number],
    [yLo, yHi]
  );
  const eLo = Math.min(enedisMwhMin, enedisMwhMax);
  const eHi = Math.max(enedisMwhMin, enedisMwhMax);
  const enedisRangeValue = useMemo(() => [eLo, eHi] as [number, number], [eLo, eHi]);

  return (
    <Card
      className={cn(
        "h-fit rounded-xl border-border bg-card/95 text-card-foreground shadow-lg backdrop-blur-sm",
        className
      )}
    >
      <Accordion type="single" collapsible defaultValue="filters">
        <AccordionItem value="filters" className="border-b-0">
          <AccordionTrigger className="px-3 py-3 hover:no-underline [&[data-state=open]]:pb-2">
            <div className="flex flex-1 items-baseline justify-between gap-2 pr-1">
              <span className="text-base font-semibold tracking-tight">Filtres</span>
              <span
                className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground"
                aria-label={
                  loading
                    ? "Chargement du nombre d'entités"
                    : `${rowCount} combo${rowCount > 1 ? "s" : ""} dans la vue après filtres`
                }
              >
                {loading ? <Spinner className="size-3.5" /> : rowCount.toLocaleString("fr-FR")}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3 pt-0">
            {error ? <p className="mb-3 text-xs text-destructive">{error}</p> : null}
            <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm font-medium leading-snug text-foreground">
            Activité de la zone
          </Label>
          <div
            className={cn(
              "flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden",
              "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            )}
          >
            {osmActivityOptions.length === 0 ? (
              <span className="shrink-0 text-xs text-muted-foreground">Aucune activité détectée</span>
            ) : (
              osmActivityOptions.map((opt) => {
                const selected = selectedOsmActivityTag === opt.tag;
                const Icon = zoneActivityIcon(opt.tag);
                return (
                  <button
                    key={opt.tag}
                    type="button"
                    className={cn(
                      "flex size-[4.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border p-3 transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      selected
                        ? "border-border/40 bg-muted-foreground/25 text-foreground hover:bg-muted-foreground/35"
                        : "border-border bg-transparent text-foreground hover:bg-muted/50"
                    )}
                    onClick={() => onSelectedOsmActivityTagChange(selected ? null : opt.tag)}
                    aria-pressed={selected}
                    aria-label={`${opt.label} (${opt.count.toLocaleString("fr-FR")})`}
                    title={`Filtrer sur ${opt.label}`}
                  >
                    <Icon className="size-3.5 shrink-0 stroke-[1.75]" aria-hidden />
                    <span className="w-full min-w-0 truncate text-center text-[9px] font-medium leading-tight">
                      {opt.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium leading-snug text-foreground">Entreprise (SIREN)</Label>
          <div className="flex gap-1.5">
            {(
              [
                { id: "owner" as const, label: "Propriétaire" },
                { id: "domiciliation" as const, label: "Domiciliation" },
              ] as const
            ).map(({ id, label }) => {
              const selected = sirenRole === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    "flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    selected
                      ? "border-border/40 bg-muted-foreground/25 text-foreground"
                      : "border-border bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                  aria-pressed={selected}
                  onClick={() => onSirenRoleChange(id)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <DiscoverySirenTagsInput
            value={selectedSirens}
            draft={sirenDraft}
            onValueChange={onSelectedSirensChange}
            onDraftChange={onSirenDraftChange}
          />
          {sirenRole === "domiciliation" ? (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium leading-snug text-foreground">
                Division NAF
              </Label>
              <DiscoveryNafDivisionPicker
                value={nafDivisionQuery}
                onValueChange={onNafDivisionQueryChange}
                options={nafDivisionOptions}
              />
            </div>
          ) : null}
        </div>
        <div
          className="space-y-2"
          title="Somme des empreintes OSM du combo (comme dans le tiroir), pas bâtiment par bâtiment."
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Label
              id="discovery-surface-range-label"
              className="text-sm font-medium leading-none"
            >
              Surface building (m²)
            </Label>
            <output
              htmlFor="discovery-surface-range"
              className="font-mono text-xs font-medium tabular-nums tracking-tight text-muted-foreground"
              aria-live="polite"
            >
              {lo.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} —{" "}
              {hi >= DISCOVERY_SURFACE_SLIDER_MAX_M2
                ? `${DISCOVERY_SURFACE_SLIDER_MAX_M2.toLocaleString("fr-FR")}+`
                : hi.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}
            </output>
          </div>
          <RangeSlider
            variant="slider04"
            id="discovery-surface-range"
            aria-labelledby="discovery-surface-range-label"
            min={0}
            max={DISCOVERY_SURFACE_SLIDER_MAX_M2}
            step={SURFACE_SLIDER_STEP}
            value={rangeValue}
            onValueChange={(v) => {
              if (v.length < 2) return;
              const a = Number.isFinite(v[0]) ? v[0]! : 0;
              const b = Number.isFinite(v[1]) ? v[1]! : DISCOVERY_SURFACE_SLIDER_MAX_M2;
              const nextLo = Math.min(a, b);
              const nextHi = Math.max(a, b);
              if (nextLo === lo && nextHi === hi) return;
              onSurfaceMinChange(nextLo);
              onSurfaceMaxChange(nextHi);
            }}
            className="py-1"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label
              id="discovery-parking-range-label"
              className="text-sm font-medium leading-none"
              title="Somme des surfaces parking distinctes liées au combo (parcelle commune), pas parking par parking sur la carte."
            >
              Surface parking (m²)
            </Label>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[10px] font-medium text-muted-foreground">
                {parkingFilterEnabled ? "Filtré" : "Tous"}
              </span>
              <Switch
                size="sm"
                checked={parkingFilterEnabled}
                onCheckedChange={onParkingFilterEnabledChange}
                aria-label="Filtrer par surface parking"
              />
            </div>
          </div>
          <output
            htmlFor="discovery-parking-range"
            className="block font-mono text-xs font-medium tabular-nums tracking-tight text-muted-foreground"
            aria-live="polite"
          >
            {parkingFilterEnabled ? (
              <>
                {pLo.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} —{" "}
                {pHi >= DISCOVERY_PARKING_SLIDER_MAX_M2
                  ? `${DISCOVERY_PARKING_SLIDER_MAX_M2.toLocaleString("fr-FR")}+`
                  : pHi.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}
              </>
            ) : (
              "Aucun seuil"
            )}
          </output>
          <RangeSlider
            variant="slider04"
            id="discovery-parking-range"
            aria-labelledby="discovery-parking-range-label"
            min={0}
            max={DISCOVERY_PARKING_SLIDER_MAX_M2}
            step={SURFACE_SLIDER_STEP}
            value={parkingRangeValue}
            disabled={!parkingFilterEnabled}
            onValueChange={(v) => {
              if (!parkingFilterEnabled || v.length < 2) return;
              const a = Number.isFinite(v[0]) ? v[0]! : 0;
              const b = Number.isFinite(v[1]) ? v[1]! : DISCOVERY_PARKING_SLIDER_MAX_M2;
              const nextLo = Math.min(a, b);
              const nextHi = Math.max(a, b);
              if (nextLo === pLo && nextHi === pHi) return;
              onParkingMinChange(nextLo);
              onParkingMaxChange(nextHi);
            }}
            className={cn("py-1", !parkingFilterEnabled && "opacity-45")}
          />
        </div>
        <div
          className="space-y-2"
          title="Σ empreintes building du combo ÷ Σ surfaces contour parcelle(s) du combo (comme dans le tiroir)."
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Label
              id="discovery-footprint-ratio-range-label"
              className="text-sm font-medium leading-none"
            >
              Couverture
            </Label>
            <output
              htmlFor="discovery-footprint-ratio-range"
              className="font-mono text-xs font-medium tabular-nums tracking-tight text-muted-foreground"
              aria-live="polite"
            >
              {rLo}% —{" "}
              {rHi >= DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT
                ? `${DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT}%+`
                : `${rHi}%`}
            </output>
          </div>
          <RangeSlider
            variant="slider04"
            id="discovery-footprint-ratio-range"
            aria-labelledby="discovery-footprint-ratio-range-label"
            min={DISCOVERY_FOOTPRINT_RATIO_SLIDER_MIN_PCT}
            max={DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT}
            step={DISCOVERY_FOOTPRINT_RATIO_SLIDER_STEP_PCT}
            value={footprintRatioRangeValue}
            onValueChange={(v) => {
              if (v.length < 2) return;
              const a = Number.isFinite(v[0]) ? v[0]! : DISCOVERY_FOOTPRINT_RATIO_SLIDER_MIN_PCT;
              const b = Number.isFinite(v[1])
                ? v[1]!
                : DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT;
              const nextLo = Math.min(a, b);
              const nextHi = Math.max(a, b);
              if (nextLo === rLo && nextHi === rHi) return;
              onFootprintRatioMinChange(nextLo);
              onFootprintRatioMaxChange(nextHi);
            }}
            className="py-1"
          />
        </div>
        <div
          className="space-y-2"
          title="Au moins un bâtiment de l'empreinte doit avoir une année de construction connue dans cet intervalle."
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Label
              id="discovery-construction-year-range-label"
              className="text-sm font-medium leading-none"
            >
              Année de construction
            </Label>
            <output
              htmlFor="discovery-construction-year-range"
              className="font-mono text-xs font-medium tabular-nums tracking-tight text-muted-foreground"
              aria-live="polite"
            >
              {yLo} — {yHi}
            </output>
          </div>
          <RangeSlider
            variant="slider04"
            id="discovery-construction-year-range"
            aria-labelledby="discovery-construction-year-range-label"
            min={DISCOVERY_CONSTRUCTION_YEAR_SLIDER_MIN}
            max={constructionYearSliderMax}
            step={1}
            value={constructionYearRangeValue}
            onValueChange={(v) => {
              if (v.length < 2) return;
              const a = Number.isFinite(v[0]) ? Math.round(v[0]!) : DISCOVERY_CONSTRUCTION_YEAR_SLIDER_MIN;
              const b = Number.isFinite(v[1])
                ? Math.round(v[1]!)
                : constructionYearSliderMax;
              const nextLo = Math.min(a, b);
              const nextHi = Math.max(a, b);
              if (nextLo === yLo && nextHi === yHi) return;
              onConstructionYearMinChange(nextLo);
              onConstructionYearMaxChange(nextHi);
            }}
            className="py-1"
          />
        </div>
        <div className="space-y-2" title="Open data Enedis — consommation annuelle entreprise par adresse (indicatif).">
          <div className="flex items-center justify-between gap-2">
            <Label
              id="discovery-enedis-range-label"
              className="text-sm font-medium leading-none"
            >
              Consommation électricité (Enedis)
            </Label>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[10px] font-medium text-muted-foreground">
                {enedisFilterEnabled
                  ? enedisLoading
                    ? "…"
                    : enedisPointCount.toLocaleString("fr-FR")
                  : "Off"}
              </span>
              <Switch
                size="sm"
                checked={enedisFilterEnabled}
                onCheckedChange={onEnedisFilterEnabledChange}
                aria-label="Afficher la consommation Enedis sur la carte"
              />
            </div>
          </div>
          {enedisFilterEnabled ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Année</Label>
                <Select
                  value={enedisYear}
                  onValueChange={(v) => onEnedisYearChange(v as DiscoveryEnedisYear)}
                >
                  <SelectTrigger className="h-9" aria-label="Année de consommation Enedis">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISCOVERY_ENEDIS_YEARS.map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <output
                htmlFor="discovery-enedis-range"
                className="block font-mono text-xs font-medium tabular-nums tracking-tight text-muted-foreground"
                aria-live="polite"
              >
                {eLo.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} —{" "}
                {eHi >= DISCOVERY_ENEDIS_MWH_SLIDER_MAX
                  ? `${DISCOVERY_ENEDIS_MWH_SLIDER_MAX.toLocaleString("fr-FR")}+`
                  : eHi.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}{" "}
                MWh/an
              </output>
              <RangeSlider
                variant="slider04"
                id="discovery-enedis-range"
                aria-labelledby="discovery-enedis-range-label"
                min={DISCOVERY_ENEDIS_MWH_SLIDER_MIN}
                max={DISCOVERY_ENEDIS_MWH_SLIDER_MAX}
                step={DISCOVERY_ENEDIS_MWH_SLIDER_STEP}
                value={enedisRangeValue}
                onValueChange={(v) => {
                  if (v.length < 2) return;
                  const a = Number.isFinite(v[0]) ? v[0]! : DISCOVERY_ENEDIS_MWH_SLIDER_MIN;
                  const b = Number.isFinite(v[1])
                    ? v[1]!
                    : DISCOVERY_ENEDIS_MWH_SLIDER_MAX;
                  const nextLo = Math.min(a, b);
                  const nextHi = Math.max(a, b);
                  if (nextLo === eLo && nextHi === eHi) return;
                  onEnedisMwhMinChange(nextLo);
                  onEnedisMwhMaxChange(nextHi);
                }}
                className="py-1"
              />
              {enedisError ? (
                <p className="text-[10px] text-destructive">{enedisError}</p>
              ) : null}
              {enedisTruncated && !enedisError ? (
                <p className="text-[10px] text-muted-foreground">
                  Affichage limité (zoom ou géocodage partiel).
                </p>
              ) : null}
              <p className="text-[10px] text-muted-foreground leading-snug">
                Données indicatives Enedis.{" "}
                <a
                  href="https://opendata.enedis.fr/datasets/consommation-annuelle-entreprise-par-adresse"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Documentation
                </a>
              </p>
            </>
          ) : null}
        </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
