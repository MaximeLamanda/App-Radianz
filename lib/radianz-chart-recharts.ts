/**
 * Props Recharts alignées sur le design system Radianz (HTML v0.1, section Charts).
 * Grille : lignes horizontales uniquement, trait `--border`, tirets 2 4.
 */
export const radianzCartesianGridProps = {
  vertical: false as const,
  stroke: "var(--border)",
  strokeDasharray: "2 4" as const,
};
