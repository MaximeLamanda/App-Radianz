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
  /** Mois mis en avant (barre noire) — ex. focus sur le champ du même index */
  highlightedMonthIndex?: number | null;
  /** Contenu rendu sous la valeur MWh et au-dessus du graphe. */
  contentBelowTotal?: ReactNode;
}

export function MonthlyConsumptionOnlyChart({
  monthlyKwh,
  highlightedMonthIndex = null,
  contentBelowTotal,
}: MonthlyConsumptionOnlyChartProps) {
  const chartData = useMemo(
    () =>
      monthAxisLabels.map((label, i) => ({
        month: label,
        /** MWh pour l’axe et les barres (données d’entrée en kWh). */
        consumption: (monthlyKwh[i] ?? 0) / KWH_PER_MWH,
      })),
    [monthlyKwh]
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

  return (
    <div className="w-full min-w-0">
      {/* Aligné sur `.viz-h` + `.viz-num` du Revenue (Radianz Design System HTML). */}
      <div className={cn("flex justify-between items-start gap-2", radianzMonoLabelClass)}>
        <span className="font-medium text-foreground">Consommation</span>
        <span className="font-normal text-muted-foreground shrink-0 text-right">BarChart · mensuel</span>
      </div>
      <div className="mt-4 font-sans text-[2rem] font-light leading-none tracking-[-0.04em] text-foreground tabular-nums sm:text-[2.25rem]">
        {(annualKwhTotal / KWH_PER_MWH).toLocaleString("fr-FR", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 3,
        })}
        <small className="ml-1.5 align-baseline font-mono text-sm font-normal tracking-normal text-muted-foreground">
          MWh
        </small>
        <span className="sr-only"> cumulés sur 12 mois</span>
      </div>
      {contentBelowTotal ? <div className="mt-3">{contentBelowTotal}</div> : null}
      <ChartContainer
        config={chartConfig}
        className="mt-3 aspect-auto h-[148px] w-full min-w-0 [&_.recharts-cartesian-axis-tick_text]:font-mono [&_.recharts-cartesian-axis-tick_text]:text-[10px] [&_.recharts-cartesian-axis-tick_text]:tracking-wide [&_.recharts-tooltip-cursor]:fill-[rgba(10,10,10,0.04)]"
      >
        <BarChart
          accessibilityLayer
          data={chartData}
          margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
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
                    {v.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 3 })} MWh
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="consumption" radius={[3, 3, 0, 0]} isAnimationActive={false} name="Consommation">
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
  );
}
