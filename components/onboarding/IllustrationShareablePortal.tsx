"use client";

import { Share2 } from "lucide-react";
import { BRAND_LIME } from "@/lib/brand-colors";

export function IllustrationShareablePortal() {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      {/* Chrome navigateur */}
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-emerald-400" />
        </div>
        <div className="ml-4 flex-1 rounded-md bg-white px-3 py-1.5 font-mono text-xs text-zinc-500 dark:bg-zinc-900">
          app.example.com/p/prospect-001
        </div>
        <button
          type="button"
          className="ml-2 flex size-8 items-center justify-center rounded-md hover:bg-zinc-200"
        >
          <Share2 className="size-4" />
        </button>
      </div>
      {/* Contenu bento */}
      <div className="relative max-h-[420px] space-y-6 overflow-hidden p-6">
        <div className="absolute right-6 top-6 flex size-12 items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 text-[10px] text-zinc-500 dark:bg-zinc-800">
          Votre logo
        </div>
        <div className="flex flex-col gap-1 pr-24">
          <h3 className="text-xl font-semibold">Amazon Platform Lyon</h3>
          <p className="text-sm text-zinc-500">Saint-Priest • 69</p>
        </div>
        <div className="grid min-h-[280px] grid-cols-2 gap-2 md:grid-cols-3 md:grid-rows-2">
          <div className="relative col-span-2 row-span-1 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 md:col-span-1 md:row-span-2">
            <div className="size-full bg-zinc-300 object-cover dark:bg-zinc-600" />
            <span className="absolute left-2 top-2 rounded-full bg-accent-lime px-2 py-0.5 font-mono text-[10px] font-medium text-accent-lime-foreground">
              2356 m²
            </span>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Facture énergie
            </p>
            <p className="text-lg font-semibold">135 k€/an</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Potentiel solaire
            </p>
            <p className="text-lg font-semibold">847 kWp</p>
          </div>
          <div className="flex min-h-[120px] flex-col justify-between rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Économies annuelles
              </p>
              <p className="text-lg font-semibold">108 k€</p>
            </div>
            <div className="mt-2">
              <svg
                viewBox="0 0 180 48"
                className="h-14 w-full"
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
                  const hConso =
                    v.conso > 0 ? (v.conso / 12) * (maxH / 4) : 0;
                  return (
                    <g key={i}>
                      <rect
                        x={x}
                        y={48 - hProd}
                        width={w}
                        height={hProd}
                        fill={BRAND_LIME}
                        rx={1}
                      />
                      {hConso > 0 && (
                        <rect
                          x={x}
                          y={48 - hProd - hConso}
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
          </div>
          <div className="flex min-h-[120px] flex-col justify-between rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Contact référent
            </p>
            <div className="mt-auto flex items-center gap-2">
              <div className="size-9 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              <div>
                <p className="text-[11px] font-medium">Marie Dubois</p>
                <p className="text-[10px] text-zinc-500">Lyon • m.dubois@example.io</p>
              </div>
            </div>
            <div className="mt-2 flex gap-1">
              <button className="flex-1 rounded bg-zinc-200 py-1 text-[10px] font-medium dark:bg-zinc-700">
                Call
              </button>
              <button className="flex-1 rounded bg-zinc-200 py-1 text-[10px] font-medium dark:bg-zinc-700">
                Mail
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
