"use client";

function calendlyIframeSrc(url: string): string {
  const u = url.trim();
  if (!u) return "";
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}embed=true`;
}

/** Aperçu inline si l’URL ressemble à un lien Calendly (https://calendly.com/...). */
function looksLikeCalendlyUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" && u.hostname.endsWith("calendly.com");
  } catch {
    return false;
  }
}

interface CalendlyEmbedProps {
  /** URL saisie par l’utilisateur (onboarding ou paramètres) */
  url?: string | null;
}

export function CalendlyEmbed({ url }: CalendlyEmbedProps) {
  const trimmed = url?.trim() ?? "";
  if (!trimmed || !looksLikeCalendlyUrl(trimmed)) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <iframe
        title="Aperçu Calendly"
        src={calendlyIframeSrc(trimmed)}
        className="h-[min(630px,72vh)] w-full min-h-[420px] border-0"
        loading="lazy"
      />
    </div>
  );
}
