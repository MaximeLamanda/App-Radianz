"use client";

import { Search, SlidersHorizontal, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BRAND_LIME } from "@/lib/brand-colors";

export function IllustrationMapSearch() {
  return (
    <div className="relative min-h-[280px] rounded-xl lg:min-h-[360px]">
      <div
        className="size-full rounded-xl object-cover bg-zinc-300 dark:bg-zinc-600"
        aria-hidden
      />
      {/* Carte recherche (gauche) */}
      <div className="absolute -left-2 -bottom-12 w-[175px] min-w-[175px] rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-white lg:bottom-auto lg:-left-5 lg:top-4 lg:w-[220px] lg:min-w-[220px] lg:rounded-xl lg:p-3">
        <div className="mb-1.5 flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-800/50 lg:mb-3 lg:gap-2 lg:px-2 lg:py-1.5">
          <Search className="size-3 shrink-0 text-zinc-500 lg:size-3.5" />
          <span className="text-[9px] text-zinc-400 lg:text-[10px]">Recherche...</span>
        </div>
        <div className="mb-1.5 flex items-center gap-1 lg:mb-3 lg:gap-2">
          <button
            type="button"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-zinc-200 bg-zinc-50 lg:h-5 lg:w-5"
          >
            <SlidersHorizontal className="size-2.5 lg:size-3" />
          </button>
          <Badge className="text-[10px]">Supermarket</Badge>
          <Badge variant="secondary" className="text-[10px]">
            Logistics
          </Badge>
        </div>
        <p className="mb-1 text-[9px] font-medium text-zinc-600 lg:mb-2 lg:text-[10px]">
          20 bâtiments trouvés
        </p>
        <div className="space-y-1 lg:space-y-2">
          <div className="flex items-center gap-2 rounded border border-zinc-200 bg-zinc-50 p-1.5 dark:border-zinc-700 dark:bg-zinc-800/50">
            <div className="size-6 shrink-0 rounded bg-zinc-300 dark:bg-zinc-600 lg:size-8" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-medium">Logistics Warehouse Lyon</p>
              <p className="truncate text-[9px] text-zinc-500">Lyon • Auvergne-Rhône-Alpes</p>
              <div className="mt-0.5 flex gap-0.5">
                <Badge variant="secondary" className="px-1 py-0 text-[8px]">
                  72%
                </Badge>
                <Badge variant="secondary" className="px-1 py-0 text-[8px]">
                  81%
                </Badge>
                <Badge variant="secondary" className="px-1 py-0 text-[8px]">
                  88%
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Carte infos bâtiment (droite) */}
      <div className="absolute -right-2 -bottom-16 w-[150px] min-w-[150px] rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-white lg:bottom-4 lg:-right-6 lg:w-[210px] lg:min-w-[210px] lg:rounded-xl lg:p-3">
        <h3 className="text-[10px] font-semibold lg:text-xs">Amazon Platform Lyon</h3>
        <p className="mt-0.5 text-[9px] text-zinc-500 lg:text-[10px]">Saint-Priest • 69</p>
        <div className="mt-1 flex flex-wrap gap-0.5">
          <Badge variant="secondary" className="px-1 py-0 text-[7px] lg:text-[8px]">
            85%
          </Badge>
          <Badge variant="secondary" className="px-1 py-0 text-[7px] lg:text-[8px]">
            78%
          </Badge>
          <Badge variant="secondary" className="px-1 py-0 text-[7px] lg:text-[8px]">
            92%
          </Badge>
        </div>
        <div className="my-1 lg:my-2">
          <svg
            viewBox="0 0 180 48"
            className="h-10 w-full lg:h-16"
            preserveAspectRatio="none"
            aria-hidden
          >
            {[
              { prod: 5, conso: 12 },
              { prod: 7, conso: 11 },
              { prod: 12, conso: 10 },
              { prod: 18, conso: 0 },
              { prod: 24, conso: 0 },
              { prod: 28, conso: 0 },
              { prod: 26, conso: 0 },
              { prod: 22, conso: 0 },
              { prod: 14, conso: 9 },
              { prod: 8, conso: 11 },
            ].map((v, i) => {
              const x = 2 + i * 18;
              const w = 14;
              const maxH = 42;
              const hProd = (v.prod / 28) * maxH;
              const hConso = v.conso > 0 ? (v.conso / 12) * (maxH / 4) : 0;
              const yProdTop = 48 - hProd;
              const yConsoTop = 48 - hProd - hConso;
              return (
                <g key={i}>
                  <rect x={x} y={yProdTop} width={w} height={hProd} fill={BRAND_LIME} rx={1} />
                  {hConso > 0 && (
                    <rect
                      x={x}
                      y={yConsoTop}
                      width={w}
                      height={hConso}
                      fill="rgba(0,0,0,0.08)"
                      rx={1}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-700" />
        <div className="flex justify-between text-[9px] lg:text-[10px]">
          <span className="text-zinc-500">kWp</span>
          <span>847</span>
        </div>
        <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-700" />
        <div className="flex justify-between text-[9px] lg:text-[10px]">
          <span className="text-zinc-500">MWh</span>
          <span>1059</span>
        </div>
        <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-700" />
        <div className="flex justify-between text-[9px] lg:text-[10px]">
          <span className="text-zinc-500">Surface</span>
          <span>13 000 m²</span>
        </div>
        <button
          type="button"
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-md bg-accent-lime px-1.5 py-1 text-[9px] font-medium text-accent-lime-foreground lg:mt-3 lg:px-2 lg:py-1.5 lg:text-[10px]"
        >
          <Plus className="size-3" /> Ajouter au pipeline
        </button>
      </div>
    </div>
  );
}
