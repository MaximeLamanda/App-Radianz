import { cn } from "@/lib/utils";
import { BRAND_INK, BRAND_LIME, BRAND_LINE } from "@/lib/brand-colors";

/** Labels type design system Radianz (mono, uppercase, tracking). */
export const radianzMonoLabelClass = cn(
  "font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground"
);

/** Carte surface blanche / `--line` (alignée drawer Découverte). */
export const radianzDefaultCardClass = cn(
  "rounded-[12px] border bg-card text-card-foreground shadow-none"
);

export const radianzCardBorderStyle = { borderColor: BRAND_LINE } as const;

export const radianzLimeCardStyle = {
  backgroundColor: BRAND_LIME,
  borderColor: BRAND_LINE,
  color: BRAND_INK,
} as const;

export const radianzLimeCardRootClass = cn(
  "relative overflow-hidden border shadow-none rounded-[12px]"
);

export type RadianzLimeDotOverlayProps = {
  /** Couleur des points (défaut : encre sur fond lime). Sur fond sombre, utiliser `BRAND_LIME` ou `#FFFFFF`. */
  dotColor?: string;
  /** Opacité du calque motif (0–1). */
  layerOpacity?: number;
};

export function RadianzLimeDotOverlay({
  dotColor = BRAND_INK,
  layerOpacity = 0.14,
}: RadianzLimeDotOverlayProps = {}) {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        opacity: layerOpacity,
        backgroundImage: `radial-gradient(${dotColor} 1px, transparent 1px)`,
        backgroundSize: "14px 14px",
        maskImage: "linear-gradient(135deg, #000 28%, transparent 78%)",
      }}
      aria-hidden
    />
  );
}
