"use client";

import franceRegions from "@svg-maps/france.regions";
import { BRAND_LIME } from "@/lib/brand-colors";

interface IllustrationFranceRegionsProps {
  /** Noms des régions sélectionnées (ex: "Auvergne-Rhône-Alpes") — affichées en jaune */
  selectedRegions?: string[];
}


export function IllustrationFranceRegions({
  selectedRegions = [],
}: IllustrationFranceRegionsProps) {
  const selectedSet = new Set(selectedRegions);
  const [minX, minY, width, height] = franceRegions.viewBox.split(" ").map(Number);

  return (
    <div className="min-h-[280px] rounded-xl bg-background lg:min-h-[360px] flex items-center justify-center p-4 m-4 border border-background">
      <svg
        viewBox={franceRegions.viewBox}
        className="w-full h-full max-h-[280px] lg:max-h-[340px] object-contain"
        aria-label="Carte des régions de France"
      >
        {/* Fond de la carte (cohérent avec le conteneur) */}
        <rect
          x={minX}
          y={minY}
          width={width}
          height={height}
          className="fill-background"
        />
        {franceRegions.locations.map((loc: { name: string; id: string; path: string }) => {
          const isSelected = selectedSet.has(loc.name);
          return (
            <path
              key={loc.id}
              d={loc.path}
              fill={isSelected ? BRAND_LIME : "currentColor"}
              fillOpacity={isSelected ? 1 : 0.35}
              stroke="currentColor"
              strokeWidth={2}
              className={isSelected ? "stroke-background" : "text-zinc-300 dark:text-zinc-600 stroke-background"}
              aria-label={loc.name}
            />
          );
        })}
      </svg>
    </div>
  );
}
