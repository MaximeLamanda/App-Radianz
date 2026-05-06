"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { Slider } from "@/components/ui/slider";
import { FilterLabel } from "./FilterLabel";
import { cn } from "@/lib/utils";
import { radianzCartesianGridProps } from "@/lib/radianz-chart-recharts";
import { StickSliderTrack } from "./StickSliderTrack";

export interface MonthlyProductionChartDatum {
  month: number;
  production: number;
  consumption?: number;
  /** Avec batterie : autoconsommation directe (PV → conso). */
  selfConsumptionDirect?: number;
  /** Avec batterie : tirage batterie (autoconsommation via batterie). */
  selfConsumptionViaBattery?: number;
  /** Avec batterie : surplus PV stocké dans la batterie (injection batterie). */
  injectionBattery?: number;
  /** Avec batterie : injection réseau (surplus PV une fois batterie pleine). */
  excess?: number;
  /** Avec batterie : tirage réseau. */
  gridDraw?: number;
}

export interface DailyProductionChartDatum {
  hour: number;
  production: number;
  consumption?: number;
  selfConsumptionDirect?: number;
  selfConsumptionViaBattery?: number;
  injectionBattery?: number;
  excess?: number;
  gridDraw?: number;
}

interface MonthlyProductionChartProps {
  data: Array<MonthlyProductionChartDatum>;
  /** Données horaires (24h) pour le mode Journalier (jour type du mois sélectionné). */
  dailyData?: Array<DailyProductionChartDatum>;
  /** Mode d'affichage (contrôlé par le parent, ex. switch à côté du titre). */
  viewMode?: "monthly" | "daily";
  /** Callback quand le mode change (si le switch est dans le parent). */
  onViewModeChange?: (mode: "monthly" | "daily") => void;
  /** Mois sélectionné pour la vue journalière (0 = janvier, 11 = décembre). */
  selectedMonthIndex?: number;
  /** Callback quand le slider mois change en vue journalière. */
  onSelectedMonthIndexChange?: (index: number) => void;
}

const monthNames = [
  "Jan", "Fév", "Mar", "Avr", "Mai", "Jun",
  "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"
];

/** Couleurs séries = tokens `--chart-1…5` (Radianz DS). */
const chartConfig = {
  selfConsumption: {
    label: "Autoconsommation (kWh)",
    color: "var(--chart-1)",
  },
  selfConsumptionDirect: {
    label: "Autoconsommation directe (kWh)",
    color: "#0A0A0A",
  },
  selfConsumptionViaBattery: {
    label: "Tirage batterie (kWh)",
    color: "#0000FF",
  },
  injectionBattery: {
    label: "Injection batterie (kWh)",
    color: "#BFD6FF",
  },
  excess: {
    label: "Injection réseau (kWh)",
    color: "#6B6B6B",
  },
  gridDraw: {
    label: "Tirage réseau (kWh)",
    color: "#E4E2DE",
  },
  production: {
    label: "Production (kWh)",
    color: "var(--chart-1)",
  },
  consumption: {
    label: "Consommation (kWh)",
    color: "#E4E2DE",
  },
} satisfies ChartConfig;

function buildNiceYAxis(maxValue: number) {
  const safeMax = Number.isFinite(maxValue) ? maxValue : 0;
  if (safeMax <= 0) return { domain: [0, 1] as const, ticks: [0, 0.25, 0.5, 0.75, 1] };

  const magnitude = Math.pow(10, Math.floor(Math.log10(safeMax)));
  const candidates = [
    0.25,
    0.5,
    1,
    2,
    2.5,
    5,
    10,
    20,
    25,
    50,
    100,
    200,
    250,
    500,
    1000,
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

function formatKwhTick(value: number) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 100) return String(Math.round(value));
  if (abs >= 10) return value.toFixed(0);
  return value.toFixed(1);
}

export function MonthlyProductionChart({
  data,
  dailyData,
  viewMode: controlledViewMode,
  onViewModeChange,
  selectedMonthIndex: controlledMonthIndex = 6,
  onSelectedMonthIndexChange,
}: MonthlyProductionChartProps) {
  const [internalViewMode, setInternalViewMode] = useState<"monthly" | "daily">("monthly");
  const [internalMonthIndex, setInternalMonthIndex] = useState(6);
  const viewMode = controlledViewMode ?? internalViewMode;
  const setViewMode = onViewModeChange ?? setInternalViewMode;
  const selectedMonthIndex = onSelectedMonthIndexChange ? controlledMonthIndex : (controlledMonthIndex ?? internalMonthIndex);
  const setSelectedMonthIndex = onSelectedMonthIndexChange ?? setInternalMonthIndex;
  const isDaily = viewMode === "daily" && dailyData && dailyData.length === 24;
  const hasConsumption = isDaily
    ? dailyData!.some((d) => typeof d.consumption === "number")
    : data.some((d) => typeof d.consumption === "number");
  const hasBatterySeries = isDaily
    ? dailyData!.some((d) => typeof d.selfConsumptionDirect === "number" && typeof d.selfConsumptionViaBattery === "number")
    : data.some((d) => typeof d.selfConsumptionDirect === "number" && typeof d.selfConsumptionViaBattery === "number");

  const chartData = isDaily
    ? dailyData!.map((item) => {
        const prod = item.production;
        const cons = item.consumption ?? 0;
        const selfConsumptionDirect = item.selfConsumptionDirect;
        const selfConsumptionViaBattery = item.selfConsumptionViaBattery;
        const injectionBattery = item.injectionBattery ?? 0;
        const excess = item.excess ?? (hasConsumption ? Math.max(0, prod - cons) : prod);
        const gridDraw = item.gridDraw ?? (hasConsumption ? Math.max(0, cons - prod) : 0);
        const selfConsumption =
          typeof selfConsumptionDirect === "number" && typeof selfConsumptionViaBattery === "number"
            ? selfConsumptionDirect + selfConsumptionViaBattery
            : hasConsumption ? Math.min(prod, cons) : 0;
        return {
          month: `${item.hour}h`,
          hour: item.hour,
          production: prod,
          selfConsumption,
          selfConsumptionDirect: selfConsumptionDirect ?? (hasConsumption ? Math.min(prod, cons) : 0),
          selfConsumptionViaBattery: selfConsumptionViaBattery ?? 0,
          injectionBattery,
          excess,
          gridDraw,
          consumption: cons,
        };
      })
    : data.map((item) => {
        const prod = item.production;
        const cons = item.consumption ?? 0;
        const selfConsumptionDirect = item.selfConsumptionDirect;
        const selfConsumptionViaBattery = item.selfConsumptionViaBattery;
        const injectionBattery = 0; // Masqué en vue mensuelle (pas de barre affichée)
        const excess = item.excess ?? (hasConsumption ? Math.max(0, prod - cons) : prod); // Injection réseau seule : varie quand le nb de batteries change
        const gridDraw = item.gridDraw ?? (hasConsumption ? Math.max(0, cons - prod) : 0);
        const selfConsumption =
          typeof selfConsumptionDirect === "number" && typeof selfConsumptionViaBattery === "number"
            ? selfConsumptionDirect + selfConsumptionViaBattery
            : hasConsumption ? Math.min(prod, cons) : 0;
        return {
          month: monthNames[item.month - 1] || `M${item.month}`,
          production: prod,
          selfConsumption,
          selfConsumptionDirect: selfConsumptionDirect ?? (hasConsumption ? Math.min(prod, cons) : 0),
          selfConsumptionViaBattery: selfConsumptionViaBattery ?? 0,
          injectionBattery,
          excess,
          gridDraw,
          consumption: cons,
        };
      });

  const stackedMax = useMemo(() => {
    const getMaxStack = (d: any) => {
      if (hasConsumption) {
        if (hasBatterySeries) {
          return (
            (Number(d.selfConsumptionDirect) || 0) +
            (Number(d.selfConsumptionViaBattery) || 0) +
            (isDaily ? (Number(d.injectionBattery) || 0) : 0) +
            (Number(d.gridDraw) || 0) +
            (Number(d.excess) || 0)
          );
        }
        return (Number(d.selfConsumption) || 0) + (Number(d.gridDraw) || 0) + (Number(d.excess) || 0);
      }
      return Number(d.production) || 0;
    };

    let max = 0;
    for (const d of chartData) max = Math.max(max, getMaxStack(d));
    return max;
  }, [chartData, hasBatterySeries, hasConsumption, isDaily]);

  // En vue journalière: on "verrouille" l'échelle une fois qu'elle s'est adaptée
  // (elle peut s'agrandir si un autre mois dépasse, mais ne rétrécit pas).
  const [lockedDailyMax, setLockedDailyMax] = useState<number | null>(null);
  useEffect(() => {
    if (!isDaily) {
      setLockedDailyMax(null);
      return;
    }
    setLockedDailyMax((prev) => (prev == null ? stackedMax : Math.max(prev, stackedMax)));
  }, [isDaily, stackedMax]);

  // Vue mensuelle: garde le plus grand stackedMax déjà vu (avec ou sans batterie, etc.) pour
  // que l’axe Y ne redescende pas quand on bascule le switch. Réinitialisé en journalier.
  const [monthlyPeakStackedMax, setMonthlyPeakStackedMax] = useState<number | null>(null);
  useEffect(() => {
    if (isDaily) {
      setMonthlyPeakStackedMax(null);
      return;
    }
    setMonthlyPeakStackedMax((prev) => (prev == null ? stackedMax : Math.max(prev, stackedMax)));
  }, [isDaily, stackedMax]);

  const yMaxForDomain = useMemo(() => {
    if (isDaily) return lockedDailyMax ?? stackedMax;
    if (monthlyPeakStackedMax != null) {
      return Math.max(monthlyPeakStackedMax, stackedMax);
    }
    return stackedMax;
  }, [isDaily, lockedDailyMax, stackedMax, monthlyPeakStackedMax]);

  const y = useMemo(() => buildNiceYAxis(yMaxForDomain), [yMaxForDomain]);

  return (
    <div className="w-full min-w-0 h-full min-h-0 flex-1 flex flex-col">
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-full min-h-[120px] w-full min-w-0 [&_.recharts-cartesian-axis-tick_text]:font-mono [&_.recharts-cartesian-axis-tick_text]:text-[9px] [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-axis-tick_text]:tracking-wide"
      >
        <BarChart
          accessibilityLayer
          data={chartData}
          margin={{ top: 8, right: 4, left: 4, bottom: 0 }}
          barCategoryGap="28%"
          barGap={0}
        >
          <CartesianGrid {...radianzCartesianGridProps} />
          <XAxis
            dataKey="month"
            tickLine={false}
            tickMargin={10}
            axisLine={false}
            tickFormatter={(value) => value}
            tick={{ fontSize: 9 }}
            interval={isDaily ? 3 : 0}
          />
          <YAxis
            hide
            width={0}
            domain={y.domain as unknown as [number | "auto", number | "auto"]}
            ticks={y.ticks}
          />
          <ChartTooltip
            allowEscapeViewBox={{ x: true, y: true }}
            offset={-20}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              const fmt = (n: number) => Number(n).toFixed(1);
              return (
                <div className="rounded-md border border-border/50 bg-background px-2 py-1 text-[10px] shadow-lg">
                  <div className="font-medium mb-0.5">{isDaily ? `${p.hour}h - ${p.hour + 1}h` : p.month}</div>
                  <div className="flex flex-col gap-0.5">
                    {hasConsumption && (
                      <>
                        {hasBatterySeries ? (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-[1px] shrink-0"
                                style={{ backgroundColor: "var(--color-selfConsumptionDirect)" }}
                              />
                              <span>Autoconsommation directe : {fmt(p.selfConsumptionDirect ?? 0)} kWh</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-[1px] shrink-0"
                                style={{ backgroundColor: "var(--color-selfConsumptionViaBattery)" }}
                              />
                              <span>Tirage batterie : {fmt(p.selfConsumptionViaBattery ?? 0)} kWh</span>
                            </div>
                            {isDaily && (p.injectionBattery ?? 0) > 0 && (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-[1px] shrink-0"
                                  style={{ backgroundColor: "var(--color-injectionBattery)" }}
                                />
                                <span>Injection batterie : {fmt(p.injectionBattery)} kWh</span>
                              </div>
                            )}
                            {p.gridDraw > 0 && (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-[1px] shrink-0"
                                  style={{ backgroundColor: "var(--color-gridDraw)" }}
                                />
                                <span>Tirage réseau : {fmt(p.gridDraw)} kWh</span>
                              </div>
                            )}
                            {(p.excess ?? 0) > 0 && (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-[1px] shrink-0"
                                  style={{ backgroundColor: "var(--color-excess)" }}
                                />
                                <span>Injection réseau : {fmt(p.excess)} kWh</span>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-[1px] shrink-0"
                                style={{ backgroundColor: "var(--color-selfConsumption)" }}
                              />
                              <span>Autoconsommation : {fmt(p.selfConsumption)} kWh</span>
                            </div>
                            {p.gridDraw > 0 && (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-[1px] shrink-0"
                                  style={{ backgroundColor: "var(--color-gridDraw)" }}
                                />
                                <span>Tirage réseau : {fmt(p.gridDraw)} kWh</span>
                              </div>
                            )}
                            {(p.excess ?? 0) > 0 && (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-[1px] shrink-0"
                                  style={{ backgroundColor: "var(--color-excess)" }}
                                />
                                <span>Injection réseau : {fmt(p.excess)} kWh</span>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            }}
          />
          {hasConsumption ? (
            hasBatterySeries ? (
              <>
                <Bar
                  dataKey="selfConsumptionDirect"
                  stackId="a"
                  fill="var(--color-selfConsumptionDirect)"
                  name="Autoconsommation directe"
                  barSize={34}
                />
                <Bar
                  dataKey="selfConsumptionViaBattery"
                  stackId="a"
                  fill="var(--color-selfConsumptionViaBattery)"
                  name="Tirage batterie"
                  barSize={34}
                />
                {isDaily && (
                  <Bar
                    dataKey="injectionBattery"
                    stackId="a"
                    fill="var(--color-injectionBattery)"
                    name="Injection batterie"
                    barSize={34}
                  />
                )}
                <Bar
                  dataKey="gridDraw"
                  stackId="a"
                  fill="var(--color-gridDraw)"
                  name="Tirage réseau"
                  barSize={34}
                />
                <Bar
                  dataKey="excess"
                  stackId="a"
                  fill="var(--color-excess)"
                  name="Injection réseau"
                  barSize={34}
                />
              </>
            ) : (
              <>
                <Bar
                  dataKey="selfConsumption"
                  stackId="a"
                  fill="var(--color-selfConsumption)"
                  name="Autoconsommation"
                  barSize={34}
                />
                <Bar
                  dataKey="gridDraw"
                  stackId="a"
                  fill="var(--color-gridDraw)"
                  name="Tirage réseau"
                  barSize={34}
                />
                <Bar
                  dataKey="excess"
                  stackId="a"
                  fill="var(--color-excess)"
                  name="Injection réseau"
                  barSize={34}
                />
              </>
            )
          ) : (
            <Bar
              dataKey="production"
              stackId="a"
              fill="var(--color-production)"
              name="Production"
              barSize={34}
            />
          )}
        </BarChart>
      </ChartContainer>
      {isDaily && onSelectedMonthIndexChange && (
        <div className="flex items-center justify-center mt-2 shrink-0">
          <div className="flex items-center gap-2 max-w-full">
            <FilterLabel label="Mois" />
            {/* Rotation slider : piste sombre, sticks (mois sélectionné = plus large + rouge), pas de round vert */}
            <div className="relative flex-1 min-w-[180px] max-w-[280px] rounded-[12px] border border-border bg-muted/50 px-3 py-3">
            <StickSliderTrack segments={12} selectedIndices={[selectedMonthIndex]} />
            <Slider
              value={[selectedMonthIndex + 1]}
              onValueChange={([v]) => setSelectedMonthIndex(Math.max(0, Math.min(11, (v ?? 1) - 1)))}
              min={1}
              max={12}
              step={1}
              className="relative z-10 [&_[data-orientation=horizontal]]:flex [&_[data-orientation=horizontal]]:items-center [&_.relative.grow]:!min-h-[12px] [&_.relative.grow]:!overflow-visible [&_.relative.grow]:!bg-transparent [&_.absolute.h-full]:!bg-transparent [&_.block]:!invisible [&_.block]:!h-4 [&_.block]:!w-4 [&_.block]:!rounded-none [&_.block]:!border-0 [&_.block]:!bg-transparent [&_.block]:!ring-0 [&_.block]:!ring-offset-0"
            />
          </div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-8 shrink-0">
            {monthNames[selectedMonthIndex]}
          </span>
          </div>
        </div>
      )}
    </div>
  );
}
