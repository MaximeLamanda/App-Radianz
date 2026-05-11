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
import type { DiscoveryDrawerFinancialSummary } from "@/lib/discovery-drawer-financial-summary";

type Props = {
  summary: DiscoveryDrawerFinancialSummary;
};

/**
 * Bloc « projet » sous le graphe PV (onglet Solaire Discovery).
 * Style aligné sur le design system Radianz (mono labels, radius 12px, lime accent, bordures fines).
 */
export function DiscoverySolaireProjectCards({ summary }: Props) {
  const { priceRange } = summary;

  const priceKMin = (priceRange.totalMinEur / 1000).toFixed(0);
  const priceKMax = (priceRange.totalMaxEur / 1000).toFixed(0);

  return (
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
  );
}
