"use client";

import type { ReactNode } from "react";
import { MonthlyProductionChart } from "./MonthlyProductionChart";
import type { DailyProductionChartDatum, MonthlyProductionChartDatum } from "./MonthlyProductionChart";

export interface ProspectEnergyChartsPanelProps {
  /** Résumé production / consommation (sous-titre sous « Production »). */
  children: ReactNode;
  chartViewMode: "monthly" | "daily";
  onChartViewModeChange: (mode: "monthly" | "daily") => void;
  chartSelectedMonthIndex: number;
  onChartSelectedMonthIndexChange: (index: number) => void;
  data: MonthlyProductionChartDatum[];
  dailyData: DailyProductionChartDatum[] | undefined;
  /** Clé de re-montage quand le mode de configuration (perfect fit / highest) change. */
  configurationModeKey: string;
}

/**
 * Bloc production / consommation (onglets mensuel · journalier + graphique).
 * Extrait du drawer prospect pour réutilisation future (ex. Discovery).
 */
export function ProspectEnergyChartsPanel({
  children,
  chartViewMode,
  onChartViewModeChange,
  chartSelectedMonthIndex,
  onChartSelectedMonthIndexChange,
  data,
  dailyData,
  configurationModeKey,
}: ProspectEnergyChartsPanelProps) {
  return (
    <div className="flex flex-col bg-gray-100 rounded-xl py-3 px-4 pb-2">
      <div className="flex shrink-0 items-start justify-between gap-2 mb-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-gray-500">Production</span>
          {children}
        </div>
        <div
          role="tablist"
          className="inline-flex rounded-md border border-border bg-muted/50 p-0.5 shrink-0"
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
            className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              chartViewMode === "daily"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Journalier
          </button>
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
