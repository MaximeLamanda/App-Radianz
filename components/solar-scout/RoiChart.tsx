"use client";

import {
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceLine,
  Bar,
  Cell,
} from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";

type RoiComboDatum = {
  year: number;
  netEur: number; // cumul (prend l'année précédente en compte)
  capexEur: number; // affichage tooltip (année 0)
  annualSavingsEur: number; // affichage tooltip (année >= 1)
};

const chartConfig = {
  net: {
    label: "Cashflow net (€)",
    color: "#0000FF",
  },
  capex: {
    label: "CAPEX",
    color: "#6b7280",
  },
  savings: {
    label: "Savings / an",
    color: "#0000FF",
  },
} satisfies ChartConfig;

function formatCompactEur(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M€`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)} k€`;
  return `${Math.round(value)} €`;
}

function formatScaledTicks(value: number, unit: "k" | "M") {
  if (!Number.isFinite(value)) return "";

  if (unit === "M") {
    const v = value / 1_000_000;
    const abs = Math.abs(v);
    const maximumFractionDigits = abs >= 10 ? 0 : 1;
    return `${v.toLocaleString("fr-FR", { maximumFractionDigits })}M`;
  }

  // "k" par défaut
  return `${Math.round(value / 1_000)}k`;
}

function buildNiceTicks(min: number, max: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { domain: ["auto", "auto"] as const, ticks: undefined as number[] | undefined };
  }

  if (min === max) {
    const pad = Math.max(10_000, Math.abs(max) * 0.1);
    const domainMin = min - pad;
    const domainMax = max + pad;
    return { domain: [domainMin, domainMax] as const, ticks: undefined as number[] | undefined };
  }

  const candidates =
    Math.max(Math.abs(min), Math.abs(max)) >= 1_000_000
      ? [250_000, 500_000, 750_000, 1_000_000, 1_500_000, 2_000_000]
      : [50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 450_000];

  let chosenStep = candidates[candidates.length - 1]!;
  let chosenDomain: [number, number] = [min, max];
  let chosenTicks: number[] | undefined;

  for (const step of candidates) {
    const domainMin = Math.floor(min / step) * step;
    const domainMax = Math.ceil(max / step) * step;
    const count = Math.round((domainMax - domainMin) / step) + 1;

    if (count >= 4 && count <= 7) {
      const ticks: number[] = [];
      for (let v = domainMin; v <= domainMax + step / 2; v += step) ticks.push(v);
      chosenStep = step;
      chosenDomain = [domainMin, domainMax];
      chosenTicks = ticks;
      break;
    }

    // fallback "moins pire" si on n'a rien trouvé: on garde le dernier calculé
    chosenStep = step;
    chosenDomain = [domainMin, domainMax];
  }

  if (!chosenTicks) {
    const [domainMin, domainMax] = chosenDomain;
    const ticks: number[] = [];
    for (let v = domainMin; v <= domainMax + chosenStep / 2; v += chosenStep) ticks.push(v);
    chosenTicks = ticks;
  }

  return { domain: chosenDomain as const, ticks: chosenTicks };
}

export function RoiComboChart({
  capexEur,
  annualSavingsEur,
  years = 25,
}: {
  capexEur: number;
  annualSavingsEur: number;
  years?: number;
}) {
  const safeYears = Math.max(1, Math.min(60, Math.floor(years)));
  const capex = Number.isFinite(capexEur) ? capexEur : 0;
  const savings = Number.isFinite(annualSavingsEur) ? annualSavingsEur : 0;

  const data: RoiComboDatum[] = [];
  let net = -capex; // point de départ: investissement (négatif)
  data.push({ year: 0, netEur: net, capexEur: -capex, annualSavingsEur: 0 });
  for (let year = 1; year <= safeYears; year++) {
    net += savings;
    data.push({ year, netEur: net, capexEur: 0, annualSavingsEur: savings });
  }

  const { minNet, maxNet, maxAbsNet } = data.reduce(
    (acc, d) => {
      const v = d.netEur;
      acc.minNet = Math.min(acc.minNet, v);
      acc.maxNet = Math.max(acc.maxNet, v);
      acc.maxAbsNet = Math.max(acc.maxAbsNet, Math.abs(v));
      return acc;
    },
    { minNet: 0, maxNet: 0, maxAbsNet: 0 }
  );
  const tickUnit: "k" | "M" = maxAbsNet >= 1_000_000 ? "M" : "k";
  const y = buildNiceTicks(minNet, maxNet);

  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-full min-h-0 w-full min-w-0 [&_.recharts-cartesian-axis-tick_text]:text-[8px] [&_.recharts-cartesian-axis-tick-value]:text-[8px] [&_.recharts-default-legend]:text-[10px] [&_.recharts-default-legend]:font-sans [&_.recharts-legend-item-text]:text-[10px] [&_.recharts-legend-item-text]:font-sans [&_.recharts-legend-item-text]:tabular-nums [&_.recharts-legend-item-text]:text-zinc-700"
    >
      <ComposedChart data={data} margin={{ top: 8, right: 10, left: 10, bottom: 0 }}>
        <CartesianGrid vertical={false} />
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
          domain={y.domain as unknown as [number | "auto", number | "auto"]}
          ticks={y.ticks}
          tickFormatter={(v) => formatScaledTicks(Number(v), tickUnit)}
        />
        <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="4 4" />
        <ChartTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]?.payload as RoiComboDatum | undefined;
            if (!p) return null;
            return (
              <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                <div className="font-medium mb-1">Année {p.year}</div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Cumul net</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {Math.round(p.netEur).toLocaleString("fr-FR")} €
                    </span>
                  </div>
                  {p.year >= 1 ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">Savings (an)</span>
                      <span className="font-mono tabular-nums text-foreground">
                        {Math.round(p.annualSavingsEur).toLocaleString("fr-FR")} €
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">CAPEX</span>
                      <span className="font-mono tabular-nums text-foreground">
                        {Math.round(p.capexEur).toLocaleString("fr-FR")} €
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          }}
        />
        <Bar
          dataKey="netEur"
          name="net"
          radius={0}
        >
          {data.map((d) => (
            <Cell
              key={d.year}
              fill={
                d.year === 0
                  ? "var(--color-capex)"
                  : d.netEur < 0
                    ? "hsl(240 6% 90%)"
                    : "var(--color-savings)"
              }
            />
          ))}
        </Bar>
      </ComposedChart>
    </ChartContainer>
  );
}

