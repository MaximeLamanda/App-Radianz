"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useDrawer } from "@/lib/drawer-context";
import { fetchWithAuth } from "@/lib/api-client";
import {
  collectBatimentIdsForMatchingV5BuildingsApi,
  findMatchingV5LinkedParcelleRowsTransitive,
  findMatchingV5ParcelleRowsForBuilding,
  parseMatchingV5GeoJsonFeatureCollection,
  type ScoutMatchingV5Row,
} from "@/lib/scout-matching-v5-map";
import type { MapBounds } from "@/lib/swr-hooks";
import { ProspectDrawer } from "@/components/solar-scout/ProspectDrawer";
import { DiscoveryMapView } from "@/components/discovery/DiscoveryMapView";
import { DiscoveryFiltersPanel } from "@/components/discovery/DiscoveryFiltersPanel";

const DEFAULT_CODE_INSEE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SCOUT_MATCHING_V5_CODE_INSEE?.trim()) || "33318";

/** Pessac — centre carte par défaut (hors Google). */
const DEFAULT_MAP_CENTER = { lat: 44.8067, lng: -0.6311 };
const DEFAULT_ZOOM = 14;

/** Limite `/api/matching-v5/buildings` (ids par requête côté route ~300). */
const BDNB_BUILDINGS_CHUNK = 280;
const BDNB_BUILDINGS_MAX_IDS = 600;

function DiscoveryContent() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { setIsDrawerOpen, setDrawerContent } = useDrawer();

  const [matchingV5Rows, setMatchingV5Rows] = useState<ScoutMatchingV5Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewBounds, setViewBounds] = useState<MapBounds | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const [surfaceMinM2, setSurfaceMinM2] = useState(0);
  const [surfaceMaxM2, setSurfaceMaxM2] = useState(50_000);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [bdnbBuildingFeatures, setBdnbBuildingFeatures] = useState<GeoJSON.Feature[]>([]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    return () => {
      setDrawerContent(null);
      setIsDrawerOpen(false);
    };
  }, [setDrawerContent, setIsDrawerOpen]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const params = new URLSearchParams({
          code_insee: DEFAULT_CODE_INSEE,
          limit: "4000",
        });
        if (viewBounds) {
          params.set("minLat", String(viewBounds.sw.lat));
          params.set("maxLat", String(viewBounds.ne.lat));
          params.set("minLng", String(viewBounds.sw.lng));
          params.set("maxLng", String(viewBounds.ne.lng));
        }
        const res = await fetchWithAuth(`/api/matching-v5/features?${params.toString()}`);
        if (!res.ok) {
          if (!cancelled) {
            setError(res.status === 500 ? "Erreur serveur (Postgres)." : `HTTP ${res.status}`);
            setMatchingV5Rows([]);
          }
          return;
        }
        const json: unknown = await res.json();
        if (cancelled) return;
        const { rows, error: parseErr } = parseMatchingV5GeoJsonFeatureCollection(json);
        if (parseErr) setError(parseErr);
        else setError(null);
        setMatchingV5Rows(rows);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erreur réseau");
          setMatchingV5Rows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, fetchKey, viewBounds]);

  /** Postgres exporte surtout des parcelles (empreinte Σ bâtiments) ; les lignes `building` sont optionnelles (pipeline --include-building-grain). */
  const filteredFootprints = useMemo(() => {
    const lo = Math.min(surfaceMinM2, surfaceMaxM2);
    const hi = Math.max(surfaceMinM2, surfaceMaxM2);
    return matchingV5Rows.filter(
      (r) =>
        (r.grain === "building" || r.grain === "parcelle") && r.footprintSumM2 >= lo && r.footprintSumM2 <= hi
    );
  }, [matchingV5Rows, surfaceMinM2, surfaceMaxM2]);

  /** Empreintes BDNB (comme Solar Scout) : pas dans `matching-v5/features`, chargées via `buildings_json`. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const rawIds = collectBatimentIdsForMatchingV5BuildingsApi(filteredFootprints);
    const ids = rawIds.slice(0, BDNB_BUILDINGS_MAX_IDS);
    if (ids.length === 0) {
      setBdnbBuildingFeatures([]);
      return;
    }
    void (async () => {
      try {
        const byFeatId = new Map<string, GeoJSON.Feature>();
        for (let i = 0; i < ids.length; i += BDNB_BUILDINGS_CHUNK) {
          const chunk = ids.slice(i, i + BDNB_BUILDINGS_CHUNK);
          const qs = new URLSearchParams({ ids: chunk.join(",") });
          const res = await fetchWithAuth(`/api/matching-v5/buildings?${qs.toString()}`);
          if (!res.ok) {
            if (!cancelled) setBdnbBuildingFeatures([]);
            return;
          }
          const json = (await res.json()) as { features?: GeoJSON.Feature[] };
          if (cancelled) return;
          for (const f of json.features ?? []) {
            if (f.type !== "Feature" || !f.geometry) continue;
            const t = f.geometry.type;
            if (t !== "Polygon" && t !== "MultiPolygon") continue;
            const key =
              typeof f.id === "string" && f.id
                ? f.id
                : String((f.properties as Record<string, unknown> | undefined)?.batiment_construction_id ?? "");
            if (!key) continue;
            if (!byFeatId.has(key)) byFeatId.set(key, f as GeoJSON.Feature);
          }
        }
        if (!cancelled) setBdnbBuildingFeatures(Array.from(byFeatId.values()));
      } catch {
        if (!cancelled) setBdnbBuildingFeatures([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, filteredFootprints]);

  const selectedRow = useMemo(() => {
    if (!selectedRowId) return null;
    return matchingV5Rows.find((r) => r.id === selectedRowId) ?? null;
  }, [matchingV5Rows, selectedRowId]);

  /** Surbrillance carte + groupe parcelles pour le tiroir (transitif « partage » ou bâtiment multi-parcelles). */
  const discoveryLinkedParcelleRows = useMemo(() => {
    if (!selectedRow) return [];
    if (selectedRow.grain === "building") {
      return findMatchingV5ParcelleRowsForBuilding(selectedRow, matchingV5Rows);
    }
    return findMatchingV5LinkedParcelleRowsTransitive(selectedRow, matchingV5Rows);
  }, [selectedRow, matchingV5Rows]);
  const parcelleHighlightRows = discoveryLinkedParcelleRows;

  const handleDiscoveryDrawerOpenChange = useCallback(
    (open: boolean) => {
      setIsDrawerOpen(open);
      if (!open) setSelectedRowId(null);
    },
    [setIsDrawerOpen]
  );

  useEffect(() => {
    if (selectedRow) {
      setIsDrawerOpen(true);
      setDrawerContent(
        <ProspectDrawer
          prospect={null}
          discoveryRow={selectedRow}
          discoveryLinkedParcelleRows={discoveryLinkedParcelleRows}
          bdnbLoading={false}
          isOpen
          onOpenChange={handleDiscoveryDrawerOpenChange}
          voirHref={(id) => `/?prospectId=${id}`}
        />
      );
    } else {
      setIsDrawerOpen(false);
      setDrawerContent(null);
    }
  }, [selectedRow, discoveryLinkedParcelleRows, setIsDrawerOpen, setDrawerContent, handleDiscoveryDrawerOpenChange]);

  if (authLoading || !user) {
    return (
      <div className="flex h-full min-h-[50vh] w-full items-center justify-center text-muted-foreground">
        Chargement…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="relative flex-1 min-h-0 w-full min-w-0 overflow-hidden bg-white">
        <DiscoveryMapView
          className="h-full w-full rounded-none border-0 shadow-none"
          footprintRows={filteredFootprints}
          bdnbBuildingFeatures={bdnbBuildingFeatures}
          parcelleHighlightRows={parcelleHighlightRows}
          selectedRowId={selectedRowId}
          onSelectRowId={setSelectedRowId}
          onViewBoundsChange={setViewBounds}
          defaultCenter={DEFAULT_MAP_CENTER}
          defaultZoom={DEFAULT_ZOOM}
        />
        <div className="pointer-events-none absolute left-3 top-3 z-[1100] max-h-[calc(100%-1.5rem)] w-[min(18rem,calc(100vw-1.5rem))]">
          <div className="pointer-events-auto max-h-full space-y-2 overflow-y-auto overscroll-contain">
            <DiscoveryFiltersPanel
              surfaceMinM2={surfaceMinM2}
              surfaceMaxM2={surfaceMaxM2}
              onSurfaceMinChange={setSurfaceMinM2}
              onSurfaceMaxChange={setSurfaceMaxM2}
              rowCount={filteredFootprints.length}
              loading={loading}
              error={error}
            />
            <div className="rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 text-xs text-muted-foreground shadow-md backdrop-blur-sm">
              <p>
                Commune INSEE <span className="font-mono text-foreground">{DEFAULT_CODE_INSEE}</span> via Postgres.
                Fond satellite (Esri). Vert = parcelle cadastrale ; bleu ciel = empreinte BDNB. Déplacez la carte pour
                filtrer.
              </p>
              <button
                type="button"
                className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => setFetchKey((k) => k + 1)}
              >
                Rafraîchir les données
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DiscoveryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-[50vh] items-center justify-center text-muted-foreground">Chargement…</div>
      }
    >
      <DiscoveryContent />
    </Suspense>
  );
}
