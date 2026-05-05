"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
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
import { useProspectsForPipeline, type MapBounds } from "@/lib/swr-hooks";
import {
  linkedParcelleRowsForV5DrawerAnchor,
  matchingV5SelectionMatchesProspect,
} from "@/lib/discovery-pipeline-match";
import { discoveryBoundsKey, discoveryDebug } from "@/lib/discovery-debug";
import {
  DISCOVERY_FEATURES_BOUNDS_PADDING,
  expandMapBounds,
  filterScoutMatchingV5RowsByMapBounds,
  viewportContainedInQueryBounds,
} from "@/lib/discovery-viewport-bounds";
import { ProspectDrawer } from "@/components/solar-scout/ProspectDrawer";
import { DiscoveryMapView } from "@/components/discovery/DiscoveryMapView";
import { DiscoveryFiltersPanel } from "@/components/discovery/DiscoveryFiltersPanel";
import { DISCOVERY_FOCUS_QUERY } from "@/lib/discovery-focus-href";

const DEFAULT_CODE_INSEE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SCOUT_MATCHING_V5_CODE_INSEE?.trim()) || "33318";

/** Pessac — centre carte par défaut (hors Google). */
const DEFAULT_MAP_CENTER = { lat: 44.8067, lng: -0.6311 };
const DEFAULT_ZOOM = 14;

/** Limite `/api/matching-v5/buildings` (ids par requête côté route ~300). */
const BDNB_BUILDINGS_CHUNK = 280;
const BDNB_BUILDINGS_MAX_IDS = 600;
/** Marge autour du viewport pour les ids BDNB (évite les bords « sans bâtiment »). */
const BDNB_VIEWPORT_PADDING = 0.14;

/** Référence stable pour éviter de relancer les effets du tiroir à chaque rendu sans sélection. */
const EMPTY_DISCOVERY_LINKED_ROWS: ScoutMatchingV5Row[] = [];

function DiscoveryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { data: pipelineProspects } = useProspectsForPipeline(user?.uid ?? null);
  const { setIsDrawerOpen, setDrawerContent } = useDrawer();

  /** Évite d’importer `swr` au niveau module (prérendu `/discovery`). */
  const onDiscoveryPipelineAdded = useCallback(() => {
    const uid = user?.uid;
    if (!uid || typeof window === "undefined") return;
    void import("swr").then(({ mutate }) => {
      void mutate(["pipeline-prospects", uid]);
    });
  }, [user?.uid]);

  const [matchingV5Rows, setMatchingV5Rows] = useState<ScoutMatchingV5Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewBounds, setViewBounds] = useState<MapBounds | null>(null);

  const onViewBoundsChange = useCallback((next: MapBounds | null) => {
    const key = discoveryBoundsKey(next);
    discoveryDebug("page", "onViewBoundsChange (carte)", { key });
    setViewBounds((prev) => {
      if (discoveryBoundsKey(prev) === key) {
        discoveryDebug("page", "viewBounds identique → pas de setState", { key });
        return prev;
      }
      return next;
    });
  }, []);
  const [surfaceMinM2, setSurfaceMinM2] = useState(0);
  const [surfaceMaxM2, setSurfaceMaxM2] = useState(50_000);
  const [appliedSurfaceRange, setAppliedSurfaceRange] = useState<{ min: number; max: number }>({
    min: 0,
    max: 50_000,
  });
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [bdnbBuildingFeatures, setBdnbBuildingFeatures] = useState<GeoJSON.Feature[]>([]);

  /** Deep link pipeline → sélection ligne après chargement des features dans la bbox. */
  const pendingFocusRowIdRef = useRef<string | null>(null);
  const appliedUrlFocusSigRef = useRef<string | null>(null);
  const focusFailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFlyToConsumed = useCallback(() => {
    setFlyToTarget(null);
  }, []);

  /** Bbox réellement demandée à l’API après le dernier succès (viewport élargi) — hysteresis pour éviter refetch inutiles au pan. */
  const lastSuccessfulQueryBoundsRef = useRef<MapBounds | null>(null);

  useEffect(() => {
    lastSuccessfulQueryBoundsRef.current = null;
  }, [user?.uid]);

  useEffect(() => {
    return () => {
      if (focusFailTimerRef.current) {
        clearTimeout(focusFailTimerRef.current);
        focusFailTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const row = searchParams.get(DISCOVERY_FOCUS_QUERY.focusRow);
    const latS = searchParams.get(DISCOVERY_FOCUS_QUERY.lat);
    const lngS = searchParams.get(DISCOVERY_FOCUS_QUERY.lng);
    if (!row || !latS || !lngS) return;
    const lat = Number(latS);
    const lng = Number(lngS);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const sig = `${row}\0${lat}\0${lng}`;
    if (appliedUrlFocusSigRef.current === sig) return;
    appliedUrlFocusSigRef.current = sig;
    pendingFocusRowIdRef.current = row;
    if (focusFailTimerRef.current) {
      clearTimeout(focusFailTimerRef.current);
      focusFailTimerRef.current = null;
    }
    setFlyToTarget({ lat, lng, zoom: 17 });
    router.replace("/discovery", { scroll: false });
    const pendingRow = row;
    focusFailTimerRef.current = setTimeout(() => {
      focusFailTimerRef.current = null;
      if (pendingFocusRowIdRef.current === pendingRow) {
        toast.error("Emprise introuvable dans la zone chargée", {
          description: "Déplacez la carte ou vérifiez que le lead correspond toujours à l’export.",
        });
        pendingFocusRowIdRef.current = null;
        setFlyToTarget(null);
      }
    }, 20_000);
  }, [searchParams, router]);

  useEffect(() => {
    const id = pendingFocusRowIdRef.current;
    if (!id) return;
    if (!matchingV5Rows.some((r) => r.id === id)) return;
    setSelectedRowId(id);
    pendingFocusRowIdRef.current = null;
    if (focusFailTimerRef.current) {
      clearTimeout(focusFailTimerRef.current);
      focusFailTimerRef.current = null;
    }
  }, [matchingV5Rows]);

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
    const lo = Math.min(surfaceMinM2, surfaceMaxM2);
    const hi = Math.max(surfaceMinM2, surfaceMaxM2);
    const tid = setTimeout(() => {
      setAppliedSurfaceRange((prev) => (prev.min === lo && prev.max === hi ? prev : { min: lo, max: hi }));
    }, 150);
    return () => clearTimeout(tid);
  }, [surfaceMinM2, surfaceMaxM2]);

  useEffect(() => {
    if (!user) return;
    if (viewBounds == null) {
      discoveryDebug("page", "matching-v5/features : attente viewBounds (pas de requête)");
      return;
    }
    const covered = lastSuccessfulQueryBoundsRef.current;
    if (covered != null && viewportContainedInQueryBounds(viewBounds, covered)) {
      discoveryDebug("page", "matching-v5/features : skip (viewport couvert par dernière requête)", {
        viewportKey: discoveryBoundsKey(viewBounds),
        coveredKey: discoveryBoundsKey(covered),
      });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    /** Bbox envoyée à l’API (viewport + marge). Avec `limit`, une vue très large peut toujours tronquer côté serveur. */
    const queryBounds = expandMapBounds(viewBounds, DISCOVERY_FEATURES_BOUNDS_PADDING);
    const boundsKey = discoveryBoundsKey(queryBounds);
    discoveryDebug("page", "matching-v5/features : début fetch", {
      boundsKey,
      padding: DISCOVERY_FEATURES_BOUNDS_PADDING,
    });
    void (async () => {
      try {
        const params = new URLSearchParams({
          code_insee: DEFAULT_CODE_INSEE,
          limit: "4000",
        });
        params.set("minLat", String(queryBounds.sw.lat));
        params.set("maxLat", String(queryBounds.ne.lat));
        params.set("minLng", String(queryBounds.sw.lng));
        params.set("maxLng", String(queryBounds.ne.lng));
        const res = await fetchWithAuth(`/api/matching-v5/features?${params.toString()}`);
        if (!res.ok) {
          if (!cancelled) {
            lastSuccessfulQueryBoundsRef.current = null;
            setError(res.status === 500 ? "Erreur serveur (Postgres)." : `HTTP ${res.status}`);
            setMatchingV5Rows([]);
          }
          discoveryDebug("page", "matching-v5/features : fin HTTP erreur", { status: res.status, cancelled });
          return;
        }
        const json: unknown = await res.json();
        if (cancelled) return;
        const { rows, error: parseErr } = parseMatchingV5GeoJsonFeatureCollection(json);
        if (parseErr) {
          lastSuccessfulQueryBoundsRef.current = null;
          setError(parseErr);
        } else {
          setError(null);
        }
        setMatchingV5Rows(rows);
        if (!parseErr) {
          lastSuccessfulQueryBoundsRef.current = queryBounds;
        }
        discoveryDebug("page", "matching-v5/features : fin OK", { rowCount: rows.length, boundsKey });
      } catch (e) {
        if (!cancelled) {
          lastSuccessfulQueryBoundsRef.current = null;
          setError(e instanceof Error ? e.message : "Erreur réseau");
          setMatchingV5Rows([]);
        }
        discoveryDebug("page", "matching-v5/features : exception", { message: e instanceof Error ? e.message : e });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      discoveryDebug("page", "matching-v5/features : cleanup (effet annulé / deps changées)");
    };
  }, [user, viewBounds]);

  /** Postgres exporte surtout des parcelles (empreinte Σ bâtiments) ; les lignes `building` sont optionnelles (pipeline --include-building-grain). */
  const filteredFootprints = useMemo(() => {
    const { min: lo, max: hi } = appliedSurfaceRange;
    return matchingV5Rows.filter(
      (r) =>
        (r.grain === "building" || r.grain === "parcelle") && r.footprintSumM2 >= lo && r.footprintSumM2 <= hi
    );
  }, [matchingV5Rows, appliedSurfaceRange]);

  /**
   * Bâtiments BDNB : plafond d’ids global sur tout l’export → sans filtre viewport, une zone restait sans
   * polygones. On ne collecte les ids que pour les empreintes qui intersectent la vue (+ marge).
   */
  const filteredFootprintsForBdnb = useMemo(() => {
    if (!viewBounds || filteredFootprints.length === 0) return filteredFootprints;
    const inView = filterScoutMatchingV5RowsByMapBounds(filteredFootprints, viewBounds, BDNB_VIEWPORT_PADDING);
    return inView.length > 0 ? inView : filteredFootprints;
  }, [filteredFootprints, viewBounds]);

  /** Empreintes BDNB (comme Solar Scout) : pas dans `matching-v5/features`, chargées via `buildings_json`. */
  const lastBdnbIdsPackRef = useRef<string>("");
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const rawIds = collectBatimentIdsForMatchingV5BuildingsApi(filteredFootprintsForBdnb);
    const ids = rawIds.slice(0, BDNB_BUILDINGS_MAX_IDS);
    if (ids.length === 0) {
      lastBdnbIdsPackRef.current = "";
      discoveryDebug("page", "BDNB buildings : aucun id, reset features");
      setBdnbBuildingFeatures([]);
      return;
    }
    const viewKey = viewBounds ? discoveryBoundsKey(viewBounds) : "noview";
    const idsPack = `${viewKey}\0${[...ids].sort().join("\0")}`;
    if (idsPack === lastBdnbIdsPackRef.current) {
      discoveryDebug("page", "BDNB buildings : skip fetch (même jeu d’ids bâtiments)", { idCount: ids.length });
      return;
    }
    discoveryDebug("page", "BDNB buildings : début fetch", {
      idCount: ids.length,
      footprintCount: filteredFootprintsForBdnb.length,
      viewKey,
    });
    void (async () => {
      try {
        const byFeatId = new Map<string, GeoJSON.Feature>();
        for (let i = 0; i < ids.length; i += BDNB_BUILDINGS_CHUNK) {
          const chunk = ids.slice(i, i + BDNB_BUILDINGS_CHUNK);
          const qs = new URLSearchParams({ ids: chunk.join(",") });
          const res = await fetchWithAuth(`/api/matching-v5/buildings?${qs.toString()}`);
          if (!res.ok) {
            if (!cancelled) {
              setBdnbBuildingFeatures([]);
              lastBdnbIdsPackRef.current = "";
            }
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
        if (!cancelled) {
          const feats = Array.from(byFeatId.values());
          setBdnbBuildingFeatures(feats);
          lastBdnbIdsPackRef.current = idsPack;
          discoveryDebug("page", "BDNB buildings : fin OK", { featureCount: feats.length });
        }
      } catch {
        if (!cancelled) {
          setBdnbBuildingFeatures([]);
          lastBdnbIdsPackRef.current = "";
        }
        discoveryDebug("page", "BDNB buildings : erreur réseau ou parse");
      }
    })();
    return () => {
      cancelled = true;
      discoveryDebug("page", "BDNB buildings : cleanup effet");
    };
  }, [user, filteredFootprintsForBdnb, viewBounds]);

  const selectedRow = useMemo(() => {
    if (!selectedRowId) return null;
    return matchingV5Rows.find((r) => r.id === selectedRowId) ?? null;
  }, [matchingV5Rows, selectedRowId]);

  /** Surbrillance carte + groupe parcelles pour le tiroir (transitif « partage » ou bâtiment multi-parcelles). */
  const discoveryLinkedParcelleRows = useMemo(() => {
    if (!selectedRow) return EMPTY_DISCOVERY_LINKED_ROWS;
    if (selectedRow.grain === "building") {
      return findMatchingV5ParcelleRowsForBuilding(selectedRow, matchingV5Rows);
    }
    return findMatchingV5LinkedParcelleRowsTransitive(selectedRow, matchingV5Rows);
  }, [selectedRow, matchingV5Rows]);

  /** Prospect pipeline déjà créé pour cette emprise (même matching V5). */
  const discoveryPipelineMatch = useMemo(() => {
    if (!selectedRow || !pipelineProspects?.length) return null;
    for (const p of pipelineProspects) {
      if (
        matchingV5SelectionMatchesProspect(selectedRow, discoveryLinkedParcelleRows, matchingV5Rows, p)
      ) {
        return p;
      }
    }
    return null;
  }, [selectedRow, discoveryLinkedParcelleRows, matchingV5Rows, pipelineProspects]);

  /**
   * Si le lead existe déjà : surbrillance + tiroir alignés sur la ligne enregistrée (ex. bâtiment vs parcelle).
   */
  const effectiveDiscoveryLinkedParcelleRows = useMemo(() => {
    if (!selectedRow) return EMPTY_DISCOVERY_LINKED_ROWS;
    const mid = discoveryPipelineMatch?.matchingV5RowId;
    if (!mid) return discoveryLinkedParcelleRows;
    const canonical = matchingV5Rows.find((r) => r.id === mid);
    if (!canonical) return discoveryLinkedParcelleRows;
    return linkedParcelleRowsForV5DrawerAnchor(canonical, matchingV5Rows);
  }, [selectedRow, discoveryPipelineMatch, matchingV5Rows, discoveryLinkedParcelleRows]);

  const parcelleHighlightRows = effectiveDiscoveryLinkedParcelleRows;

  const handleDiscoveryDrawerOpenChange = useCallback(
    (open: boolean) => {
      setIsDrawerOpen(open);
      if (!open) setSelectedRowId(null);
    },
    [setIsDrawerOpen]
  );

  /**
   * Tiroir synchronisé sur la sélection, en useLayoutEffect (avant peinture) pour limiter le décalage visuel.
   * Ne pas ouvrir le tiroir dans le handler Leaflet : mettre à jour le contexte drawer dans le même tour que
   * le clic provoquait un re-render qui cassait la prise en compte des clics (ex. bâtiments BDNB).
   */
  useLayoutEffect(() => {
    if (!selectedRow) {
      setIsDrawerOpen(false);
      setDrawerContent(null);
      return;
    }
    setIsDrawerOpen(true);
    setDrawerContent(
      <ProspectDrawer
        prospect={null}
        discoveryRow={selectedRow}
        discoveryLinkedParcelleRows={effectiveDiscoveryLinkedParcelleRows}
        discoveryExistingPipelineProspect={discoveryPipelineMatch}
        bdnbLoading={false}
        isOpen
        onOpenChange={handleDiscoveryDrawerOpenChange}
        voirHref={(_prospectId) => "/discovery"}
        onDiscoveryPipelineAdded={onDiscoveryPipelineAdded}
      />
    );
  }, [
    selectedRow,
    effectiveDiscoveryLinkedParcelleRows,
    discoveryPipelineMatch,
    setIsDrawerOpen,
    setDrawerContent,
    handleDiscoveryDrawerOpenChange,
    onDiscoveryPipelineAdded,
  ]);

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
          onViewBoundsChange={onViewBoundsChange}
          defaultCenter={DEFAULT_MAP_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          flyTo={flyToTarget}
          onFlyToConsumed={handleFlyToConsumed}
        />
        <div className="pointer-events-none absolute left-3 top-3 z-[1100] max-h-[calc(100%-1.5rem)] w-[min(18rem,calc(100vw-1.5rem))]">
          <div className="pointer-events-auto max-h-full overflow-y-auto overscroll-contain">
            <DiscoveryFiltersPanel
              surfaceMinM2={surfaceMinM2}
              surfaceMaxM2={surfaceMaxM2}
              onSurfaceMinChange={setSurfaceMinM2}
              onSurfaceMaxChange={setSurfaceMaxM2}
              rowCount={filteredFootprints.length}
              loading={loading}
              error={error}
            />
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
