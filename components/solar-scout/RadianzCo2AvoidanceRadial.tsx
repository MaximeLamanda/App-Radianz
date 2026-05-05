"use client";

import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { CO2E_GRID_KG_PER_KWH_FR } from "@/lib/co2-avoidance-fr";

const INK = "#0A0A0A";
const LINE = "#E4E2DE";

export interface RadianzCo2AvoidanceRadialProps {
  /** Production annuelle du scénario (kWh). */
  annualProductionKwh: number;
  /** Consommation annuelle de référence (kWh). */
  annualConsumptionKwh: number;
  className?: string;
}

/**
 * Carte Radianz 1:1 — RadialBar type « Green energy » du design system (Recharts),
 * avec pourcentage d’émissions électriques de consommation évitées par la production PV
 * et tonnage CO₂/an indicatif.
 */
export function RadianzCo2AvoidanceRadial({
  annualProductionKwh,
  annualConsumptionKwh,
  className,
}: RadianzCo2AvoidanceRadialProps) {
  const prod = Math.max(0, annualProductionKwh);
  const conso = Math.max(0, annualConsumptionKwh);
  const avoidedKgYear = prod * CO2E_GRID_KG_PER_KWH_FR;
  const baselineKgYear = conso * CO2E_GRID_KG_PER_KWH_FR;

  const pctAvoided =
    baselineKgYear > 0 ? Math.min(100, (avoidedKgYear / baselineKgYear) * 100) : avoidedKgYear > 0 ? 100 : 0;

  const hasData = prod > 0 && (conso > 0 || avoidedKgYear > 0);
  const tonnesStr = (avoidedKgYear / 1000).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  /** Arc à 360° exact : Recharts trace un secteur sans coins arrondis ; on laisse un léger vide pour garder les extrémités arrondies. */
  const pctForBar = pctAvoided >= 100 ? 99.94 : pctAvoided;
  const chartData = [{ name: "co2", value: Math.round(pctForBar * 10) / 10, fill: INK }];

  return (
    <div
      className={cn(
        "relative flex aspect-square w-full max-w-[min(100%,360px)] flex-col overflow-hidden rounded-[20px] border bg-card p-6 text-[#0A0A0A] shadow-none",
        className
      )}
      style={{ borderColor: "#E4E2DE" }}
    >
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.1em] text-[#6B6B6B]">
        <span className="font-medium text-[#0A0A0A]">Économie CO₂</span>
        <span className="shrink-0 text-right">Énergie verte</span>
      </div>

      <div className="mt-2 flex min-h-[200px] flex-1 flex-col justify-center">
        {hasData ? (
          <div
            className="mx-auto h-[200px] w-full max-w-[280px]"
            role="img"
            aria-label={`Environ ${Math.round(pctAvoided)} pour cent des émissions liées à la consommation électrique annuelle évitées, soit environ ${tonnesStr} tonnes de CO₂ par an, hypothèse ~52 g CO₂ par kWh.`}
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
                <text
                  x="50%"
                  y="50%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={INK}
                  className="font-sans text-[clamp(1.75rem,6vw,2.25rem)] font-light tracking-[-0.02em]"
                >
                  {Math.round(pctAvoided)}%
                </text>
              </RadialBarChart>
            </ResponsiveContainer>
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
          <span className="text-[#0A0A0A]">{tonnesStr} t</span>
          <span className="block normal-case">CO₂ évités / an · ~52 g/kWh</span>
        </div>
      ) : null}
    </div>
  );
}
