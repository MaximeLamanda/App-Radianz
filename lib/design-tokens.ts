/**
 * Tokens de design (variables CSS) pour personnalisation site-wide.
 * SolarView/RADIANZ design system - valeurs OKLCH ou hex.
 */

export const DESIGN_TOKENS_STORAGE_KEY = "app.radianz-design-tokens";

export interface DesignTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  radius: string;
}

/** Valeurs par défaut SolarView/RADIANZ */
export const DEFAULT_DESIGN_TOKENS: DesignTokens = {
  background: "oklch(0.985 0 0)",
  foreground: "oklch(0.2 0.02 260)",
  card: "#ffffff",
  cardForeground: "oklch(0.2 0.02 260)",
  primary: "oklch(0.55 0.18 155)",
  primaryForeground: "#ffffff",
  secondary: "oklch(0.96 0.01 155)",
  secondaryForeground: "oklch(0.2 0.02 260)",
  muted: "oklch(0.96 0.005 260)",
  mutedForeground: "oklch(0.45 0.02 260)",
  accent: "oklch(0.92 0.06 155)",
  accentForeground: "oklch(0.2 0.02 260)",
  destructive: "oklch(0.55 0.22 25)",
  destructiveForeground: "#ffffff",
  border: "oklch(0.922 0 0)",
  input: "oklch(0.922 0 0)",
  ring: "#E4FE55",
  radius: "0.625rem",
};

const TOKEN_TO_CSS_VAR: Record<keyof DesignTokens, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  destructiveForeground: "--destructive-foreground",
  border: "--border",
  input: "--input",
  ring: "--ring",
  radius: "--radius",
};

export function getStoredDesignTokens(): DesignTokens | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DESIGN_TOKENS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DesignTokens>;
    return { ...DEFAULT_DESIGN_TOKENS, ...parsed };
  } catch {
    return null;
  }
}

export function saveDesignTokens(tokens: DesignTokens): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DESIGN_TOKENS_STORAGE_KEY, JSON.stringify(tokens));
}

export function clearDesignTokens(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DESIGN_TOKENS_STORAGE_KEY);
}

export function applyDesignTokensToDocument(tokens: DesignTokens): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  (Object.keys(tokens) as (keyof DesignTokens)[]).forEach((key) => {
    const cssVar = TOKEN_TO_CSS_VAR[key];
    const value = tokens[key];
    if (cssVar && value !== undefined) root.style.setProperty(cssVar, value);
  });
}

export function removeDesignTokensFromDocument(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  Object.values(TOKEN_TO_CSS_VAR).forEach((cssVar) => root.style.removeProperty(cssVar));
}

export const TOKEN_LABELS: Record<keyof DesignTokens, string> = {
  background: "Arrière-plan",
  foreground: "Texte principal",
  card: "Fond carte",
  cardForeground: "Texte carte",
  primary: "Couleur primaire",
  primaryForeground: "Texte primaire",
  secondary: "Secondaire",
  secondaryForeground: "Texte secondaire",
  muted: "Atténué",
  mutedForeground: "Texte atténué",
  accent: "Accent",
  accentForeground: "Texte accent",
  destructive: "Destructif",
  destructiveForeground: "Texte destructif",
  border: "Bordure",
  input: "Champ",
  ring: "Focus ring",
  radius: "Rayon (border-radius)",
};
