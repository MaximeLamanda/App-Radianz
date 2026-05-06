"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RangeSlider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

/** Plafond slider. Le plancher par défaut côté page suit l’export matching V5 (`lib/discovery-surface-defaults.ts`). */
const SURFACE_SLIDER_MAX_M2 = 50_000;
const SURFACE_SLIDER_STEP = 50;

export type DiscoveryFiltersPanelProps = {
  surfaceMinM2: number;
  surfaceMaxM2: number;
  onSurfaceMinChange: (v: number) => void;
  onSurfaceMaxChange: (v: number) => void;
  /** IRIS dont le libellé est « Parc industriel » (même règle que le pipeline V5). */
  onlyParcIndustrielIris: boolean;
  onOnlyParcIndustrielIrisChange: (v: boolean) => void;
  rowCount: number;
  loading: boolean;
  error: string | null;
  className?: string;
};

export function DiscoveryFiltersPanel({
  surfaceMinM2,
  surfaceMaxM2,
  onSurfaceMinChange,
  onSurfaceMaxChange,
  onlyParcIndustrielIris,
  onOnlyParcIndustrielIrisChange,
  rowCount,
  loading,
  error,
  className,
}: DiscoveryFiltersPanelProps) {
  const lo = Math.min(surfaceMinM2, surfaceMaxM2);
  const hi = Math.max(surfaceMinM2, surfaceMaxM2);
  const rangeValue = useMemo(() => [lo, hi] as [number, number], [lo, hi]);

  return (
    <Card
      className={cn(
        "h-fit rounded-xl border-border bg-card/95 text-card-foreground shadow-lg backdrop-blur-sm",
        className
      )}
    >
      <CardHeader className="space-y-1.5 p-3 pb-1.5 md:p-3 md:pb-1.5 lg:p-3 lg:pb-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle className="text-base font-semibold tracking-tight">Filtres</CardTitle>
          <span
            className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
            aria-label={
              loading
                ? "Chargement du nombre d’entités"
                : `${rowCount} entités dans la vue après filtres`
            }
          >
            {loading ? "…" : rowCount.toLocaleString("fr-FR")}
          </span>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardHeader>
      <CardContent className="space-y-2 p-3 pb-3 pt-0 md:p-3 md:pb-3 lg:p-3 lg:pb-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Label id="discovery-surface-range-label" className="text-sm font-medium leading-none">
              Surface empreinte (m²)
            </Label>
            <output
              htmlFor="discovery-surface-range"
              className="font-mono text-xs font-medium tabular-nums tracking-tight text-muted-foreground"
              aria-live="polite"
            >
              {lo.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} —{" "}
              {hi.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}
            </output>
          </div>
          <RangeSlider
            id="discovery-surface-range"
            aria-labelledby="discovery-surface-range-label"
            min={0}
            max={SURFACE_SLIDER_MAX_M2}
            step={SURFACE_SLIDER_STEP}
            value={rangeValue}
            onValueChange={(v) => {
              if (v.length < 2) return;
              const a = Number.isFinite(v[0]) ? v[0]! : 0;
              const b = Number.isFinite(v[1]) ? v[1]! : SURFACE_SLIDER_MAX_M2;
              onSurfaceMinChange(Math.min(a, b));
              onSurfaceMaxChange(Math.max(a, b));
            }}
            className="py-1"
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2">
          <Label
            htmlFor="discovery-parc-industriel-iris"
            className="cursor-pointer text-sm font-medium leading-snug text-foreground"
          >
            IRIS parc industriel
          </Label>
          <Switch
            id="discovery-parc-industriel-iris"
            size="sm"
            checked={onlyParcIndustrielIris}
            onCheckedChange={onOnlyParcIndustrielIrisChange}
            aria-label="Limiter aux îlots IRIS « Parc industriel »"
          />
        </div>
      </CardContent>
    </Card>
  );
}
