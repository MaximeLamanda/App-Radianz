"use client";

import { Line, LineChart, CartesianGrid, XAxis, YAxis, Legend } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import {
  DEFAULT_ANNUAL_ELECTRICITY_PRICE_ESCALATION,
  projectedAnnualGridBillEur,
} from "@/lib/solar-settings";
import { radianzCartesianGridProps } from "@/lib/radianz-chart-recharts";

const chartConfig = {
  fullBill: {
    label: "Sans solaire (conso réseau)",
    color: "var(--chart-3)",
  },
  gridBill: {
    label: "Avec projet (tirage réseau)",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

function formatScaledTicks(value: number, unit: "k" | "M") {
  if (!Number.isFinite(value)) return "";
  if (unit === "M") {
    const v = value / 1_000_000;
    const abs = Math.abs(v);
    const maximumFractionDigits = abs >= 10 ? 0 : 1;
    return `${v.toLocaleString("fr-FR", { maximumFractionDigits })}M`;
  }
  return `${Math.round(value / 1_000)}k`;
}

function buildNiceTicks(min: number, max: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { domain: ["auto", "auto"] as const, ticks: undefined as number[] | undefined };
  }
  if (min === max) {
    const pad = Math.max(1000, Math.abs(max) * 0.1);
    return { domain: [min - pad, max + pad] as const, ticks: undefined as number[] | undefined };
  }
  const range = max - min;
  const step = range <= 50_000 ? 5000 : range <= 150_000 ? 25_000 : 50_000;
  const domainMin = Math.floor(min / step) * step;
  const domainMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = domainMin; v <= domainMax + step / 2; v += step) ticks.push(v);
  return { domain: [domainMin, domainMax] as const, ticks };
}

export type ElectricityTariffEscalationChartProps = {
  annualConsumptionKwh: number;
  annualGridDrawKwh: number;
  retailPriceYear0: number;
  escalationAnnual?: number;
  years?: number;
};

export function ElectricityTariffEscalationChart({
  annualConsumptionKwh,
  annualGridDrawKwh,
  retailPriceYear0,
  escalationAnnual = DEFAULT_ANNUAL_ELECTRICITY_PRICE_ESCALATION,
  years = 25,
}: ElectricityTariffEscalationChartProps) {
  const safeYears = Math.max(1, Math.min(60, Math.floor(years)));
  const g = Number.isFinite(escalationAnnual) ? escalationAnnual : 0;
  const conso = Math.max(0, annualConsumptionKwh);
  const grid = Math.max(0, annualGridDrawKwh);

  const data = [];
  for (let y = 0; y <= safeYears; y++) {
    data.push({
      year: y,
      fullBill: projectedAnnualGridBillEur(conso, retailPriceYear0, g, y),
      gridBill: projectedAnnualGridBillEur(grid, retailPriceYear0, g, y),
    });
  }

  const maxVal = data.reduce((m, d) => Math.max(m, d.fullBill, d.gridBill), 0);
  const tickUnit: "k" | "M" = maxVal >= 1_000_000 ? "M" : "k";
  const yAxis = buildNiceTicks(0, maxVal > 0 ? maxVal * 1.08 : 10_000);

  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-full min-h-0 w-full min-w-0 [&_.recharts-cartesian-axis-tick_text]:font-mono [&_.recharts-cartesian-axis-tick_text]:text-[8px] [&_.recharts-cartesian-axis-tick-value]:text-[8px] [&_.recharts-cartesian-axis-tick_text]:tracking-wide [&_.recharts-legend-item-text]:text-[10px] [&_.recharts-legend-item-text]:tabular-nums [&_.recharts-legend-item-text]:text-muted-foreground"
    >
      <LineChart data={data} margin={{ top: 8, right: 10, left: 10, bottom: 0 }}>
        <CartesianGrid {...radianzCartesianGridProps} />
        <XAxis
          dataKey="year"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          interval={2}
          tickFormatter={(v) => `${v}`}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          width={46}
          domain={yAxis.domain as unknown as [number | "auto", number | "auto"]}
          ticks={yAxis.ticks}
          tickFormatter={(v) => formatScaledTicks(Number(v), tickUnit)}
        />
        <ChartTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0]?.payload as { year: number; fullBill: number; gridBill: number } | undefined;
            if (!row) return null;
            const gap = row.fullBill - row.gridBill;
            return (
              <div className="rounded-[12px] border border-border bg-card px-2.5 py-1.5 text-xs shadow-xs">
                <div className="font-medium mb-1">Année {row.year}</div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Sans solaire</span>
                    <span className="font-mono tabular-nums">{Math.round(row.fullBill).toLocaleString("fr-FR")} €</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Avec projet</span>
                    <span className="font-mono tabular-nums">{Math.round(row.gridBill).toLocaleString("fr-FR")} €</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-0.5 border-t border-border/50">
                    <span className="text-muted-foreground">Écart</span>
                    <span className="font-mono tabular-nums font-medium">{Math.round(gap).toLocaleString("fr-FR")} €</span>
                  </div>
                </div>
              </div>
            );
          }}
        />
        <Legend verticalAlign="top" height={28} />
        <Line
          type="monotone"
          dataKey="fullBill"
          name="Sans solaire (conso réseau)"
          stroke="var(--color-fullBill)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="gridBill"
          name="Avec projet (tirage réseau)"
          stroke="var(--color-gridBill)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
