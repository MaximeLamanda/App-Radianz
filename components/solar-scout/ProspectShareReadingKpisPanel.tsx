"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { RotateCw } from "lucide-react";
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
import {
  fetchProspectShareSessions,
  type ProspectShareSessionsPayload,
} from "@/lib/prospect-share-client";

function formatDurationMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m} min ${rs} s`;
}

function formatScrollPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(Math.min(1, Math.max(0, v)) * 100)} %`;
}

function formatDateFr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

type ProspectShareReadingKpisPanelProps = {
  prospectId: string;
  /** Jeton connu côté client (évite un flash « pas de lien » avant la réponse API). */
  shareTokenHint?: string | null;
  isOpen: boolean;
  user: User | null;
};

export function ProspectShareReadingKpisPanel({
  prospectId,
  shareTokenHint,
  isOpen,
  user,
}: ProspectShareReadingKpisPanelProps) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProspectShareSessionsPayload | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    const first = !hasLoadedOnceRef.current;
    if (first) setLoading(true);
    else setRefreshing(true);
    try {
      const idToken = await user.getIdToken();
      const payload = await fetchProspectShareSessions(idToken, prospectId);
      setData(payload);
      hasLoadedOnceRef.current = true;
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, prospectId]);

  useEffect(() => {
    if (!isOpen) {
      hasLoadedOnceRef.current = false;
      setData(null);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    setData(null);
    setError(null);
    hasLoadedOnceRef.current = false;
  }, [prospectId]);

  useEffect(() => {
    if (!isOpen || !prospectId || !user) {
      return;
    }
    void load();
  }, [isOpen, prospectId, user, load]);

  const handleRefresh = () => {
    if (!user || loading || refreshing) return;
    void load();
  };

  const shareToken = data?.shareToken ?? shareTokenHint ?? null;
  const sessions = data?.sessions ?? [];
  const count = data?.shareSessionCount ?? 0;
  const lastAt = data?.shareLastSessionAt ?? null;

  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Lectures page partagée
          </p>
          {!user ? (
            <p className="text-xs text-muted-foreground mt-1">Connectez-vous pour afficher les indicateurs.</p>
          ) : loading && !data ? (
            <div className="mt-2 space-y-1.5">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
          ) : error ? (
            <p className="text-xs text-destructive mt-1">{error}</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
              <span>
                <span className="text-muted-foreground">Sessions terminées :</span>{" "}
                <span className="font-medium text-foreground">{count}</span>
              </span>
              <span>
                <span className="text-muted-foreground">Dernière fin :</span>{" "}
                <span className="font-medium text-foreground">{formatDateFr(lastAt)}</span>
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
            <RotateCw
              className={`h-3.5 w-3.5 ${loading || refreshing ? "animate-spin" : ""}`}
            />
            Actualiser
          </Button>
        ) : null}
      </div>

      {user && !loading && !error && !shareToken ? (
        <p className="text-xs text-muted-foreground">
          Générez le lien de partage (bouton page client) pour activer le suivi des lectures.
        </p>
      ) : null}

      {user && !loading && !error && shareToken && sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucune lecture enregistrée pour l’instant.</p>
      ) : null}

      {user && !error && sessions.length > 0 ? (
        <div className="rounded-lg border border-border/80 bg-background overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] uppercase h-8">Début</TableHead>
                <TableHead className="text-[10px] uppercase h-8">Durée</TableHead>
                <TableHead className="text-[10px] uppercase h-8">Scroll max</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((row) => (
                <TableRow key={row.id} className="text-xs">
                  <TableCell className="py-2 tabular-nums whitespace-nowrap">
                    {formatDateFr(row.startedAt)}
                  </TableCell>
                  <TableCell className="py-2 tabular-nums">{formatDurationMs(row.durationMs)}</TableCell>
                  <TableCell className="py-2 tabular-nums">{formatScrollPct(row.maxScrollDepth01)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
