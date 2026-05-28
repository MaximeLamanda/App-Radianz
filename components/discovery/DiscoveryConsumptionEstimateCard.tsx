"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MonthlyConsumptionOnlyChart } from "@/components/solar-scout/MonthlyConsumptionOnlyChart";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  radianzCardBorderStyle,
  radianzDefaultCardClass,
  radianzMonoLabelClass,
} from "@/lib/radianz-card-primitives";

const KWH_PER_MWH = 1000;

function formatMwh(kwh: number) {
  return (kwh / KWH_PER_MWH).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function clampKwh(value: number, minKwh: number, maxKwh: number) {
  if (!Number.isFinite(value)) return minKwh;
  return Math.round(Math.max(minKwh, Math.min(maxKwh, value)));
}

function formatMwhInput(kwh: number) {
  const mwh = kwh / KWH_PER_MWH;
  return Number.isFinite(mwh) ? String(Math.round(mwh * 10) / 10) : "";
}

export interface DiscoveryConsumptionEstimateCardProps {
  baselineAnnualKwh: number;
  targetAnnualKwh: number;
  monthlyConsumptionKwh: number[];
  onTargetAnnualKwhChange: (kwh: number) => void;
  className?: string;
}

export function DiscoveryConsumptionEstimateCard({
  baselineAnnualKwh,
  targetAnnualKwh,
  monthlyConsumptionKwh,
  onTargetAnnualKwhChange,
  className,
}: DiscoveryConsumptionEstimateCardProps) {
  const sliderBounds = useMemo(() => {
    const baseline = Math.max(0, Math.round(baselineAnnualKwh));
    return {
      min: 0,
      max: Math.max(baseline > 0 ? baseline : 1, Math.round(baseline * 2)),
    };
  }, [baselineAnnualKwh]);

  const showBaselineHint =
    Math.round(targetAnnualKwh) !== Math.round(baselineAnnualKwh) && baselineAnnualKwh > 0;

  const lastEmittedKwhRef = useRef(Math.round(targetAnnualKwh));
  const [mwhInputFocused, setMwhInputFocused] = useState(false);
  const [mwhInputDraft, setMwhInputDraft] = useState("");

  useEffect(() => {
    lastEmittedKwhRef.current = Math.round(targetAnnualKwh);
  }, [targetAnnualKwh]);

  const emitTargetKwh = useCallback(
    (kwh: number) => {
      const next = clampKwh(kwh, sliderBounds.min, sliderBounds.max);
      if (next === lastEmittedKwhRef.current) return;
      lastEmittedKwhRef.current = next;
      onTargetAnnualKwhChange(next);
    },
    [onTargetAnnualKwhChange, sliderBounds.min, sliderBounds.max]
  );

  const commitMwhInput = useCallback(
    (raw: string) => {
      const normalized = raw.trim().replace(",", ".");
      if (normalized.length === 0) {
        emitTargetKwh(0);
        return;
      }
      const parsed = parseFloat(normalized);
      if (Number.isFinite(parsed) && parsed >= 0) {
        emitTargetKwh(parsed * KWH_PER_MWH);
      }
    },
    [emitTargetKwh]
  );

  const mwhInputDisplay = mwhInputFocused ? mwhInputDraft : formatMwhInput(targetAnnualKwh);

  if (baselineAnnualKwh <= 0) return null;

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-[12px] border p-4 shadow-xs",
        radianzDefaultCardClass,
        className
      )}
      style={radianzCardBorderStyle}
      aria-labelledby="discovery-consumption-estimate-title"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3
            id="discovery-consumption-estimate-title"
            className="text-sm font-semibold text-foreground"
          >
            Consommation estimée
          </h3>
          {showBaselineHint ? (
            <p className={cn(radianzMonoLabelClass, "text-muted-foreground")}>
              Estimation surface : {formatMwh(baselineAnnualKwh)} MWh/an
            </p>
          ) : (
            <p className={cn(radianzMonoLabelClass, "text-muted-foreground")}>
              Basée sur l&apos;empreinte et le type de bâtiment
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => emitTargetKwh(baselineAnnualKwh)}
          disabled={!showBaselineHint}
          className={cn(
            "text-xs font-medium underline-offset-4 shrink-0",
            showBaselineHint
              ? "text-muted-foreground hover:text-foreground hover:underline"
              : "text-muted-foreground/50 cursor-default"
          )}
        >
          Réinitialiser
        </button>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <Slider
          variant="slider04"
          min={sliderBounds.min}
          max={sliderBounds.max}
          step={Math.max(1, Math.round(sliderBounds.max / 200))}
          value={[Math.max(sliderBounds.min, targetAnnualKwh)]}
          onValueChange={(v) => emitTargetKwh(v[0] ?? 0)}
          aria-label="Consommation annuelle estimée"
          className="w-full"
        />
        <div className="flex items-center gap-2">
          <Input
            type="text"
            inputMode="decimal"
            aria-label="Consommation en MWh par an"
            className="h-8 w-24 font-mono text-sm tabular-nums"
            value={mwhInputDisplay}
            onFocus={() => {
              setMwhInputFocused(true);
              setMwhInputDraft(formatMwhInput(targetAnnualKwh));
            }}
            onBlur={(e) => {
              setMwhInputFocused(false);
              commitMwhInput(e.target.value);
            }}
            onChange={(e) => {
              setMwhInputDraft(e.target.value);
              const normalized = e.target.value.trim().replace(",", ".");
              if (normalized === "" || normalized === "0" || normalized === "0.") {
                if (normalized === "0") emitTargetKwh(0);
                return;
              }
              const parsed = parseFloat(normalized);
              if (Number.isFinite(parsed) && parsed >= 0) {
                emitTargetKwh(parsed * KWH_PER_MWH);
              }
            }}
          />
          <span className="text-xs text-muted-foreground">MWh/an</span>
        </div>
      </div>

      <MonthlyConsumptionOnlyChart
        monthlyKwh={monthlyConsumptionKwh}
        unitMode="mwh"
        className="min-h-[200px]"
      />
    </section>
  );
}
