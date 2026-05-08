export function formatShareSessionDurationMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m} min ${rs} s`;
}

export function formatShareSessionScrollPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(Math.min(1, Math.max(0, v)) * 100)} %`;
}

export function formatShareSessionDateFr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}
