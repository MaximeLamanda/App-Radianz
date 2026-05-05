"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BRAND_MUTED } from "@/lib/brand-colors";
import {
  RadianzLimeDotOverlay,
  radianzCardBorderStyle,
  radianzDefaultCardClass,
  radianzLimeCardRootClass,
  radianzLimeCardStyle,
  radianzMonoLabelClass,
} from "@/lib/radianz-card-primitives";
import { getEnergyConsumption } from "@/lib/building-energy-consumption";
import type { DiscoveryDrawerFinancialSummary } from "@/lib/discovery-drawer-financial-summary";
import { estimateEnergyBillEur } from "@/lib/solar-settings";

type Props = {
  summary: DiscoveryDrawerFinancialSummary;
  surfaceM2: number;
};

/**
 * Bloc « projet » sous le graphe PV (onglet Solaire Discovery).
 * Style aligné sur le design system Radianz (mono labels, radius 12px, lime accent, bordures fines).
 */
export function DiscoverySolaireProjectCards({ summary, surfaceM2 }: Props) {
  const placeType = "other";
  const totalConsumptionKwh = getEnergyConsumption(placeType) * surfaceM2;
  const energyBillEur = estimateEnergyBillEur(totalConsumptionKwh);
  const { priceRange, annualSavings, breakEvenMin, breakEvenMax } = summary;

  const breakEvenLabel =
    breakEvenMin != null && breakEvenMax != null
      ? breakEvenMin === breakEvenMax
        ? `${breakEvenMin} an${breakEvenMin > 1 ? "s" : ""}`
        : `${breakEvenMin} – ${breakEvenMax} ans`
      : "—";

  const priceKMin = (priceRange.totalMinEur / 1000).toFixed(0);
  const priceKMax = (priceRange.totalMaxEur / 1000).toFixed(0);

  return (
    <div className="grid grid-cols-1 gap-3">
      <Card className={cn(radianzLimeCardRootClass, "shadow-none")} style={radianzLimeCardStyle}>
        <RadianzLimeDotOverlay />
        <CardHeader className="relative space-y-1 pb-2 pt-5">
          <div className={cn(radianzMonoLabelClass, "flex justify-between gap-2")}>
            <span>Installation</span>
            <span className="font-normal opacity-70">TTC est.</span>
          </div>
        </CardHeader>
        <CardContent className="relative pb-5 pt-0">
          <p className="font-sans text-3xl font-light tabular-nums tracking-tight sm:text-[2rem] sm:leading-none">
            {priceKMin}
            <span className="mx-1 font-light text-lg text-foreground/50">–</span>
            {priceKMax}
            <sup className="ml-0.5 align-top text-base font-normal">k€</sup>
          </p>
          <p className="mt-2 font-mono text-[10px] leading-snug" style={{ color: BRAND_MUTED }}>
            Fourchette totale (équipement + BOS + MO), paramètres actuels.
          </p>
        </CardContent>
      </Card>

      <Card
        className={cn("flex flex-col justify-between", radianzDefaultCardClass)}
        style={radianzCardBorderStyle}
      >
        <CardHeader className="space-y-1 pb-2 pt-5">
          <div className={cn(radianzMonoLabelClass, "flex justify-between gap-2")}>
            <span>Retour</span>
            <span className="text-foreground/80">B-E</span>
          </div>
        </CardHeader>
        <CardContent className="pb-5 pt-0">
          <p className="font-sans text-2xl font-light tabular-nums tracking-tight text-foreground">{breakEvenLabel}</p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            Amortissement indicatif
          </p>
        </CardContent>
      </Card>

      <Card
        className={cn("flex flex-col justify-between", radianzDefaultCardClass)}
        style={radianzCardBorderStyle}
      >
        <CardHeader className="space-y-1 pb-2 pt-5">
          <div className={cn(radianzMonoLabelClass, "flex justify-between gap-2")}>
            <span>Économies</span>
            <span className="text-foreground/80">/ an</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-5 pt-0">
          <p className="font-sans text-2xl font-light tabular-nums tracking-tight text-foreground">
            {annualSavings.toLocaleString("fr-FR")} €
          </p>
          <div className="border-t border-border/60 pt-2.5 font-mono text-[10px] text-muted-foreground">
            <div className="flex justify-between gap-2">
              <span className="uppercase tracking-[0.06em]">Facture énergie (ref.)</span>
              <span className="tabular-nums text-foreground/80">
                {energyBillEur.toLocaleString("fr-FR")} €
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
