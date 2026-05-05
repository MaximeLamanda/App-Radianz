"use client";

import { type ReactNode, useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis } from "recharts";
import {
  ChartContainer,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { radianzMonoLabelClass } from "@/lib/radianz-card-primitives";

/** Aligné sur le BarChart « Revenue » du Radianz Design System (HTML v0.1). */
const LINE = "#E4E2DE";
const INK = "#0A0A0A";
const MUTED_TICK = "#6B6B6B";

const monthAxisLabels = [
  "JAN", "FÉV", "MAR", "AVR", "MAI", "JUN", "JUL", "AOÛ", "SEP", "OCT", "NOV", "DÉC",
];

const chartConfig = {
  consumption: {
    label: "Consommation (MWh)",
    color: INK,
  },
} satisfies ChartConfig;

const KWH_PER_MWH = 1000;

function formatMwhTick(n: number) {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function buildNiceYAxis(maxValue: number) {
  const safeMax = Number.isFinite(maxValue) ? maxValue : 0;
  if (safeMax <= 0) return { domain: [0, 1] as const, ticks: [0, 0.25, 0.5, 0.75, 1] };

  const magnitude = Math.pow(10, Math.floor(Math.log10(safeMax)));
  const candidates = [
    0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000,
  ].map((m) => m * Math.max(1, magnitude / 10));

  let chosenStep = candidates[candidates.length - 1]!;
  let chosenMax = Math.ceil(safeMax / chosenStep) * chosenStep;
  let chosenTicks: number[] | undefined;

  for (const step of candidates) {
    const domainMax = Math.ceil(safeMax / step) * step;
    const count = Math.round(domainMax / step) + 1;
    if (count >= 4 && count <= 7) {
      const ticks: number[] = [];
      for (let v = 0; v <= domainMax + step / 2; v += step) ticks.push(v);
      chosenStep = step;
      chosenMax = domainMax;
      chosenTicks = ticks;
      break;
    }
    chosenStep = step;
    chosenMax = domainMax;
  }

  if (!chosenTicks) {
    const ticks: number[] = [];
    for (let v = 0; v <= chosenMax + chosenStep / 2; v += chosenStep) ticks.push(v);
    chosenTicks = ticks;
  }

  return { domain: [0, chosenMax] as const, ticks: chosenTicks };
}

export interface MonthlyConsumptionOnlyChartProps {
  /** kWh par mois, index 0 = janvier, 11 = décembre */
  monthlyKwh: number[];
  /** Unité d'affichage des valeurs. */
  unitMode?: "mwh" | "eur";
  /** Callback de changement d'unité. */
  onUnitModeChange?: (mode: "mwh" | "eur") => void;
  /** Prix retail utilisé pour conversion kWh -> €. */
  retailPriceEurPerKwh?: number;
  /** Mois mis en avant (barre noire) — ex. focus sur le champ du même index */
  highlightedMonthIndex?: number | null;
  /** Contenu rendu sous la valeur MWh et au-dessus du graphe. */
  contentBelowTotal?: ReactNode;
  /** Si true, le graphe occupe la hauteur restante (carte parente en colonne flex avec min-height). */
  fillVertical?: boolean;
  className?: string;
}

export function MonthlyConsumptionOnlyChart({
  monthlyKwh,
  unitMode = "mwh",
  onUnitModeChange,
  retailPriceEurPerKwh = 0,
  highlightedMonthIndex = null,
  contentBelowTotal,
  fillVertical = false,
  className,
}: MonthlyConsumptionOnlyChartProps) {
  const toDisplayValue = (kwh: number) =>
    unitMode === "eur"
      ? Math.max(0, kwh) * Math.max(0, retailPriceEurPerKwh)
      : Math.max(0, kwh) / KWH_PER_MWH;

  const chartData = useMemo(
    () =>
      monthAxisLabels.map((label, i) => ({
      month: label,
      consumption: toDisplayValue(monthlyKwh[i] ?? 0),
      })),
    [monthlyKwh, unitMode, retailPriceEurPerKwh]
  );

  const stackedMax = useMemo(
    () => chartData.reduce((m, d) => Math.max(m, d.consumption), 0),
    [chartData]
  );
  const y = useMemo(() => buildNiceYAxis(stackedMax), [stackedMax]);

  const annualKwhTotal = useMemo(
    () =>
      monthlyKwh.reduce((acc, v) => {
        const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
        return acc + Math.max(0, n);
      }, 0),
    [monthlyKwh]
  );
  const totalDisplay = toDisplayValue(annualKwhTotal);
  const unitLabel = unitMode === "eur" ? "€" : "MWh";
  const formatDisplayValue = (value: number) =>
    value.toLocaleString("fr-FR", {
      minimumFractionDigits: unitMode === "eur" ? 0 : 1,
      maximumFractionDigits: unitMode === "eur" ? 0 : 1,
    });
  const subtitleLabel =
    unitMode === "eur"
      ? "Consommation valorisée (euros)"
      : "Consommation";

  return (
    <div
      className={cn(
        "w-full min-w-0",
        fillVertical && "flex min-h-0 flex-1 flex-col",
        className
      )}
    >
      {/* Aligné sur `.viz-h` + `.viz-num` du Revenue (Radianz Design System HTML). */}
      <div
        className={cn(
          "flex justify-between items-start gap-2",
          radianzMonoLabelClass,
          fillVertical && "shrink-0"
        )}
      >
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{subtitleLabel}</span>
          <span className="font-normal text-muted-foreground">TOTAL</span>
        </div>
        <div className="inline-flex rounded-md border border-border bg-muted/50 p-0.5 shrink-0" role="tablist" aria-label="Vue du graphique facture">
          <button
            type="button"
            role="tab"
            aria-selected={unitMode === "mwh"}
            onClick={() => onUnitModeChange?.("mwh")}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium transition-colors",
              unitMode === "mwh" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
            )}
          >
            MWh
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={unitMode === "eur"}
            onClick={() => onUnitModeChange?.("eur")}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium transition-colors",
              unitMode === "eur" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
            )}
          >
            €
          </button>
        </div>
      </div>
      <div
        className={cn(
          "mt-4 font-sans text-[2rem] font-light leading-none tracking-[-0.04em] text-foreground tabular-nums sm:text-[2.25rem]",
          fillVertical && "shrink-0"
        )}
      >
        {formatDisplayValue(totalDisplay)}
        <small className="ml-1.5 align-baseline font-mono text-sm font-normal tracking-normal text-muted-foreground">
          {unitLabel}
        </small>
        <span className="sr-only"> cumulés sur 12 mois</span>
      </div>
      {contentBelowTotal ? (
        <div className={cn("mt-3", fillVertical && "shrink-0")}>{contentBelowTotal}</div>
      ) : null}
      {/*
        fillVertical : Recharts mesure le parent de .recharts-responsive-container.
        Sans flex-1 / hauteur explicite sur ce nœud, il reste ~200px alors que le slot fait 300px+.
        Grille 1fr sur le slot + h-full sur ChartContainer donne une hauteur résolue ; le conteneur
        Recharts en flex-1 remplit l’axe vertical (le <style> de ChartStyle est hors flux).
      */}
      <div
        className={cn(
          "mt-3 w-full min-w-0",
          fillVertical &&
            "min-h-0 max-h-[264px] flex-1 [display:grid] [grid-template-columns:minmax(0,100%)] [grid-template-rows:minmax(200px,1fr)]"
        )}
      >
        <ChartContainer
          config={chartConfig}
          className={cn(
            "w-full min-w-0 [&_.recharts-cartesian-axis-tick_text]:font-mono [&_.recharts-cartesian-axis-tick_text]:text-[10px] [&_.recharts-cartesian-axis-tick_text]:tracking-wide [&_.recharts-tooltip-cursor]:fill-[rgba(10,10,10,0.04)]",
            fillVertical
              ? "aspect-auto h-full max-h-full min-h-0 flex flex-col justify-start [&_.recharts-responsive-container]:min-h-0 [&_.recharts-responsive-container]:w-full [&_.recharts-responsive-container]:flex-1 [&_.recharts-responsive-container]:basis-0 [&_.recharts-wrapper]:h-full [&_.recharts-surface]:h-full"
              : "aspect-auto h-[148px]"
          )}
        >
        <BarChart
          accessibilityLayer
          data={chartData}
          margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
          barCategoryGap="30%"
        >
          <CartesianGrid vertical={false} stroke={LINE} strokeDasharray="2 4" />
          <XAxis
            dataKey="month"
            tickLine={false}
            tickMargin={8}
            axisLine={false}
            interval={0}
            tick={{ fill: MUTED_TICK, fontSize: 10 }}
          />
          <Tooltip
            cursor={{ fill: "rgba(10,10,10,0.04)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const v = Number(payload[0]?.value ?? 0);
              return (
                <div
                  className="rounded-md px-2.5 py-1.5 font-mono text-[11px] shadow-md"
                  style={{
                    background: INK,
                    color: "#FFFFFF",
                  }}
                >
                  <div className="text-[10px] uppercase tracking-wider text-[#9A9A9A]">{label}</div>
                  <div className="font-medium tabular-nums" style={{ color: "#EFF9BA" }}>
                    {formatDisplayValue(v)} {unitLabel}
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="consumption"
            radius={[0, 0, 0, 0]}
            isAnimationActive={false}
            name="Consommation"
            barSize={36}
          >
            {chartData.map((entry, i) => (
              <Cell
                key={entry.month}
                fill={highlightedMonthIndex === i ? INK : LINE}
              />
            ))}
          </Bar>
        </BarChart>
        </ChartContainer>
      </div>
    </div>
  );
}
