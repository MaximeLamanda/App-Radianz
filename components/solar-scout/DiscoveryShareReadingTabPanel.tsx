"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { RotateCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import {
  fetchProspectShareSessions,
  type ProspectShareSessionsPayload,
  type ProspectShareSessionRow,
} from "@/lib/prospect-share-client";
import {
  formatShareSessionDateFr,
  formatShareSessionDurationMs,
  formatShareSessionScrollPct,
} from "@/lib/share-reading-session-format";
import {
  shareSessionBarFillFromInteractions,
  shareSessionChartNeedsHorizontalScroll,
  shareSessionChartScrollWidthPx,
} from "@/lib/share-session-chart-display";

type DiscoveryShareReadingTabPanelProps = {
  /** Prospect pipeline lié à la fiche découverte ; null si pas encore au pipeline. */
  pipelineProspectId: string | null;
  shareTokenHint?: string | null;
  drawerOpen: boolean;
  /** Onglet « Lectures » actif — évite des requêtes inutiles. */
  tabActive: boolean;
};

function sessionsToChartRows(sessions: ProspectShareSessionRow[]) {
  const chrono = [...sessions].reverse();
  return chrono.map((s, i) => ({
    name: `#${i + 1}`,
    nameLong: formatShareSessionDateFr(s.startedAt),
    dureeSec: s.durationMs != null && Number.isFinite(s.durationMs) ? Math.max(0, Math.floor(s.durationMs / 1000)) : 0,
    interactions: Math.max(0, Math.floor(s.interactionCount ?? 0)),
  }));
}

function getSessionEventLabel(status: string | null): string {
  if (status === "closed") return "Ouverture terminée";
  if (status === "open") return "Ouverture en cours";
  return "Ouverture";
}

type ShareSessionChartRow = ReturnType<typeof sessionsToChartRows>[number];

function ShareSessionDurationChart({
  rows,
  maxInteractions,
  maxBarSize,
  fixedSize,
}: {
  rows: ShareSessionChartRow[];
  maxInteractions: number;
  maxBarSize: number;
  /** Absent = enfant de ResponsiveContainer (largeur fluide). */
  fixedSize?: { width: number; height: number };
}) {
  return (
    <BarChart
      {...(fixedSize ? { width: fixedSize.width, height: fixedSize.height } : {})}
      data={rows}
      margin={{ top: 4, right: 8, left: -8, bottom: 0 }}
      barCategoryGap="20%"
    >
      <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" vertical={false} />
      <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
      <YAxis
        tick={{ fontSize: 10 }}
        width={36}
        tickLine={false}
        axisLine={false}
        tickFormatter={(v) => `${v}s`}
      />
      <Tooltip
        cursor={{ fill: "rgba(100, 116, 139, 0.08)" }}
        contentStyle={{
          fontSize: 11,
          borderRadius: 8,
          border: "1px solid hsl(var(--border))",
        }}
        formatter={(value, _name, item) => {
          const n = typeof value === "number" ? value : Number(value);
          const row = item?.payload as ShareSessionChartRow | undefined;
          const interactions = row?.interactions ?? 0;
          return [
            Number.isFinite(n) ? `${n} s · ${interactions} interaction${interactions > 1 ? "s" : ""}` : "—",
            "Durée",
          ];
        }}
        labelFormatter={(_, payload) => {
          const p = payload?.[0]?.payload as ShareSessionChartRow | undefined;
          return p?.nameLong ?? "";
        }}
      />
      <Bar dataKey="dureeSec" radius={[4, 4, 0, 0]} maxBarSize={maxBarSize}>
        {rows.map((row) => (
          <Cell
            key={row.name}
            fill={shareSessionBarFillFromInteractions(row.interactions, maxInteractions)}
          />
        ))}
      </Bar>
    </BarChart>
  );
}

export function DiscoveryShareReadingTabPanel({
  pipelineProspectId,
  shareTokenHint,
  drawerOpen,
  tabActive,
}: DiscoveryShareReadingTabPanelProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProspectShareSessionsPayload | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const load = useCallback(async () => {
    if (!user || !pipelineProspectId) return;
    setError(null);
    const first = !hasLoadedOnceRef.current;
    if (first) setLoading(true);
    else setRefreshing(true);
    try {
      const idToken = await user.getIdToken();
      const payload = await fetchProspectShareSessions(idToken, pipelineProspectId);
      setData(payload);
      hasLoadedOnceRef.current = true;
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, pipelineProspectId]);

  useEffect(() => {
    if (!drawerOpen) {
      hasLoadedOnceRef.current = false;
      setData(null);
      setError(null);
    }
  }, [drawerOpen]);

  useEffect(() => {
    setData(null);
    setError(null);
    hasLoadedOnceRef.current = false;
  }, [pipelineProspectId]);

  useEffect(() => {
    if (!drawerOpen || !tabActive || !pipelineProspectId || !user) return;
    void load();
  }, [drawerOpen, tabActive, pipelineProspectId, user, load]);

  const handleRefresh = () => {
    if (!user || !pipelineProspectId || loading || refreshing) return;
    void load();
  };

  const shareToken = data?.shareToken ?? shareTokenHint ?? null;
  const sessions = data?.sessions ?? [];
  const count = data?.shareSessionCount ?? 0;
  const lastAt = data?.shareLastSessionAt ?? null;

  const chartRows = useMemo(() => sessionsToChartRows(sessions), [sessions]);
  const maxInteractionsInChart = useMemo(
    () => chartRows.reduce((max, row) => Math.max(max, row.interactions), 0),
    [chartRows]
  );
  const chartScrollsHorizontally = shareSessionChartNeedsHorizontalScroll(chartRows.length);
  const chartScrollWidthPx = shareSessionChartScrollWidthPx(chartRows.length);
  const chartScrollRef = useRef<HTMLDivElement>(null);

  const scrollChartToMostRecent = useCallback(() => {
    const el = chartScrollRef.current;
    if (!el || !shareSessionChartNeedsHorizontalScroll(chartRows.length)) return;
    el.scrollLeft = el.scrollWidth - el.clientWidth;
  }, [chartRows.length]);

  useLayoutEffect(() => {
    scrollChartToMostRecent();
    const id = requestAnimationFrame(scrollChartToMostRecent);
    return () => cancelAnimationFrame(id);
  }, [scrollChartToMostRecent, chartScrollWidthPx]);

  useEffect(() => {
    const el = chartScrollRef.current;
    if (!el || !chartScrollsHorizontally) return;
    const ro = new ResizeObserver(() => scrollChartToMostRecent());
    ro.observe(el);
    return () => ro.disconnect();
  }, [chartScrollsHorizontally, scrollChartToMostRecent]);

  const openerReopenBySessionId = useMemo(() => {
    const byOpener = new Map<string, number>();
    const reopenById = new Map<string, number>();
    const chrono = [...sessions].reverse();
    for (const row of chrono) {
      const key = row.openerId?.trim() ?? "";
      if (!key) {
        reopenById.set(row.id, 1);
        continue;
      }
      const next = (byOpener.get(key) ?? 0) + 1;
      byOpener.set(key, next);
      reopenById.set(row.id, next);
    }
    return reopenById;
  }, [sessions]);

  if (!pipelineProspectId) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-4 text-xs text-muted-foreground">
        Ajoutez ce lieu au pipeline pour associer une page client et suivre les lectures.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="drawer-discovery-section-title !mb-1">Analyse des ouvertures</h4>
          {!user ? (
            <p className="text-xs text-muted-foreground">Connectez-vous pour afficher les indicateurs.</p>
          ) : loading && !data ? (
            <div className="mt-2 space-y-1.5">
              <Skeleton className="h-3 w-44" />
              <Skeleton className="h-3 w-32" />
            </div>
          ) : error ? (
            <p className="text-xs text-destructive mt-1">{error}</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
              <span>
                Sessions terminées :{" "}
                <span className="font-medium text-foreground">{count}</span>
              </span>
              <span>
                Dernière fin :{" "}
                <span className="font-medium text-foreground">{formatShareSessionDateFr(lastAt)}</span>
              </span>
            </div>
          )}
        </div>
        {user ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 text-xs"
            onClick={() => handleRefresh()}
            disabled={loading || refreshing}
          >
            <RotateCw className={`h-3.5 w-3.5 ${loading || refreshing ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        ) : null}
      </div>

      {user && !loading && !error && !shareToken ? (
        <p className="text-xs text-muted-foreground">
          Générez le lien de partage (bouton « page client » en bas du tiroir) pour activer le suivi.
        </p>
      ) : null}

      {user && !loading && !error && shareToken && sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucune lecture enregistrée pour l’instant.</p>
      ) : null}

      {user && !error && chartRows.length > 0 ? (
        <div className="rounded-xl border border-border/80 bg-muted/20 px-2 pt-3 pb-1">
          <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
            Durée par visite (ordre chronologique)
          </p>
          <p className="px-1 text-[10px] text-muted-foreground mb-2">
            Vert plus soutenu = plus d’interactions sur la visite.
          </p>
          <div
            ref={chartScrollRef}
            className={chartScrollsHorizontally ? "overflow-x-auto overscroll-x-contain" : "min-w-0"}
          >
            <div
              className="h-[200px]"
              style={{
                width: chartScrollsHorizontally ? chartScrollWidthPx : "100%",
                minWidth: chartScrollsHorizontally ? chartScrollWidthPx : undefined,
              }}
            >
              {chartScrollsHorizontally ? (
                <ShareSessionDurationChart
                  rows={chartRows}
                  maxInteractions={maxInteractionsInChart}
                  fixedSize={{ width: chartScrollWidthPx, height: 200 }}
                  maxBarSize={36}
                />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ShareSessionDurationChart
                    rows={chartRows}
                    maxInteractions={maxInteractionsInChart}
                    maxBarSize={40}
                  />
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {user && !error && sessions.length > 0 ? (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2 px-0.5">
            Détail des ouvertures
          </p>
          <div className="drawer-discovery-table-wrap rounded-xl border border-border/80 bg-background">
            <Table>
              <TableHeader>
                <TableRow className="border-0 hover:bg-transparent">
                  <TableHead className="text-[10px] uppercase h-8 whitespace-nowrap">Début</TableHead>
                  <TableHead className="text-[10px] uppercase h-8">Événement</TableHead>
                  <TableHead className="text-[10px] uppercase h-8">Durée</TableHead>
                  <TableHead className="text-[10px] uppercase h-8">Scroll max</TableHead>
                  <TableHead className="text-[10px] uppercase h-8">Interactions</TableHead>
                  <TableHead className="text-[10px] uppercase h-8">CTA contact</TableHead>
                  <TableHead className="text-[10px] uppercase h-8 whitespace-nowrap">ID ouverture</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((row) => (
                  <TableRow key={row.id} className="text-xs">
                    <TableCell className="py-2 tabular-nums whitespace-nowrap">
                      {formatShareSessionDateFr(row.startedAt)}
                    </TableCell>
                    <TableCell className="py-2">
                      {(() => {
                        const reopenIndex = openerReopenBySessionId.get(row.id) ?? 1;
                        if (reopenIndex > 1) return `Réouverture #${reopenIndex}`;
                        return getSessionEventLabel(row.status);
                      })()}
                    </TableCell>
                    <TableCell className="py-2 tabular-nums">
                      {formatShareSessionDurationMs(row.durationMs)}
                    </TableCell>
                    <TableCell className="py-2 tabular-nums">
                      {formatShareSessionScrollPct(row.maxScrollDepth01)}
                    </TableCell>
                    <TableCell className="py-2 tabular-nums">{row.interactionCount}</TableCell>
                    <TableCell className="py-2 tabular-nums">{row.ctaClicks}</TableCell>
                    <TableCell className="py-2 tabular-nums whitespace-nowrap">
                      {row.openerId ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
