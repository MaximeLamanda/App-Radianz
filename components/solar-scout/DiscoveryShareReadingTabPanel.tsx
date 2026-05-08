"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { RotateCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
  }));
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
          <div className="h-[200px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
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
                  cursor={{ fill: "hsl(var(--muted) / 0.35)" }}
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    border: "1px solid hsl(var(--border))",
                  }}
                  formatter={(value) => {
                    const n = typeof value === "number" ? value : Number(value);
                    return [Number.isFinite(n) ? `${n} s` : "—", "Durée"];
                  }}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as { nameLong?: string } | undefined;
                    return p?.nameLong ?? "";
                  }}
                />
                <Bar dataKey="dureeSec" fill="hsl(var(--foreground) / 0.85)" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
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
                  <TableHead className="text-[10px] uppercase h-8">Durée</TableHead>
                  <TableHead className="text-[10px] uppercase h-8">Scroll max</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((row) => (
                  <TableRow key={row.id} className="text-xs">
                    <TableCell className="py-2 tabular-nums whitespace-nowrap">
                      {formatShareSessionDateFr(row.startedAt)}
                    </TableCell>
                    <TableCell className="py-2 tabular-nums">
                      {formatShareSessionDurationMs(row.durationMs)}
                    </TableCell>
                    <TableCell className="py-2 tabular-nums">
                      {formatShareSessionScrollPct(row.maxScrollDepth01)}
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
