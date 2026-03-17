import { cn } from "@/lib/utils";

interface StickSliderTrackProps {
  segments?: number;
  /** Index(s) sélectionné(s) à mettre en avant (0-based) */
  selectedIndices?: number[];
}

export function StickSliderTrack({ segments = 12, selectedIndices = [] }: StickSliderTrackProps) {
  const hasSelection = selectedIndices.length > 0;
  const selectedMin = hasSelection ? Math.min(...selectedIndices) : null;
  const selectedMax = hasSelection ? Math.max(...selectedIndices) : null;

  return (
    <div className="absolute inset-0 flex items-center justify-center px-3 pointer-events-none" aria-hidden>
      <div className="flex w-full items-center justify-center">
        {Array.from({ length: segments }, (_, i) => {
          const isMajor = i % 3 === 0;
          const isSelected = selectedIndices.includes(i);
          const isEdge =
            hasSelection && isSelected && (i === selectedMin || i === selectedMax);

          // Hauteur de base (gros/petit) selon la grille
          const baseHeightClass = isMajor ? "h-3" : "h-1.5";
          // Les sticks d'extrémité gauche et droite ne doivent jamais être petits
          const isEdgeStick =
            hasSelection && (i === selectedMin || i === selectedMax);
          const heightClass = isEdgeStick ? "h-3" : baseHeightClass;

          return (
            <div key={i} className="flex-1 flex justify-center items-center">
              <div
                className={cn(
                  "transition-all duration-200",
                  isEdge
                    ? "w-1 bg-red-500"
                    : isSelected
                      ? "w-px bg-red-500"
                      : "w-px bg-gray-500/70 dark:bg-white/50",
                  heightClass
                )}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

