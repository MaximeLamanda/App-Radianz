"use client";

import { cn } from "@/lib/utils";

interface ProgressIndicatorProps {
  current: number;
  total: number;
  className?: string;
}

export function ProgressIndicator({ current, total, className }: ProgressIndicatorProps) {
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-2 rounded-full transition-all",
            i + 1 <= current
              ? "w-6 bg-primary"
              : "w-2 bg-zinc-200 dark:bg-zinc-700"
          )}
          aria-hidden
        />
      ))}
    </div>
  );
}
