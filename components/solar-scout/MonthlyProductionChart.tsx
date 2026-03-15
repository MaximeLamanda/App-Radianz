"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

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

const chartConfig = {
  selfConsumption: {
    label: "Autoconsommation (kWh)",
    color: "#2d2d2d",
  },
  selfConsumptionDirect: {
    label: "Autoconsommation directe (kWh)",
    color: "#2d2d2d",
  },
  selfConsumptionViaBattery: {
    label: "Tirage batterie (kWh)",
    color: "#0000FF",
  },
  injectionBattery: {
    label: "Injection batterie (kWh)",
    color: "#9999FF",
  },
  excess: {
    label: "Injection réseau (kWh)",
    color: "#32F490",
  },
  gridDraw: {
    label: "Tirage réseau (kWh)",
    color: "hsl(0, 0%, 72%)",
  },
  production: {
    label: "Production (kWh)",
    color: "#2d2d2d",
  },
  consumption: {
    label: "Consommation (kWh)",
    color: "hsl(38, 92%, 50%)",
  },
} satisfies ChartConfig;

export function MonthlyProductionChart({
  data,
  dailyData,
  viewMode: controlledViewMode,
  onViewModeChange,
  selectedMonthIndex: controlledMonthIndex = 0,
  onSelectedMonthIndexChange,
}: MonthlyProductionChartProps) {
  const [internalViewMode, setInternalViewMode] = useState<"monthly" | "daily">("monthly");
  const [internalMonthIndex, setInternalMonthIndex] = useState(0);
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
        const injectionBattery = item.injectionBattery ?? 0;
        const excess = item.excess ?? (hasConsumption ? Math.max(0, prod - cons) : prod);
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

  return (
    <div className="w-full min-w-0 h-full min-h-0 flex-1 flex flex-col">
      <ChartContainer config={chartConfig} className="aspect-auto h-full min-h-[120px] w-full min-w-0 [&_.recharts-cartesian-axis-tick_text]:text-[9px] [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground/70">
        <BarChart accessibilityLayer data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="month"
            tickLine={false}
            tickMargin={10}
            axisLine={false}
            tickFormatter={(value) => value}
            tick={{ fontSize: 9 }}
            interval={isDaily ? 3 : 0}
          />
          <ChartTooltip
            allowEscapeViewBox
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
                />
                <Bar
                  dataKey="selfConsumptionViaBattery"
                  stackId="a"
                  fill="var(--color-selfConsumptionViaBattery)"
                  name="Tirage batterie"
                />
                {isDaily && (
                  <Bar
                    dataKey="injectionBattery"
                    stackId="a"
                    fill="var(--color-injectionBattery)"
                    name="Injection batterie"
                  />
                )}
                <Bar
                  dataKey="gridDraw"
                  stackId="a"
                  fill="var(--color-gridDraw)"
                  name="Tirage réseau"
                />
                <Bar
                  dataKey="excess"
                  stackId="a"
                  fill="var(--color-excess)"
                  name="Injection réseau"
                />
              </>
            ) : (
              <>
                <Bar
                  dataKey="selfConsumption"
                  stackId="a"
                  fill="var(--color-selfConsumption)"
                  name="Autoconsommation"
                />
                <Bar
                  dataKey="gridDraw"
                  stackId="a"
                  fill="var(--color-gridDraw)"
                  name="Tirage réseau"
                />
                <Bar
                  dataKey="excess"
                  stackId="a"
                  fill="var(--color-excess)"
                  name="Injection réseau"
                />
              </>
            )
          ) : (
            <Bar
              dataKey="production"
              stackId="a"
              fill="var(--color-production)"
              name="Production"
            />
          )}
        </BarChart>
      </ChartContainer>
      {isDaily && onSelectedMonthIndexChange && (
        <div className="flex items-center justify-center mt-2 shrink-0">
          <div className="flex items-center gap-2 max-w-full">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">Mois</span>
            {/* Rotation slider : piste sombre, sticks (mois sélectionné = plus large + rouge), pas de round vert */}
            <div className="relative flex-1 min-w-[180px] max-w-[280px] rounded-xl bg-gray-200/80 dark:bg-gray-700/50 px-3 py-3">
            {/* Sticks : alternance grand/petit, sélectionné = large + rouge, centrés (vertical + horizontal) */}
            <div className="absolute inset-0 flex items-center justify-center px-3 pointer-events-none" aria-hidden>
              <div className="flex w-full items-center justify-center">
                {Array.from({ length: 12 }, (_, i) => {
                  const isMajor = i % 3 === 0;
                  const isSelected = i === selectedMonthIndex;
                  return (
                    <div key={i} className="flex-1 flex justify-center items-center">
                      <div
                        className={cn(
                          "transition-all duration-200",
                          isSelected ? "w-1 bg-red-500 h-3" : "w-px bg-gray-500/70 dark:bg-white/50",
                          !isSelected && (isMajor ? "h-3" : "h-1.5")
                        )}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <Slider
              value={[selectedMonthIndex + 1]}
              onValueChange={([v]) => setSelectedMonthIndex(Math.max(0, Math.min(11, (v ?? 1) - 1)))}
              min={1}
              max={12}
              step={1}
              className="relative z-10 [&_[data-orientation=horizontal]]:flex [&_[data-orientation=horizontal]]:items-center [&_.relative.grow]:!min-h-[12px] [&_.relative.grow]:!overflow-visible [&_.relative.grow]:!bg-transparent [&_.absolute.h-full]:!bg-transparent [&_.block]:!invisible [&_.block]:!h-4 [&_.block]:!w-4 [&_.block]:!rounded-none [&_.block]:!border-0 [&_.block]:!bg-transparent [&_.block]:!ring-0 [&_.block]:!ring-offset-0"
            />
          </div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-8 shrink-0">{monthNames[selectedMonthIndex]}</span>
          </div>
        </div>
      )}
    </div>
  );
}
