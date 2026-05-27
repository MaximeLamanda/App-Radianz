"use client";

import { Spinner } from "@/components/ui/spinner";

type Props = {
  loading: boolean;
};

/** Bandeau mode édition — placé sous le panneau filtres (colonne gauche). */
export function DiscoveryEditModeStatusBanner({ loading }: Props) {
  return (
    <div
      className="pointer-events-none shrink-0 rounded-lg border border-blue-200/80 bg-white/95 px-3 py-2.5 text-xs text-foreground shadow-sm backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-busy={loading}
    >
      <div className="flex items-start gap-2.5">
        {loading ? (
          <Spinner className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        ) : null}
        <p className="min-w-0 leading-snug text-foreground/90">
          {loading ? (
            <>
              <span className="font-medium text-foreground">Chargement du cadastre</span>
              <span className="text-muted-foreground"> — cadastre de la zone visible…</span>
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">Mode édition</span>
              <span className="text-muted-foreground">
                {" "}
                — parcelles du cadastre dans la zone visible (pointillés / plein bleu) ; cochez ou numérotez les
                bâtiments dans le tiroir.
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
