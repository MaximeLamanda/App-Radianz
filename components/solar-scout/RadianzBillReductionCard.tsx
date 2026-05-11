"use client";

import { cn } from "@/lib/utils";

/** Palette alignée sur Radianz Design System (Bill reduction · carte blanche). */
const INK = "#0A0A0A";
/** Accent batterie (cohérent avec le reste de la page prospect / graphiques). */
const BATTERY = "#0000FF";
/** Injection réseau — même teinte que la série `excess` du graphe production (`MonthlyProductionChart` · `ProspectEnergyChartsPanel`). */
const INJECTION_RESEAU = "#6B6B6B";
const LINE_2 = "#D6D4CF";
const CANVAS = "#F0EFED";
export interface RadianzBillReductionSegment {
  id: string;
  label: string;
  /** Montant affiché sur la ligne (€ / mois ou € pour le mois affiché). */
  monthlyReductionEur: number;
  /**
   * Part de la facture de référence évitée par ce poste (0–100 %) :
   * facture annuelle en mode moyenne, facture du mois en mode mois sélectionné.
   */
  pctOfBill: number;
  variant: "direct" | "battery" | "injection";
}

export interface RadianzBillReductionCardProps {
  /** Libellé période (ex. « Mai 2026 », « Moyenne mensuelle ») — style mono uppercase à droite du titre */
  periodLabel: string;
  /** Facture énergétique annuelle estimée (€), avant solaire */
  initialBillAnnualEur: number;
  /** Réduction affichée en grand (€/mois ou € pour le mois ciblé, selon la période) */
  headlineReductionEur: number;
  /** Répartition des économies (ordre affiché : directe, batterie, injection) */
  segments: RadianzBillReductionSegment[];
  className?: string;
}

function segmentBarColor(variant: RadianzBillReductionSegment["variant"]) {
  switch (variant) {
    case "direct":
      return INK;
    case "battery":
      return BATTERY;
    case "injection":
      return INJECTION_RESEAU;
    default:
      return LINE_2;
  }
}

function segmentDotClassName(variant: RadianzBillReductionSegment["variant"]) {
  switch (variant) {
    case "direct":
      return "bg-[#0A0A0A]";
    case "battery":
      return "bg-[#0000FF]";
    case "injection":
      return null;
    default:
      return "bg-[#D6D4CF]";
  }
}

export function RadianzBillReductionCard({
  periodLabel,
  initialBillAnnualEur,
  headlineReductionEur,
  segments,
  className,
}: RadianzBillReductionCardProps) {
  const hasBill = initialBillAnnualEur > 0;
  const monthlySavings = headlineReductionEur;

  /** Largeurs = % de la facture totale (barre pleine = 100 % facture). */
  const barSegments = segments.map((s) => ({
    ...s,
    widthPct: Math.max(0, Math.min(100, s.pctOfBill)),
  }));

  return (
    <div
      className={cn(
        "relative flex w-full min-w-0 flex-col overflow-hidden rounded-[20px] border bg-card p-6 text-[#0A0A0A] shadow-none",
        className
      )}
      style={{ borderColor: "#E4E2DE" }}
    >
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.1em] text-[#6B6B6B]">
        <span className="font-medium text-[#0A0A0A]">Réduction facture</span>
        <span className="shrink-0">{periodLabel}</span>
      </div>

      <div className="mt-[18px]">
        {hasBill && monthlySavings > 0 ? (
          <div className="font-sans text-[clamp(2rem,8vw,3.4rem)] font-light leading-[0.95] tracking-[-0.03em]">
            −{Math.round(monthlySavings)}
            <span className="ml-1.5 align-top font-mono text-sm font-normal tracking-normal text-[#6B6B6B]">
              €/mois
            </span>
          </div>
        ) : (
          <>
            <div className="font-sans text-[clamp(2rem,8vw,3.4rem)] font-light leading-[0.95] tracking-[-0.03em]">
              —
            </div>
            <div className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-[#6B6B6B]">
              Données insuffisantes pour estimer la réduction
            </div>
          </>
        )}
      </div>

      <div className="mt-6">
        <div
          className="flex h-2.5 overflow-hidden rounded-full"
          style={{ background: CANVAS }}
          role="img"
          aria-label="Réduction estimée par rapport à la facture énergétique totale"
        >
          <div className="flex h-full w-full">
            {barSegments.map((s) => (
              <div
                key={s.id}
                className="h-full shrink-0 border-r-2 border-white last:border-r-0"
                style={{
                  width: `${s.widthPct}%`,
                  background: segmentBarColor(s.variant),
                }}
                title={s.label}
              />
            ))}
          </div>
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[9px] uppercase tracking-[0.08em] text-[#6B6B6B]">
          <span>0%</span>
          <span>100% facture</span>
        </div>
      </div>

      <div className="mt-auto flex flex-col">
        {segments.map((s) => {
          return (
            <div
              key={s.id}
              className="grid grid-cols-[14px_1fr_42px_64px] items-center gap-3 border-t py-2.5 font-mono text-xs sm:grid-cols-[14px_1fr_48px_72px]"
              style={{ borderColor: "#E4E2DE" }}
            >
              <span
                className={cn("size-2 shrink-0 rounded-full", segmentDotClassName(s.variant))}
                style={s.variant === "injection" ? { backgroundColor: INJECTION_RESEAU } : undefined}
                aria-hidden
              />
              <span className="min-w-0 text-[#0A0A0A]">{s.label}</span>
              <span className="text-right text-[11px] tabular-nums text-[#6B6B6B]">
                {Math.round(s.pctOfBill)}%
              </span>
              <span className="text-right tabular-nums text-[#0A0A0A]">
                −{Math.round(s.monthlyReductionEur).toLocaleString("fr-FR")}€
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
