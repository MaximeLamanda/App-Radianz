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
import {
  annualEnergySavingsEurAtYear,
  DEFAULT_ANNUAL_ELECTRICITY_PRICE_ESCALATION,
  DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH,
} from "@/lib/solar-settings";
import { radianzCartesianGridProps } from "@/lib/radianz-chart-recharts";

export type RoiFinancingMode = "capex" | "lease" | "ppa";

type RoiComboDatum = {
  year: number;
  netEur: number;
  capexEur: number;
  annualSavingsEur: number;
};

const chartConfig = {
  net: {
    label: "Cashflow net (€)",
    color: "var(--chart-1)",
  },
  capex: {
    label: "CAPEX",
    color: "var(--chart-3)",
  },
  savings: {
    label: "Économies / an",
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

    chosenStep = step;
    chosenDomain = [domainMin, domainMax];
  }

  if (!chosenTicks) {
    const [domainMin, domainMax] = chosenDomain;
    const ticks: number[] = [];
    for (let v = domainMin; v <= domainMax + chosenStep / 2; v += chosenStep) ticks.push(v);
    chosenTicks = ticks;
  }

  return { domain: chosenDomain, ticks: chosenTicks };
}

function annualOperationalNetEur(
  grossEnergySavings: number,
  financingMode: RoiFinancingMode,
  referenceCapexForLeaseEur: number
): number {
  if (financingMode === "lease") {
    const leaseAnnual = referenceCapexForLeaseEur / 15;
    return grossEnergySavings - leaseAnnual;
  }
  if (financingMode === "ppa") {
    return grossEnergySavings * 0.7;
  }
  return grossEnergySavings;
}

export type RoiComboChartParams = {
  capexEur: number;
  years?: number;
  escalationAnnual?: number;
  retailPriceYear0: number;
  feedInPriceYear0?: number;
  selfConsumptionKwh: number;
  excessInjectionKwh: number;
  financingMode: RoiFinancingMode;
  referenceCapexForLeaseEur: number;
};

/** Cumul net après `years` (aligné sur le graphique ROI indexé). */
export function getRoiCumulativeNetEurAfterHorizon(params: RoiComboChartParams): number {
  const { data } = buildRoiComboData(params);
  const last = data[data.length - 1];
  return last ? last.netEur : 0;
}

function buildRoiComboData(params: RoiComboChartParams): { data: RoiComboDatum[] } {
  const {
    capexEur,
    years = 25,
    escalationAnnual = DEFAULT_ANNUAL_ELECTRICITY_PRICE_ESCALATION,
    retailPriceYear0,
    feedInPriceYear0 = DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH,
    selfConsumptionKwh,
    excessInjectionKwh,
    financingMode,
    referenceCapexForLeaseEur,
  } = params;

  const safeYears = Math.max(1, Math.min(60, Math.floor(years)));
  const capex = Number.isFinite(capexEur) ? capexEur : 0;
  const g = Number.isFinite(escalationAnnual) ? escalationAnnual : 0;
  const p0 = Number.isFinite(retailPriceYear0) ? retailPriceYear0 : 0;
  const f0 = Number.isFinite(feedInPriceYear0) ? feedInPriceYear0 : DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH;
  const selfKwh = Number.isFinite(selfConsumptionKwh) ? Math.max(0, selfConsumptionKwh) : 0;
  const excessKwh = Number.isFinite(excessInjectionKwh) ? Math.max(0, excessInjectionKwh) : 0;
  const leaseRef = Number.isFinite(referenceCapexForLeaseEur) ? referenceCapexForLeaseEur : 0;

  const data: RoiComboDatum[] = [];
  let net = -capex;
  data.push({ year: 0, netEur: net, capexEur: -capex, annualSavingsEur: 0 });

  for (let year = 1; year <= safeYears; year++) {
    const gross = annualEnergySavingsEurAtYear(selfKwh, excessKwh, p0, f0, g, year);
    const annualNet = annualOperationalNetEur(gross, financingMode, leaseRef);
    net += annualNet;
    data.push({ year, netEur: net, capexEur: 0, annualSavingsEur: annualNet });
  }

  return { data };
}

export function RoiComboChart({
  capexEur,
  years = 25,
  escalationAnnual = DEFAULT_ANNUAL_ELECTRICITY_PRICE_ESCALATION,
  retailPriceYear0,
  feedInPriceYear0 = DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH,
  selfConsumptionKwh,
  excessInjectionKwh,
  financingMode,
  referenceCapexForLeaseEur,
}: RoiComboChartParams) {
  const { data } = buildRoiComboData({
    capexEur,
    years,
    escalationAnnual,
    retailPriceYear0,
    feedInPriceYear0,
    selfConsumptionKwh,
    excessInjectionKwh,
    financingMode,
    referenceCapexForLeaseEur,
  });

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
      className="aspect-auto h-full min-h-0 w-full min-w-0 [&_.recharts-cartesian-axis-tick_text]:font-mono [&_.recharts-cartesian-axis-tick_text]:text-[8px] [&_.recharts-cartesian-axis-tick-value]:text-[8px] [&_.recharts-cartesian-axis-tick_text]:tracking-wide [&_.recharts-default-legend]:text-[10px] [&_.recharts-legend-item-text]:text-[10px] [&_.recharts-legend-item-text]:tabular-nums [&_.recharts-legend-item-text]:text-muted-foreground"
    >
      <ComposedChart data={data} margin={{ top: 8, right: 10, left: 10, bottom: 0 }}>
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
          domain={y.domain as unknown as [number | "auto", number | "auto"]}
          ticks={y.ticks}
          tickFormatter={(v) => formatScaledTicks(Number(v), tickUnit)}
        />
        <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="2 4" />
        <ChartTooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]?.payload as RoiComboDatum | undefined;
            if (!p) return null;
            return (
              <div className="rounded-[12px] border border-border bg-card px-2.5 py-1.5 text-xs shadow-xs">
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
                      <span className="text-muted-foreground">Économies nettes (an)</span>
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
        <Bar dataKey="netEur" name="net" radius={[2, 2, 0, 0]}>
          {data.map((d) => (
            <Cell
              key={d.year}
              fill={d.netEur < 0 ? "var(--chart-5)" : "var(--chart-1)"}
            />
          ))}
        </Bar>
      </ComposedChart>
    </ChartContainer>
  );
}
