"use client";

import { cn } from "@/lib/utils";
import {
  getProspectShareOpensDisplay,
  SHARE_OPENS_DOT_CAP,
  type ProspectShareOpensInput,
} from "@/lib/prospect-share-opens-display";

type ProspectShareOpensCellProps = ProspectShareOpensInput & {
  className?: string;
};

export function ProspectShareOpensCell({
  shareToken,
  shareSessionCount,
  shareLastSessionAt,
  className,
}: ProspectShareOpensCellProps) {
  const display = getProspectShareOpensDisplay({
    shareToken,
    shareSessionCount,
    shareLastSessionAt,
  });

  if (!display.hasShareLink) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)} title={display.tooltip}>
        —
      </span>
    );
  }

  return (
    <div
      className={cn("flex items-center gap-1.5 min-w-0", className)}
      title={display.tooltip}
      aria-label={display.tooltip}
    >
      <div className="flex shrink-0 items-center gap-0.5" aria-hidden>
        {Array.from({ length: display.filledDots }, (_, i) => {
          const isLastFilled = i === display.filledDots - 1;
          return (
            <span
              key={`f-${i}`}
              className={cn(
                "size-1.5 rounded-full",
                isLastFilled && display.isRecent
                  ? "bg-emerald-500 ring-1 ring-emerald-500/40"
                  : "bg-foreground/80"
              )}
            />
          );
        })}
        {Array.from({ length: display.emptyDots }, (_, i) => (
          <span key={`e-${i}`} className="size-1.5 rounded-full bg-muted-foreground/20" />
        ))}
      </div>
      <span
        className={cn(
          "tabular-nums text-[11px] font-medium leading-none",
          display.count > 0 ? "text-foreground" : "text-muted-foreground/70"
        )}
      >
        {display.count}
        {display.count > SHARE_OPENS_DOT_CAP ? (
          <span className="text-muted-foreground font-normal">+</span>
        ) : null}
      </span>
    </div>
  );
}
