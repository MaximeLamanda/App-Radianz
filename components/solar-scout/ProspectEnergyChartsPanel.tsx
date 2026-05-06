"use client";

import { Battery } from "lucide-react";
import { MonthlyProductionChart } from "./MonthlyProductionChart";
import type { DailyProductionChartDatum, MonthlyProductionChartDatum } from "./MonthlyProductionChart";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { radianzCardBorderStyle, radianzDefaultCardClass, radianzMonoLabelClass } from "@/lib/radianz-card-primitives";

const KWH_PER_MWH = 1000;

export interface ProspectEnergyChartsPanelProps {
  annualProductionKwh: number;
  chartViewMode: "monthly" | "daily";
  onChartViewModeChange: (mode: "monthly" | "daily") => void;
  chartSelectedMonthIndex: number;
  onChartSelectedMonthIndexChange: (index: number) => void;
  data: MonthlyProductionChartDatum[];
  dailyData: DailyProductionChartDatum[] | undefined;
  configurationModeKey: string;
  includeBattery?: boolean;
  onIncludeBatteryChange?: (checked: boolean) => void;
}

/**
 * Bloc production (onglets mensuel · journalier + graphique).
 * Partagé entre le drawer prospect, la tab solaire discovery, et la page /p/.
 */
export function ProspectEnergyChartsPanel({
  annualProductionKwh,
  chartViewMode,
  onChartViewModeChange,
  chartSelectedMonthIndex,
  onChartSelectedMonthIndexChange,
  data,
  dailyData,
  configurationModeKey,
  includeBattery,
  onIncludeBatteryChange,
}: ProspectEnergyChartsPanelProps) {
  return (
    <div
      className={cn("py-3 px-4 pb-2 flex flex-col overflow-hidden", radianzDefaultCardClass)}
      style={radianzCardBorderStyle}
    >
      <div className="flex flex-col gap-1.5 mb-2 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className={radianzMonoLabelClass}>Production</span>
            <p className="mt-1 font-sans text-[2rem] font-light leading-none tracking-[-0.04em] text-foreground tabular-nums sm:text-[2.25rem]">
              {(annualProductionKwh / KWH_PER_MWH).toLocaleString("fr-FR", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
              <span className="ml-1.5 align-baseline font-mono text-sm font-normal tracking-normal text-muted-foreground">
                MWh/an
              </span>
            </p>
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <div
              role="tablist"
              className="inline-flex rounded-md border border-border bg-muted/50 p-0.5"
              aria-label="Vue du graphique"
            >
              <button
                type="button"
                role="tab"
                aria-selected={chartViewMode === "monthly"}
                onClick={() => onChartViewModeChange("monthly")}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  chartViewMode === "monthly"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Mensuel
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={chartViewMode === "daily"}
                onClick={() => onChartViewModeChange("daily")}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  chartViewMode === "daily"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Journalier
              </button>
            </div>

            {onIncludeBatteryChange !== undefined && (
              <div className="flex items-center gap-1.5">
                <Battery className="h-3 w-3 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">Batterie</span>
                <Switch
                  className="scale-75 data-[state=checked]:bg-[#0000FF]"
                  checked={includeBattery ?? false}
                  onCheckedChange={onIncludeBatteryChange}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="h-[260px] min-w-0 w-full">
        <MonthlyProductionChart
          key={configurationModeKey}
          viewMode={chartViewMode}
          onViewModeChange={onChartViewModeChange}
          selectedMonthIndex={chartSelectedMonthIndex}
          onSelectedMonthIndexChange={onChartSelectedMonthIndexChange}
          data={data}
          dailyData={dailyData}
        />
      </div>
    </div>
  );
}
