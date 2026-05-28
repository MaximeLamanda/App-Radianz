"use client";

import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { computeCo2AvoidanceMetricsFr } from "@/lib/co2-avoidance-fr";

const INK = "#0A0A0A";
const LINE = "#E4E2DE";

export interface RadianzCo2AvoidanceRadialProps {
  /** Consommation annuelle de référence (kWh) — émissions calculées au mix réseau FR classique. */
  annualConsumptionKwh: number;
  /** Autoconsommation annuelle (directe + batterie, kWh) — comptée comme énergie verte. */
  annualSelfConsumptionKwh: number;
  className?: string;
}

/**
 * Carte Radianz — % d’émissions « réseau » de la consommation évitées par l’autoconsommation PV
 * et tonnage CO₂/an indicatif (hypothèse ~52 g CO₂e/kWh réseau FR).
 */
export function RadianzCo2AvoidanceRadial({
  annualConsumptionKwh,
  annualSelfConsumptionKwh,
  className,
}: RadianzCo2AvoidanceRadialProps) {
  const { avoidedKgYear, pctReduction, hasData } = computeCo2AvoidanceMetricsFr(
    annualConsumptionKwh,
    annualSelfConsumptionKwh
  );

  const tonnesStr = (avoidedKgYear / 1000).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  /** Arc à 360° exact : Recharts trace un secteur sans coins arrondis ; on laisse un léger vide pour garder les extrémités arrondies. */
  const pctForBar = pctReduction >= 100 ? 99.94 : pctReduction;
  const chartData = [{ name: "co2", value: Math.round(pctForBar * 10) / 10, fill: INK }];

  return (
    <div
      className={cn(
        "relative flex w-full min-w-0 flex-col overflow-hidden rounded-[20px] border bg-card p-6 text-[#0A0A0A] shadow-none",
        className
      )}
      style={{ borderColor: "#E4E2DE" }}
    >
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.1em] text-[#6B6B6B]">
        <span className="font-medium text-[#0A0A0A]">Économie CO₂</span>
        <span className="shrink-0 text-right">Énergie verte</span>
      </div>

      <div className="mt-2 flex min-h-[200px] flex-col justify-center">
        {hasData ? (
          <div
            className="relative h-[200px] w-full"
            role="img"
            aria-label={`Environ ${tonnesStr} tonnes de CO₂ évitées par an grâce à l'autoconsommation, soit environ ${Math.round(pctReduction)} pour cent des émissions liées à une consommation entièrement réseau, hypothèse réseau français classique environ 52 grammes de CO₂ par kilowattheure.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                data={chartData}
                startAngle={90}
                endAngle={-270}
                innerRadius="70%"
                outerRadius="100%"
                barSize={14}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
                <RadialBar
                  dataKey="value"
                  cornerRadius={7}
                  forceCornerRadius
                  background={{ fill: LINE }}
                  isAnimationActive={false}
                />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <p className="font-sans text-[clamp(1.5rem,5.5vw,2rem)] font-light leading-none tracking-[-0.02em] text-[#0A0A0A]">
                {tonnesStr} t
              </p>
              <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#6B6B6B]">
                CO₂ évités
              </p>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[160px] flex-col items-center justify-center text-center">
            <div className="font-sans text-[clamp(1.75rem,6vw,2.25rem)] font-light tracking-[-0.02em]">—</div>
            <p className="mt-2 max-w-[220px] font-mono text-[11px] uppercase leading-snug tracking-[0.08em] text-[#6B6B6B]">
              Données insuffisantes pour estimer le CO₂ évité
            </p>
          </div>
        )}
      </div>

      {hasData ? (
        <div className="mt-auto border-t pt-3 text-center font-mono text-[10px] uppercase leading-relaxed tracking-[0.08em] text-[#6B6B6B]">
          <span className="text-[#0A0A0A]">{Math.round(pctReduction)} %</span>
          <span className="normal-case"> d&apos;énergie verte autoconsommée</span>
        </div>
      ) : null}
    </div>
  );
}
