"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";

export interface MonthlyProductionChartDatum {
  month: number;
  production: number;
  consumption?: number;
}

export interface DailyProductionChartDatum {
  hour: number;
  production: number;
  consumption?: number;
}

interface MonthlyProductionChartProps {
  data: Array<MonthlyProductionChartDatum>;
  /** Données horaires (24h) pour le mode Journalier. */
  dailyData?: Array<DailyProductionChartDatum>;
  /** Mode d'affichage (contrôlé par le parent, ex. switch à côté du titre). */
  viewMode?: "monthly" | "daily";
  /** Callback quand le mode change (si le switch est dans le parent). */
  onViewModeChange?: (mode: "monthly" | "daily") => void;
}

const monthNames = [
  "Jan", "Fév", "Mar", "Avr", "Mai", "Jun",
  "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"
];

const chartConfig = {
  selfConsumption: {
    label: "Autoconsommation (kWh)",
    color: "hsl(217, 91%, 60%)", // Bleu principal (blue-500)
  },
  excess: {
    label: "Injection réseau (kWh)",
    color: "hsl(217, 70%, 78%)", // Bleu pâle
  },
  gridDraw: {
    label: "Tirage réseau (kWh)",
    color: "hsl(0, 0%, 50%)",
  },
  production: {
    label: "Production (kWh)",
    color: "hsl(217, 91%, 60%)",
  },
  consumption: {
    label: "Consommation (kWh)",
    color: "hsl(38, 92%, 50%)",
  },
} satisfies ChartConfig;

export function MonthlyProductionChart({ data, dailyData, viewMode: controlledViewMode, onViewModeChange }: MonthlyProductionChartProps) {
  const [internalViewMode, setInternalViewMode] = useState<"monthly" | "daily">("monthly");
  const viewMode = controlledViewMode ?? internalViewMode;
  const setViewMode = onViewModeChange ?? setInternalViewMode;
  const isDaily = viewMode === "daily" && dailyData && dailyData.length === 24;
  const hasConsumption = isDaily
    ? dailyData!.some((d) => typeof d.consumption === "number")
    : data.some((d) => typeof d.consumption === "number");

  const chartData = isDaily
    ? dailyData!.map((item) => {
        const prod = item.production;
        const cons = item.consumption ?? 0;
        const selfConsumption = hasConsumption ? Math.min(prod, cons) : 0;
        const excess = hasConsumption ? Math.max(0, prod - cons) : prod;
        const gridDraw = hasConsumption ? Math.max(0, cons - prod) : 0;
        return {
          month: `${item.hour}h`,
          hour: item.hour,
          production: prod,
          selfConsumption,
          excess,
          gridDraw,
          consumption: cons,
        };
      })
    : data.map((item) => {
        const prod = item.production;
        const cons = item.consumption ?? 0;
        const selfConsumption = hasConsumption ? Math.min(prod, cons) : 0;
        const excess = hasConsumption ? Math.max(0, prod - cons) : prod;
        const gridDraw = hasConsumption ? Math.max(0, cons - prod) : 0;
        return {
          month: monthNames[item.month - 1] || `M${item.month}`,
          production: prod,
          selfConsumption,
          excess,
          gridDraw,
          consumption: cons,
        };
      });

  return (
    <div className="w-full min-w-0">
      <ChartContainer config={chartConfig} className="h-[250px] min-h-[250px] w-full min-w-0 [&_.recharts-cartesian-axis-tick_text]:text-[9px] [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground/70">
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
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return (
                <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                  <div className="font-medium mb-1.5">{isDaily ? `${p.hour}h - ${p.hour + 1}h` : p.month}</div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-[2px]"
                        style={{ backgroundColor: "var(--color-production)" }}
                      />
                      <span>Production : {p.production} kWh</span>
                    </div>
                    {hasConsumption && (
                      <>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2 w-2 rounded-[2px]"
                            style={{ backgroundColor: "var(--color-selfConsumption)" }}
                          />
                          <span>Autoconsommation : {p.selfConsumption} kWh</span>
                        </div>
                        {p.excess > 0 && (
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2 w-2 rounded-[2px]"
                              style={{ backgroundColor: "var(--color-excess)" }}
                            />
                            <span>Injection : {p.excess} kWh</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2 w-2 rounded-[2px]"
                            style={{ backgroundColor: "var(--color-consumption)" }}
                          />
                          <span>Consommation : {p.consumption} kWh</span>
                        </div>
                        {p.gridDraw > 0 && (
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2 w-2 rounded-[2px]"
                              style={{ backgroundColor: "var(--color-gridDraw)" }}
                            />
                            <span>Tirage réseau : {p.gridDraw} kWh</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            }}
          />
          {hasConsumption ? (
            <>
              <Bar
                dataKey="selfConsumption"
                stackId="a"
                fill="var(--color-selfConsumption)"
                name="Autoconsommation"
              />
              <Bar
                dataKey="excess"
                stackId="a"
                fill="var(--color-excess)"
                name="Injection"
              />
              <Bar
                dataKey="gridDraw"
                stackId="a"
                fill="var(--color-gridDraw)"
                name="Tirage réseau"
              />
            </>
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
    </div>
  );
}
