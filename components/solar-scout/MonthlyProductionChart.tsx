"use client";

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

interface MonthlyProductionChartProps {
  data: Array<MonthlyProductionChartDatum>;
}

const monthNames = [
  "Jan", "Fév", "Mar", "Avr", "Mai", "Jun",
  "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"
];

const chartConfig = {
  production: {
    label: "Production (kWh)",
    color: "hsl(142, 76%, 36%)",
  },
  gridDraw: {
    label: "Tirage réseau (kWh)",
    color: "hsl(0, 0%, 50%)",
  },
  consumption: {
    label: "Consommation (kWh)",
    color: "hsl(38, 92%, 50%)",
  },
} satisfies ChartConfig;

export function MonthlyProductionChart({ data }: MonthlyProductionChartProps) {
  const hasConsumption = data.some((d) => typeof d.consumption === "number");

  const chartData = data.map((item) => {
    const prod = item.production;
    const cons = item.consumption ?? 0;
    const gridDraw = hasConsumption ? Math.max(0, cons - prod) : 0;
    return {
      month: monthNames[item.month - 1] || `M${item.month}`,
      production: prod,
      gridDraw,
      consumption: cons,
    };
  });

  return (
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
        />
        <ChartTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload;
            return (
              <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                <div className="font-medium mb-1.5">{p.month}</div>
                <div className="flex flex-col gap-1">
                  <span>Production : {p.production} kWh</span>
                  {hasConsumption && (
                    <span>Consommation : {p.consumption} kWh</span>
                  )}
                  {hasConsumption && p.gridDraw > 0 && (
                    <span className="text-muted-foreground">
                      Tirage réseau : {p.gridDraw} kWh
                    </span>
                  )}
                </div>
              </div>
            );
          }}
        />
        <Bar
          dataKey="production"
          stackId="a"
          fill="var(--color-production)"
          name="Production"
        />
        {hasConsumption && (
          <Bar
            dataKey="gridDraw"
            stackId="a"
            fill="var(--color-gridDraw)"
            name="Tirage réseau"
          />
        )}
      </BarChart>
    </ChartContainer>
  );
}
