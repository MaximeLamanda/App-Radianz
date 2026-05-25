"use client";

import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useDrawer } from "@/lib/drawer-context";
import { fetchWithAuth } from "@/lib/api-client";
import {
  findMatchingV5LinkedParcelleRowsTransitive,
  findMatchingV5ParcelleRowsForBuilding,
  formatV5ZoneTagLabel,
  parseMatchingV5BuildingsJson,
  collectMatchingV5BuildingFeatures,
  parseMatchingV5GeoJsonFeatureCollection,
  type ScoutMatchingV5Row,
} from "@/lib/scout-matching-v5-map";
import { buildDiscoveryComboBuildingNumberLabels, defaultDiscoveryComboBuildingSelectionIds } from "@/lib/discovery-combo-building-labels";
import {
  discoveryBuildingSelectionIdFromFeature,
  toggleDiscoveryBuildingSelection,
} from "@/lib/discovery-combo-building-selection";
import {
  applyDiscoveryParcelleEditToggle,
  emptyDiscoveryComboParcelleEditState,
  parcelleIdsForComboMerge,
  resolveDiscoveryEffectiveParcelleRows,
  type DiscoveryComboParcelleEditState,
} from "@/lib/discovery-combo-effective-parcelles";
import {
  buildParcellesAdjacentSearchParams,
  type DiscoveryAdjacentParcelle,
} from "@/lib/matching-v5-parcelles-adjacent-http";
import { adjacentParcellesToFeatureCollection } from "@/lib/discovery-adjacent-parcelles-map";
import { scoutMatchingV5RowFromAdjacentCadastreParcel } from "@/lib/discovery-cadastre-parcel";
import { collectMatchingV5ParkingFeatures } from "@/lib/matching-v5-parking";
import { useProspectsForPipeline, type MapBounds } from "@/lib/swr-hooks";
import {
  linkedParcelleRowsForV5DrawerAnchor,
  matchingV5SelectionMatchesProspect,
} from "@/lib/discovery-pipeline-match";
import { discoveryBoundsKey, discoveryDebug } from "@/lib/discovery-debug";
import {
  DISCOVERY_FEATURES_BOUNDS_PADDING,
  expandMapBounds,
} from "@/lib/discovery-viewport-bounds";
import {
  DISCOVERY_COMBOS_OVERVIEW_CLIENT_LIMIT,
  DISCOVERY_COMBOS_OVERVIEW_FETCH_DEBOUNCE_MS,
  DISCOVERY_VIEWPORT_FETCH_DEBOUNCE_MS,
  matchingDataModeFromZoom,
  isMatchingOverviewZoom,
  type DiscoveryMatchingDataMode,
} from "@/lib/discovery-zoom-modes";
import {
  buildCombosOverviewSearchParams,
  isCombosOverviewNafDivision,
  isCombosOverviewSirenExact,
  type CombosOverviewSirenRole,
} from "@/lib/discovery-combos-overview-http";
import {
  discoveryComboMarkersFromOverview,
  parseDiscoveryCombosOverviewFeatureCollection,
} from "@/lib/discovery-combos-overview";
import { shouldSkipDiscoveryFetch } from "@/lib/discovery-matching-fetch-policy";
import { ProspectDrawer } from "@/components/solar-scout/ProspectDrawer";
import type { DiscoveryOsmBuildingDisplayFilter } from "@/components/discovery/DiscoveryMvtBuildingsLayer";

/** Leaflet / react-leaflet touchent `window` à l’import — pas de bundle carte sur le SSR. */
const DiscoveryMapView = dynamic(
  () => import("@/components/discovery/DiscoveryMapView").then((m) => m.DiscoveryMapView),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-full min-h-[320px] w-full rounded-none border-0 bg-zinc-950"
        aria-hidden
      />
    ),
  }
);
import { DiscoveryFiltersPanel } from "@/components/discovery/DiscoveryFiltersPanel";
import { Spinner } from "@/components/ui/spinner";
import { DISCOVERY_FOCUS_QUERY } from "@/lib/discovery-focus-href";
import {
  DISCOVERY_FOOTPRINT_RATIO_SLIDER_DEFAULT_MAX_PCT,
  DISCOVERY_FOOTPRINT_RATIO_SLIDER_DEFAULT_MIN_PCT,
  DISCOVERY_FOOTPRINT_RATIO_SLIDER_MAX_PCT,
  isDiscoveryFootprintRatioFilterDisabled,
} from "@/lib/discovery-footprint-ratio-defaults";
import {
  DISCOVERY_PARKING_SLIDER_DEFAULT_MIN_M2,
  DISCOVERY_PARKING_SLIDER_MAX_M2,
  DISCOVERY_SURFACE_SLIDER_DEFAULT_MIN_M2,
  DISCOVERY_SURFACE_SLIDER_MAX_M2,
  discoverySurfaceRangeForApi,
} from "@/lib/discovery-surface-defaults";
import {
  discoverySurfaceHiEffective,
  isDiscoveryParkingFilterDisabled,
  isDiscoverySurfaceFilterDisabled,
} from "@/lib/discovery-footprint-landuse-waiver";
import {
  comboMeetsDiscoveryConstructionYearRange,
  DISCOVERY_CONSTRUCTION_YEAR_SLIDER_MIN,
  getDiscoveryConstructionYearSliderMax,
  isDiscoveryConstructionYearFilterDisabled,
} from "@/lib/discovery-construction-year-filter";
import {
  isValidOsmBuildingId,
  parseDiscoveryBuildingParcellesResolution,
} from "@/lib/discovery-buildings-mv";
import {
  findComboAnchorForOsmBuilding,
  resolveComboMarkerSelection,
  type DiscoveryComboMarker,
} from "@/lib/discovery-combo-markers";
import {
  comboMeetsDiscoveryActivityTag,
  countZoneTagsFromCombos,
} from "@/lib/discovery-osm-activity-tags";
import {
  buildDiscoveryNafDivisionPickerOptions,
  countNafDivisionsFromCombos,
} from "@/lib/discovery-naf-divisions";
import {
  DISCOVERY_ENEDIS_DEFAULT_MWH_MAX,
  DISCOVERY_ENEDIS_DEFAULT_MWH_MIN,
  DISCOVERY_ENEDIS_DEFAULT_YEAR,
  DISCOVERY_ENEDIS_MIN_ZOOM,
  discoveryEnedisFilterSignature,
  type DiscoveryEnedisPoint,
  type DiscoveryEnedisPointsResponse,
  type DiscoveryEnedisYear,
} from "@/lib/discovery-enedis-layer";

/** Pessac — centre carte par défaut (hors Google). */
const DEFAULT_MAP_CENTER = { lat: 44.8067, lng: -0.6311 };
const DEFAULT_ZOOM = 14;

/** Référence stable pour éviter de relancer les effets du tiroir à chaque rendu sans sélection. */
const EMPTY_DISCOVERY_LINKED_ROWS: ScoutMatchingV5Row[] = [];

function discoveryMatchingV5HttpErrorMessage(res: Response, json: unknown): string {
  if (json && typeof json === "object") {
    const o = json as { error?: unknown; detail?: unknown; code?: unknown };
    const msg = typeof o.error === "string" ? o.error : null;
    const detail = typeof o.detail === "string" ? o.detail : null;
    const code = typeof o.code === "string" ? o.code : null;
    const parts = [msg, detail, code].filter((x): x is string => Boolean(x));
    if (parts.length > 0) return parts.join(" — ");
  }
  return res.status === 500 ? "Erreur serveur (Postgres)." : `HTTP ${res.status}`;
}

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

  const onDiscoveryMatchingV5Persisted = useCallback(() => {
    forceMatchingV5FeaturesRefetchRef.current = true;
    setMatchingV5FeaturesBust((n) => n + 1);
  }, []);

  const [matchingV5Rows, setMatchingV5Rows] = useState<ScoutMatchingV5Row[]>([]);
  /** Marqueurs combo (SQL pré-agrégés + filtre surface côté API). */
  const [overviewComboMarkers, setOverviewComboMarkers] = useState<DiscoveryComboMarker[]>([]);
  const [combosOverviewLoading, setCombosOverviewLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewBounds, setViewBounds] = useState<MapBounds | null>(null);
  const [viewportZoom, setViewportZoom] = useState(DEFAULT_ZOOM);

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
  const [parkingFilterEnabled, setParkingFilterEnabled] = useState(false);
  const [surfaceMinM2, setSurfaceMinM2] = useState(DISCOVERY_SURFACE_SLIDER_DEFAULT_MIN_M2);
  const [surfaceMaxM2, setSurfaceMaxM2] = useState(DISCOVERY_SURFACE_SLIDER_MAX_M2);
  const [parkingMinM2, setParkingMinM2] = useState(DISCOVERY_PARKING_SLIDER_DEFAULT_MIN_M2);
  const [parkingMaxM2, setParkingMaxM2] = useState(DISCOVERY_PARKING_SLIDER_MAX_M2);
  const [footprintRatioMinPct, setFootprintRatioMinPct] = useState(
    DISCOVERY_FOOTPRINT_RATIO_SLIDER_DEFAULT_MIN_PCT
  );
  const [footprintRatioMaxPct, setFootprintRatioMaxPct] = useState(
    DISCOVERY_FOOTPRINT_RATIO_SLIDER_DEFAULT_MAX_PCT
  );
  const [selectedOsmActivityTag, setSelectedOsmActivityTag] = useState<string | null>(null);
  const [sirenRole, setSirenRole] = useState<CombosOverviewSirenRole>("owner");
  const [sirenQuery, setSirenQuery] = useState("");
  const [nafDivisionQuery, setNafDivisionQuery] = useState("");
  const [appliedSirenFilter, setAppliedSirenFilter] = useState<{
    role: CombosOverviewSirenRole;
    siren: string;
  } | null>(null);
  const [appliedNafDivision, setAppliedNafDivision] = useState<string | null>(null);
  const [appliedSurfaceRange, setAppliedSurfaceRange] = useState<{ min: number; max: number }>({
    min: DISCOVERY_SURFACE_SLIDER_DEFAULT_MIN_M2,
    max: DISCOVERY_SURFACE_SLIDER_MAX_M2,
  });
  const [appliedParkingRange, setAppliedParkingRange] = useState<{ min: number; max: number }>({
    min: DISCOVERY_PARKING_SLIDER_DEFAULT_MIN_M2,
    max: DISCOVERY_PARKING_SLIDER_MAX_M2,
  });
  const [appliedFootprintRatioRange, setAppliedFootprintRatioRange] = useState<{
    min: number;
    max: number;
  }>({
    min: DISCOVERY_FOOTPRINT_RATIO_SLIDER_DEFAULT_MIN_PCT,
    max: DISCOVERY_FOOTPRINT_RATIO_SLIDER_DEFAULT_MAX_PCT,
  });
  const [constructionYearMin, setConstructionYearMin] = useState(DISCOVERY_CONSTRUCTION_YEAR_SLIDER_MIN);
  const [constructionYearMax, setConstructionYearMax] = useState(() =>
    getDiscoveryConstructionYearSliderMax()
  );
  const [appliedConstructionYearRange, setAppliedConstructionYearRange] = useState(() => ({
    min: DISCOVERY_CONSTRUCTION_YEAR_SLIDER_MIN,
    max: getDiscoveryConstructionYearSliderMax(),
  }));
  const [enedisFilterEnabled, setEnedisFilterEnabled] = useState(false);
  const [enedisMwhMin, setEnedisMwhMin] = useState(DISCOVERY_ENEDIS_DEFAULT_MWH_MIN);
  const [enedisMwhMax, setEnedisMwhMax] = useState(DISCOVERY_ENEDIS_DEFAULT_MWH_MAX);
  const [enedisYear, setEnedisYear] = useState<DiscoveryEnedisYear>(DISCOVERY_ENEDIS_DEFAULT_YEAR);
  const [appliedEnedisMwhRange, setAppliedEnedisMwhRange] = useState({
    min: DISCOVERY_ENEDIS_DEFAULT_MWH_MIN,
    max: DISCOVERY_ENEDIS_DEFAULT_MWH_MAX,
  });
  const [appliedEnedisYear, setAppliedEnedisYear] = useState<DiscoveryEnedisYear>(
    DISCOVERY_ENEDIS_DEFAULT_YEAR
  );
  const [enedisPoints, setEnedisPoints] = useState<DiscoveryEnedisPoint[]>([]);
  const [enedisLoading, setEnedisLoading] = useState(false);
  const [enedisError, setEnedisError] = useState<string | null>(null);
  const [enedisTruncated, setEnedisTruncated] = useState(false);
  const [selectedEnedisId, setSelectedEnedisId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedOsmBuildingId, setSelectedOsmBuildingId] = useState<string | null>(null);
  const [selectedComboId, setSelectedComboId] = useState<string | null>(null);
  const [selectedBuildingIds, setSelectedBuildingIds] = useState<Set<string>>(() => new Set());
  const [discoveryEditMode, setDiscoveryEditMode] = useState(false);
  const [parcelleEditState, setParcelleEditState] = useState<DiscoveryComboParcelleEditState>(
    emptyDiscoveryComboParcelleEditState
  );
  const [adjacentParcelleCandidates, setAdjacentParcelleCandidates] = useState<
    DiscoveryAdjacentParcelle[]
  >([]);
  const [adjacentParcellesLoading, setAdjacentParcellesLoading] = useState(false);
  const [extraMatchingV5Rows, setExtraMatchingV5Rows] = useState<ScoutMatchingV5Row[]>([]);
  const [flyToTarget, setFlyToTarget] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);

  /** Deep link pipeline → sélection ligne après chargement des features dans la bbox. */
  const pendingFocusRowIdRef = useRef<string | null>(null);
  const appliedUrlFocusSigRef = useRef<string | null>(null);
  const focusFailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Parcelles déjà dans le périmètre au début du mode édition (exclues de l’API voisins, pas les ajouts). */
  const adjacentExcludeAtEditStartRef = useRef<string[] | null>(null);

  const handleFlyToConsumed = useCallback(() => {
    setFlyToTarget(null);
  }, []);

  /** Bbox réellement demandée à l’API après le dernier succès (viewport élargi) — hysteresis pour éviter refetch inutiles au pan. */
  const lastFeaturesQueryBoundsRef = useRef<MapBounds | null>(null);
  const lastCombosOverviewQueryBoundsRef = useRef<MapBounds | null>(null);
  const lastCombosOverviewFilterSigRef = useRef<string>("");
  /** Détecte le passage polygones → clusters pour refetch sans debounce si cache vide. */
  const wasMatchingOverviewZoomRef = useRef(isMatchingOverviewZoom(DEFAULT_ZOOM));
  /** Refs pour le fetch overview debouncé (lecture au fire du timer, pas la closure du mount). */
  const viewBoundsRef = useRef<MapBounds | null>(null);
  const viewportZoomRef = useRef(DEFAULT_ZOOM);
  /** Dernier mode fetch (overview vs detail) pour /features — un changement de zoom force un refetch même si la bbox est couverte. */
  const lastFeaturesFetchModeRef = useRef<DiscoveryMatchingDataMode | null>(null);
  /** Après PATCH POI Google : refetch même si le viewport est encore couvert par la dernière bbox. */
  const forceMatchingV5FeaturesRefetchRef = useRef(false);
  const [matchingV5FeaturesBust, setMatchingV5FeaturesBust] = useState(0);
  /**
   * Dernier filtre carte (clusters + MVT) aligné sur les features reçus.
   * Pendant un refetch `loading`, on le réutilise pour éviter `mode: "all"` (flash 16k marqueurs / polygones).
   */
  const committedOsmBuildingDisplayFilterRef = useRef<DiscoveryOsmBuildingDisplayFilter>({ mode: "all" });
  const lastEnedisQueryBoundsRef = useRef<MapBounds | null>(null);
  const lastEnedisFilterSigRef = useRef<string>("");

  useEffect(() => {
    lastFeaturesQueryBoundsRef.current = null;
    lastFeaturesFetchModeRef.current = null;
    lastCombosOverviewQueryBoundsRef.current = null;
    lastCombosOverviewFilterSigRef.current = "";
    committedOsmBuildingDisplayFilterRef.current = { mode: "all" };
    lastEnedisQueryBoundsRef.current = null;
    lastEnedisFilterSigRef.current = "";
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
    const lo = Math.min(parkingMinM2, parkingMaxM2);
    const hi = Math.max(parkingMinM2, parkingMaxM2);
    const tid = setTimeout(() => {
      setAppliedParkingRange((prev) => (prev.min === lo && prev.max === hi ? prev : { min: lo, max: hi }));
    }, 150);
    return () => clearTimeout(tid);
  }, [parkingMinM2, parkingMaxM2]);

  useEffect(() => {
    const lo = Math.min(footprintRatioMinPct, footprintRatioMaxPct);
    const hi = Math.max(footprintRatioMinPct, footprintRatioMaxPct);
    const tid = setTimeout(() => {
      setAppliedFootprintRatioRange((prev) =>
        prev.min === lo && prev.max === hi ? prev : { min: lo, max: hi }
      );
    }, 150);
    return () => clearTimeout(tid);
  }, [footprintRatioMinPct, footprintRatioMaxPct]);

  useEffect(() => {
    const lo = Math.min(constructionYearMin, constructionYearMax);
    const hi = Math.max(constructionYearMin, constructionYearMax);
    const tid = setTimeout(() => {
      setAppliedConstructionYearRange((prev) =>
        prev.min === lo && prev.max === hi ? prev : { min: lo, max: hi }
      );
    }, 150);
    return () => clearTimeout(tid);
  }, [constructionYearMin, constructionYearMax]);

  useEffect(() => {
    const lo = Math.min(enedisMwhMin, enedisMwhMax);
    const hi = Math.max(enedisMwhMin, enedisMwhMax);
    const tid = setTimeout(() => {
      setAppliedEnedisMwhRange((prev) =>
        prev.min === lo && prev.max === hi ? prev : { min: lo, max: hi }
      );
    }, 150);
    return () => clearTimeout(tid);
  }, [enedisMwhMin, enedisMwhMax]);

  useEffect(() => {
    const tid = setTimeout(() => {
      setAppliedEnedisYear((prev) => (prev === enedisYear ? prev : enedisYear));
    }, 150);
    return () => clearTimeout(tid);
  }, [enedisYear]);

  useEffect(() => {
    const tid = setTimeout(() => {
      if (isCombosOverviewSirenExact(sirenQuery)) {
        setAppliedSirenFilter((prev) =>
          prev?.role === sirenRole && prev.siren === sirenQuery
            ? prev
            : { role: sirenRole, siren: sirenQuery }
        );
      } else {
        setAppliedSirenFilter((prev) => (prev == null ? prev : null));
      }
    }, 200);
    return () => clearTimeout(tid);
  }, [sirenQuery, sirenRole]);

  useEffect(() => {
    const tid = setTimeout(() => {
      if (sirenRole === "domiciliation" && isCombosOverviewNafDivision(nafDivisionQuery)) {
        setAppliedNafDivision((prev) => (prev === nafDivisionQuery ? prev : nafDivisionQuery));
      } else {
        setAppliedNafDivision((prev) => (prev == null ? prev : null));
      }
    }, 200);
    return () => clearTimeout(tid);
  }, [nafDivisionQuery, sirenRole]);

  const onSirenRoleChange = useCallback((role: CombosOverviewSirenRole) => {
    setSirenRole(role);
    if (role === "owner") {
      setNafDivisionQuery("");
      setAppliedNafDivision(null);
    }
  }, []);

  const apiSurfaceRange = appliedSurfaceRange;

  const apiParkingRange = useMemo(
    () => discoverySurfaceRangeForApi(parkingFilterEnabled, appliedParkingRange),
    [parkingFilterEnabled, appliedParkingRange]
  );

  const apiFootprintRatioRange = appliedFootprintRatioRange;

  const appliedSurfaceCaps = useMemo(() => {
    const { min: lo, max: hi } = apiSurfaceRange;
    return { lo, hiEffective: discoverySurfaceHiEffective(hi) };
  }, [apiSurfaceRange]);

  useEffect(() => {
    viewBoundsRef.current = viewBounds;
    viewportZoomRef.current = viewportZoom;

    if (!user) return;
    if (viewBounds == null) {
      discoveryDebug("page", "matching-v5/features : attente viewBounds (pas de requête)");
      return;
    }

    let active = true;
    let fetchCancelled = false;
    const forceImmediate = forceMatchingV5FeaturesRefetchRef.current;
    const delay = forceImmediate ? 0 : DISCOVERY_VIEWPORT_FETCH_DEBOUNCE_MS;

    const tid = window.setTimeout(() => {
      const vb = viewBoundsRef.current;
      const vz = viewportZoomRef.current;
      if (!active || vb == null) return;

      const nextMode = matchingDataModeFromZoom(vz);
      const forceRefetch = forceMatchingV5FeaturesRefetchRef.current;
      if (forceRefetch) {
        forceMatchingV5FeaturesRefetchRef.current = false;
      } else if (
        shouldSkipDiscoveryFetch({
          forceRefetch: false,
          viewportBounds: vb,
          lastQueryBounds: lastFeaturesQueryBoundsRef.current,
          lastMode: lastFeaturesFetchModeRef.current,
          nextMode,
        })
      ) {
        discoveryDebug("page", "matching-v5/features : skip (viewport + mode inchangés)", {
          viewportKey: discoveryBoundsKey(vb),
          nextMode,
          lastMode: lastFeaturesFetchModeRef.current,
        });
        return;
      }

      fetchCancelled = false;
      setLoading(true);
      setError(null);
      const queryBounds = expandMapBounds(vb, DISCOVERY_FEATURES_BOUNDS_PADDING);
      const boundsKey = discoveryBoundsKey(queryBounds);
      discoveryDebug("page", "matching-v5/features : début fetch", {
        boundsKey,
        padding: DISCOVERY_FEATURES_BOUNDS_PADDING,
        mode: nextMode,
        debounceMs: delay,
      });
      void (async () => {
        try {
          const params = new URLSearchParams();
          if (nextMode === "overview") {
            params.set("mode", "overview");
            params.set("limit", "22000");
          } else {
            params.set("limit", "5000");
          }
          params.set("minLat", String(queryBounds.sw.lat));
          params.set("maxLat", String(queryBounds.ne.lat));
          params.set("minLng", String(queryBounds.sw.lng));
          params.set("maxLng", String(queryBounds.ne.lng));
          const res = await fetchWithAuth(`/api/matching-v5/features?${params.toString()}`);
          const json: unknown = await res.json().catch(() => null);
          if (!res.ok) {
            if (!fetchCancelled) {
              lastFeaturesQueryBoundsRef.current = null;
              lastFeaturesFetchModeRef.current = null;
              setError(discoveryMatchingV5HttpErrorMessage(res, json));
              setMatchingV5Rows([]);
            }
            discoveryDebug("page", "matching-v5/features : fin HTTP erreur", {
              status: res.status,
              cancelled: fetchCancelled,
            });
            return;
          }
          if (fetchCancelled) return;
          const { rows, error: parseErr } = parseMatchingV5GeoJsonFeatureCollection(json);
          if (parseErr) {
            lastFeaturesQueryBoundsRef.current = null;
            lastFeaturesFetchModeRef.current = null;
            setError(parseErr);
          } else {
            setError(null);
          }
          setMatchingV5Rows(rows);
          if (!parseErr) {
            lastFeaturesQueryBoundsRef.current = queryBounds;
            lastFeaturesFetchModeRef.current = nextMode;
          }
          discoveryDebug("page", "matching-v5/features : fin OK", {
            rowCount: rows.length,
            boundsKey,
            mode: nextMode,
          });
        } catch (e) {
          if (!fetchCancelled) {
            lastFeaturesQueryBoundsRef.current = null;
            lastFeaturesFetchModeRef.current = null;
            setError(e instanceof Error ? e.message : "Erreur réseau");
            setMatchingV5Rows([]);
          }
          discoveryDebug("page", "matching-v5/features : exception", {
            message: e instanceof Error ? e.message : e,
          });
        } finally {
          if (!fetchCancelled) setLoading(false);
        }
      })();
    }, delay);

    return () => {
      active = false;
      fetchCancelled = true;
      window.clearTimeout(tid);
      discoveryDebug("page", "matching-v5/features : cleanup (effet annulé / deps changées)");
    };
  }, [user, viewBounds, matchingV5FeaturesBust, viewportZoom]);

  /**
   * Combos pré-agrégés (surface filtrée en SQL) pour les clusters au zoom overview.
   * Refetch si bbox ou seuils surface changent (slider debouncé via appliedSurfaceRange).
   */
  useEffect(() => {
    viewBoundsRef.current = viewBounds;
    viewportZoomRef.current = viewportZoom;

    if (!user) return;
    if (viewBounds == null) return;

    const isOverview = isMatchingOverviewZoom(viewportZoom);
    const justEnteredOverview = isOverview && !wasMatchingOverviewZoomRef.current;
    wasMatchingOverviewZoomRef.current = isOverview;

    const filterSig = `${apiSurfaceRange.min}:${apiSurfaceRange.max}:${parkingFilterEnabled ? 1 : 0}:${apiParkingRange.min}:${apiParkingRange.max}:${apiFootprintRatioRange.min}:${apiFootprintRatioRange.max}:${appliedSirenFilter?.role ?? ""}:${appliedSirenFilter?.siren ?? ""}:${appliedNafDivision ?? ""}`;
    const overviewFilterChanged =
      lastCombosOverviewFilterSigRef.current !== "" &&
      lastCombosOverviewFilterSigRef.current !== filterSig;

    // Zoom détail : pas de refetch au pan seul. Toujours refetch si seuils empreinte ou parking changent.
    if (!isOverview && !overviewFilterChanged) {
      return;
    }

    let active = true;
    const debounceMs =
      justEnteredOverview || overviewFilterChanged ? 0 : DISCOVERY_COMBOS_OVERVIEW_FETCH_DEBOUNCE_MS;

    const tid = window.setTimeout(() => {
      const vb = viewBoundsRef.current;
      const vz = viewportZoomRef.current;
      if (!active || vb == null) return;
      if (!isMatchingOverviewZoom(vz) && !overviewFilterChanged) return;

      const filterSigAtFire = filterSig;
      const boundsCovered = shouldSkipDiscoveryFetch({
        forceRefetch: false,
        viewportBounds: vb,
        lastQueryBounds: lastCombosOverviewQueryBoundsRef.current,
        lastMode: "overview",
        nextMode: "overview",
      });
      if (
        boundsCovered &&
        lastCombosOverviewFilterSigRef.current === filterSigAtFire &&
        !overviewFilterChanged
      ) {
        discoveryDebug("page", "combos-overview : skip (viewport + filtres inchangés)");
        return;
      }

      const queryBounds = expandMapBounds(vb, DISCOVERY_FEATURES_BOUNDS_PADDING);
      discoveryDebug("page", "combos-overview : début fetch", {
        boundsKey: discoveryBoundsKey(queryBounds),
        filterSig: filterSigAtFire,
      });
      void (async () => {
        setCombosOverviewLoading(true);
        try {
          const params = buildCombosOverviewSearchParams({
            minLat: queryBounds.sw.lat,
            maxLat: queryBounds.ne.lat,
            minLng: queryBounds.sw.lng,
            maxLng: queryBounds.ne.lng,
            minFootprintM2: apiSurfaceRange.min,
            maxFootprintM2: apiSurfaceRange.max,
            minParkingM2: apiParkingRange.min,
            maxParkingM2: apiParkingRange.max,
            minFootprintRatioPct: apiFootprintRatioRange.min,
            maxFootprintRatioPct: apiFootprintRatioRange.max,
            sirenRole: appliedSirenFilter?.role,
            siren: appliedSirenFilter?.siren,
            nafDivision: appliedNafDivision ?? undefined,
            limit: DISCOVERY_COMBOS_OVERVIEW_CLIENT_LIMIT,
          });
          const res = await fetchWithAuth(
            `/api/matching-v5/combos-overview?${params.toString()}`
          );
          if (!res.ok) {
            if (active) {
              lastCombosOverviewQueryBoundsRef.current = null;
              lastCombosOverviewFilterSigRef.current = "";
              setOverviewComboMarkers([]);
            }
            return;
          }
          const json: unknown = await res.json();
          if (!active) return;
          const points = parseDiscoveryCombosOverviewFeatureCollection(json);
          setOverviewComboMarkers(discoveryComboMarkersFromOverview(points));
          lastCombosOverviewQueryBoundsRef.current = queryBounds;
          lastCombosOverviewFilterSigRef.current = filterSigAtFire;
          discoveryDebug("page", "combos-overview : fin OK", { count: points.length });
        } catch (e) {
          if (active) {
            lastCombosOverviewQueryBoundsRef.current = null;
            lastCombosOverviewFilterSigRef.current = "";
            setOverviewComboMarkers([]);
          }
          discoveryDebug("page", "combos-overview : exception", {
            message: e instanceof Error ? e.message : e,
          });
        } finally {
          if (active) setCombosOverviewLoading(false);
        }
      })();
    }, debounceMs);

    return () => {
      active = false;
      window.clearTimeout(tid);
    };
  }, [
    user,
    viewBounds,
    viewportZoom,
    apiSurfaceRange.min,
    apiSurfaceRange.max,
    parkingFilterEnabled,
    apiParkingRange.min,
    apiParkingRange.max,
    apiFootprintRatioRange.min,
    apiFootprintRatioRange.max,
    appliedSirenFilter?.role,
    appliedSirenFilter?.siren,
    appliedNafDivision,
  ]);

  useEffect(() => {
    if (!enedisFilterEnabled) {
      setEnedisPoints([]);
      setEnedisLoading(false);
      setEnedisError(null);
      setEnedisTruncated(false);
      setSelectedEnedisId(null);
      lastEnedisQueryBoundsRef.current = null;
      lastEnedisFilterSigRef.current = "";
      return;
    }
    if (!user || viewBounds == null || viewportZoom < DISCOVERY_ENEDIS_MIN_ZOOM) {
      setEnedisPoints([]);
      setEnedisError(
        viewBounds != null && viewportZoom < DISCOVERY_ENEDIS_MIN_ZOOM
          ? `Zoomez au-delà du niveau ${DISCOVERY_ENEDIS_MIN_ZOOM} pour afficher Enedis.`
          : null
      );
      return;
    }

    let active = true;
    const tid = window.setTimeout(() => {
      const vb = viewBounds;
      if (!active || vb == null) return;

      const filterSig = discoveryEnedisFilterSignature({
        minLat: vb.sw.lat,
        maxLat: vb.ne.lat,
        minLng: vb.sw.lng,
        maxLng: vb.ne.lng,
        mwhMin: appliedEnedisMwhRange.min,
        mwhMax: appliedEnedisMwhRange.max,
        annee: appliedEnedisYear,
      });

      setEnedisLoading(true);
      setEnedisError(null);
      const queryBounds = expandMapBounds(vb, DISCOVERY_FEATURES_BOUNDS_PADDING);

      void (async () => {
        try {
          const params = new URLSearchParams();
          params.set("minLat", String(queryBounds.sw.lat));
          params.set("maxLat", String(queryBounds.ne.lat));
          params.set("minLng", String(queryBounds.sw.lng));
          params.set("maxLng", String(queryBounds.ne.lng));
          params.set("mwhMin", String(appliedEnedisMwhRange.min));
          params.set("mwhMax", String(appliedEnedisMwhRange.max));
          params.set("annee", appliedEnedisYear);
          const res = await fetchWithAuth(`/api/discovery/enedis-points?${params.toString()}`);
          const json: unknown = await res.json().catch(() => null);
          if (!active) return;
          if (!res.ok) {
            lastEnedisQueryBoundsRef.current = null;
            lastEnedisFilterSigRef.current = "";
            setEnedisError(discoveryMatchingV5HttpErrorMessage(res, json));
            setEnedisPoints([]);
            setEnedisTruncated(false);
            return;
          }
          const body = json as DiscoveryEnedisPointsResponse;
          lastEnedisQueryBoundsRef.current = queryBounds;
          lastEnedisFilterSigRef.current = filterSig;
          const loaded = Array.isArray(body.points) ? body.points : [];
          setEnedisPoints(loaded);
          setEnedisTruncated(Boolean(body.truncated));
          setSelectedEnedisId(null);
          discoveryDebug("page", "enedis-points chargés", {
            count: loaded.length,
            truncated: Boolean(body.truncated),
            queryBounds: discoveryBoundsKey(queryBounds),
          });
        } catch {
          if (!active) return;
          lastEnedisQueryBoundsRef.current = null;
          lastEnedisFilterSigRef.current = "";
          setEnedisError("Impossible de charger les données Enedis.");
          setEnedisPoints([]);
          setEnedisTruncated(false);
        } finally {
          if (active) setEnedisLoading(false);
        }
      })();
    }, DISCOVERY_VIEWPORT_FETCH_DEBOUNCE_MS);

    return () => {
      active = false;
      window.clearTimeout(tid);
    };
  }, [
    user,
    viewBounds,
    viewportZoom,
    enedisFilterEnabled,
    appliedEnedisMwhRange.min,
    appliedEnedisMwhRange.max,
    appliedEnedisYear,
  ]);

  /**
   * Résolution `osm_building_id` → combo → parcelle ancre (MVT).
   * Clic cluster : `onSelectComboId` renseigne déjà `selectedRowId`.
   */
  useEffect(() => {
    if (!user) return;
    if (selectedOsmBuildingId == null) {
      setSelectedRowId(null);
      setSelectedComboId(null);
      return;
    }
    if (!isValidOsmBuildingId(selectedOsmBuildingId)) {
      setSelectedRowId(null);
      setSelectedComboId(null);
      return;
    }
    const ctx = findComboAnchorForOsmBuilding(matchingV5Rows, selectedOsmBuildingId);
    if (ctx) {
      setSelectedRowId(ctx.anchorParcelleId);
      setSelectedComboId(ctx.comboId);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/matching-v5/buildings/${encodeURIComponent(selectedOsmBuildingId)}/parcelles`
        );
        if (!res.ok || cancelled) return;
        const json: unknown = await res.json();
        if (cancelled) return;
        const r = parseDiscoveryBuildingParcellesResolution(json);
        if (!r || r.parcelleScoutV5Ids.length === 0) return;
        setSelectedRowId(r.parcelleScoutV5Ids[0]);
        setSelectedComboId(null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, selectedOsmBuildingId, matchingV5Rows]);

  /** Hydratation détail (polygone parcelle + building_geometries_json) après sélection en mode overview. */
  useEffect(() => {
    if (!user || !selectedRowId) return;
    const row = matchingV5Rows.find((r) => r.id === selectedRowId);
    if (!row) return;
    const needsPolygon = row.geometry.type === "Point";
    const needsBuildingGeoms = !String(row.buildingGeometriesJson ?? "").trim();
    if (!needsPolygon && !needsBuildingGeoms) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/matching-v5/features?scout_v5_id=${encodeURIComponent(selectedRowId)}&limit=1`
        );
        if (!res.ok || cancelled) return;
        const json: unknown = await res.json();
        if (cancelled) return;
        const { rows, error: parseErr } = parseMatchingV5GeoJsonFeatureCollection(json);
        if (parseErr || !rows[0]) return;
        const full = rows[0]!;
        if (needsPolygon && full.geometry.type === "Point") return;
        setMatchingV5Rows((prev) => prev.map((r) => (r.id === selectedRowId ? full : r)));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, selectedRowId, matchingV5Rows]);

  /**
   * Si la ligne canonique n'est pas dans matchingV5Rows (selectedOsmBuildingId clic hors viewport
   * features, ou parcelle absente de la dernière fetch), on la récupère ponctuellement.
   */
  useEffect(() => {
    if (!user || !selectedRowId) return;
    const has = matchingV5Rows.some((r) => r.id === selectedRowId);
    if (has) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/matching-v5/features?scout_v5_id=${encodeURIComponent(selectedRowId)}&limit=1`
        );
        if (!res.ok || cancelled) return;
        const json: unknown = await res.json();
        if (cancelled) return;
        const { rows, error: parseErr } = parseMatchingV5GeoJsonFeatureCollection(json);
        if (parseErr || !rows[0]) return;
        const full = rows[0]!;
        setMatchingV5Rows((prev) => (prev.some((r) => r.id === full.id) ? prev : [...prev, full]));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, selectedRowId, matchingV5Rows]);

  /** Comptages alignés sur les clusters SQL (viewport + filtre surface), pas sur features partielles. */
  const osmActivityOptions = useMemo(() => {
    return countZoneTagsFromCombos(overviewComboMarkers).map(({ tag, count }) => ({
      tag,
      count,
      label: formatV5ZoneTagLabel(tag) || tag,
    }));
  }, [overviewComboMarkers]);

  const nafDivisionOptions = useMemo(
    () => buildDiscoveryNafDivisionPickerOptions(countNafDivisionsFromCombos(overviewComboMarkers)),
    [overviewComboMarkers]
  );

  const hasActiveDiscoveryFilters = useMemo(() => {
    const { lo } = appliedSurfaceCaps;
    if (!isDiscoverySurfaceFilterDisabled(lo, apiSurfaceRange.max)) return true;
    if (parkingFilterEnabled) {
      const { min: pMin, max: pMax } = apiParkingRange;
      if (!isDiscoveryParkingFilterDisabled(pMin, pMax, DISCOVERY_PARKING_SLIDER_MAX_M2)) return true;
    }
    const { min: rMin, max: rMax } = apiFootprintRatioRange;
    if (!isDiscoveryFootprintRatioFilterDisabled(rMin, rMax)) return true;
    if (selectedOsmActivityTag) return true;
    if (appliedSirenFilter) return true;
    if (appliedNafDivision) return true;
    const { min: yMin, max: yMax } = appliedConstructionYearRange;
    return !isDiscoveryConstructionYearFilterDisabled(yMin, yMax);
  }, [
    appliedSurfaceCaps,
    apiSurfaceRange.max,
    parkingFilterEnabled,
    apiParkingRange,
    apiFootprintRatioRange,
    selectedOsmActivityTag,
    appliedSirenFilter,
    appliedNafDivision,
    appliedConstructionYearRange,
  ]);

  const constructionYearSliderMax = getDiscoveryConstructionYearSliderMax();

  /**
   * Clusters : `zone_tags` + `construction_years` SQL — filtres instantanés, même whitelist MVT au zoom détail.
   */
  const comboMarkers = useMemo(() => {
    const { min: yMin, max: yMax } = appliedConstructionYearRange;
    return overviewComboMarkers.filter((m) => {
      if (!comboMeetsDiscoveryActivityTag(m.zoneTags, selectedOsmActivityTag)) return false;
      return comboMeetsDiscoveryConstructionYearRange(
        m.constructionYears,
        yMin,
        yMax,
        constructionYearSliderMax
      );
    });
  }, [
    overviewComboMarkers,
    selectedOsmActivityTag,
    appliedConstructionYearRange,
    constructionYearSliderMax,
  ]);

  /**
   * Carte (clusters + MVT) : les points / tuiles ne passent pas par `filteredFootprints`.
   * On restreint l’affichage aux `osm_building_id` présents dans les lignes filtrées.
   * Pendant un refetch features (`loading`), on garde la whitelist seulement si des filtres sont encore actifs ;
   * sinon on repasse tout de suite en `all` (évite de rester bloqué sur 5 bâtiments après reset du slider).
   */
  const osmBuildingDisplayFilter = useMemo((): DiscoveryOsmBuildingDisplayFilter => {
    if (!hasActiveDiscoveryFilters) {
      const next: DiscoveryOsmBuildingDisplayFilter = { mode: "all" };
      committedOsmBuildingDisplayFilterRef.current = next;
      return next;
    }
    if (loading && matchingV5Rows.length > 0) {
      return committedOsmBuildingDisplayFilterRef.current;
    }
    const { lo } = appliedSurfaceCaps;
    const surfaceFilterActive = !isDiscoverySurfaceFilterDisabled(lo, apiSurfaceRange.max);
    const ids = new Set<string>();
    for (const m of comboMarkers) {
      for (const osmId of m.osmBuildingIds) {
        if (isValidOsmBuildingId(osmId)) ids.add(osmId);
      }
    }
    if (selectedOsmBuildingId && isValidOsmBuildingId(selectedOsmBuildingId)) {
      ids.add(selectedOsmBuildingId);
    }
    const next: DiscoveryOsmBuildingDisplayFilter = { mode: "whitelist", ids };
    if (ids.size === 0 && hasActiveDiscoveryFilters) {
      discoveryDebug(
        "page",
        "osmBuildingDisplayFilter : aucun osm_building_id visible après filtres (carte)",
        { surfaceFilterActive, comboCount: comboMarkers.length }
      );
    }
    committedOsmBuildingDisplayFilterRef.current = next;
    return next;
  }, [
    loading,
    hasActiveDiscoveryFilters,
    comboMarkers,
    appliedSurfaceCaps,
    apiSurfaceRange.max,
    selectedOsmBuildingId,
  ]);

  useEffect(() => {
    if (!selectedOsmActivityTag) return;
    if (osmActivityOptions.some((o) => o.tag === selectedOsmActivityTag)) return;
    setSelectedOsmActivityTag(null);
  }, [selectedOsmActivityTag, osmActivityOptions]);

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

  const allMatchingRowsForCombo = useMemo(() => {
    const byId = new Map<string, ScoutMatchingV5Row>();
    for (const r of matchingV5Rows) byId.set(r.id, r);
    for (const r of extraMatchingV5Rows) byId.set(r.id, r);
    return Array.from(byId.values());
  }, [matchingV5Rows, extraMatchingV5Rows]);

  const matchingLinkedForEffective = useMemo(() => {
    if (!selectedRow) return EMPTY_DISCOVERY_LINKED_ROWS;
    const mid = discoveryPipelineMatch?.matchingV5RowId;
    const persisted = discoveryPipelineMatch?.matchingV5ParcelleIds?.filter(Boolean) ?? [];
    if (persisted.length > 0) {
      const rows: ScoutMatchingV5Row[] = [];
      for (const id of persisted) {
        const r = allMatchingRowsForCombo.find((x) => x.id === id);
        if (r?.grain === "parcelle") rows.push(r);
      }
      if (rows.length > 0) return rows;
    }
    if (!mid) return discoveryLinkedParcelleRows;
    const canonical = allMatchingRowsForCombo.find((r) => r.id === mid);
    if (!canonical) return discoveryLinkedParcelleRows;
    return linkedParcelleRowsForV5DrawerAnchor(canonical, allMatchingRowsForCombo);
  }, [
    selectedRow,
    discoveryPipelineMatch,
    allMatchingRowsForCombo,
    discoveryLinkedParcelleRows,
  ]);

  /**
   * Combo effectif : matching (ou périmètre pipeline) ± édition session.
   */
  const effectiveDiscoveryLinkedParcelleRows = useMemo(() => {
    if (!selectedRow) return EMPTY_DISCOVERY_LINKED_ROWS;
    return resolveDiscoveryEffectiveParcelleRows(
      matchingLinkedForEffective,
      allMatchingRowsForCombo,
      parcelleEditState
    );
  }, [selectedRow, matchingLinkedForEffective, allMatchingRowsForCombo, parcelleEditState]);

  const effectiveParcelleIdSet = useMemo(
    () => new Set(effectiveDiscoveryLinkedParcelleRows.map((r) => r.id)),
    [effectiveDiscoveryLinkedParcelleRows]
  );

  const addableParcellesFc = useMemo(
    () =>
      discoveryEditMode
        ? adjacentParcellesToFeatureCollection(adjacentParcelleCandidates, effectiveParcelleIdSet)
        : { type: "FeatureCollection" as const, features: [] },
    [discoveryEditMode, adjacentParcelleCandidates, effectiveParcelleIdSet]
  );

  const parcelleHighlightRows = effectiveDiscoveryLinkedParcelleRows;

  /** Tags activité du combo sélectionné (overview SQL), pour le badge du tiroir. */
  const discoveryComboZoneTagsForDrawer = useMemo(() => {
    if (!selectedComboId) return null;
    const m =
      overviewComboMarkers.find((c) => c.comboId === selectedComboId) ??
      comboMarkers.find((c) => c.comboId === selectedComboId);
    return m?.zoneTags?.length ? m.zoneTags : null;
  }, [selectedComboId, overviewComboMarkers, comboMarkers]);

  const buildingHighlightFc = useMemo((): GeoJSON.FeatureCollection => {
    const features = collectMatchingV5BuildingFeatures(parcelleHighlightRows);
    if (selectedRow && !parcelleHighlightRows.some((r) => r.id === selectedRow.id)) {
      features.push(...collectMatchingV5BuildingFeatures([selectedRow]));
    }
    return { type: "FeatureCollection", features };
  }, [parcelleHighlightRows, selectedRow]);

  const buildingNumberLabels = useMemo(() => {
    if (!selectedRow) return [];
    return buildDiscoveryComboBuildingNumberLabels(
      effectiveDiscoveryLinkedParcelleRows,
      selectedRow,
      buildingHighlightFc
    );
  }, [selectedRow, effectiveDiscoveryLinkedParcelleRows, buildingHighlightFc]);

  const discoveryComboSelectionKey = selectedComboId ?? selectedRowId ?? "";

  /** Combo changé → tous les bâtiments sélectionnés par défaut (sauf périmètre pipeline déjà enregistré). */
  useLayoutEffect(() => {
    if (!selectedRow) {
      setSelectedBuildingIds(new Set());
      return;
    }
    if (discoveryPipelineMatch?.matchingV5BuildingSelectionIds?.length) return;
    setSelectedBuildingIds(
      defaultDiscoveryComboBuildingSelectionIds(
        effectiveDiscoveryLinkedParcelleRows,
        selectedRow
      )
    );
  }, [
    discoveryComboSelectionKey,
    selectedRow,
    effectiveDiscoveryLinkedParcelleRows,
    discoveryPipelineMatch?.matchingV5BuildingSelectionIds,
  ]);

  /** Géométries hydratées après coup → nouveaux bâtiments sélectionnés par défaut. */
  useEffect(() => {
    if (!selectedRow) return;
    setSelectedBuildingIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const feature of buildingHighlightFc.features) {
        const id = discoveryBuildingSelectionIdFromFeature(feature);
        if (id && !next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [buildingHighlightFc, selectedRow]);

  const onToggleDiscoveryBuilding = useCallback((selectionId: string) => {
    setSelectedBuildingIds((prev) => toggleDiscoveryBuildingSelection(prev, selectionId));
  }, []);

  const fetchMatchingRowById = useCallback(async (scoutV5Id: string): Promise<ScoutMatchingV5Row | null> => {
    try {
      const res = await fetchWithAuth(
        `/api/matching-v5/features?scout_v5_id=${encodeURIComponent(scoutV5Id)}&limit=1`
      );
      if (!res.ok) return null;
      const json = await res.json();
      const { rows, error: parseErr } = parseMatchingV5GeoJsonFeatureCollection(json);
      if (parseErr || rows.length === 0) return null;
      return rows[0] ?? null;
    } catch {
      return null;
    }
  }, []);

  const ensureMatchingRowsLoaded = useCallback(
    async (ids: readonly string[]): Promise<ScoutMatchingV5Row[]> => {
      const missing = ids.filter(
        (id) => !allMatchingRowsForCombo.some((r) => r.id === id && r.grain === "parcelle")
      );
      if (missing.length === 0) return [];
      const fetched: ScoutMatchingV5Row[] = [];
      for (const id of missing) {
        let row = await fetchMatchingRowById(id);
        if (!row) {
          const cand = adjacentParcelleCandidates.find((c) => c.scout_v5_id === id);
          if (cand) row = scoutMatchingV5RowFromAdjacentCadastreParcel(cand);
        }
        if (row) fetched.push(row);
      }
      if (fetched.length === 0) return [];
      setExtraMatchingV5Rows((prev) => {
        const byId = new Map(prev.map((r) => [r.id, r]));
        for (const r of fetched) byId.set(r.id, r);
        return Array.from(byId.values());
      });
      return fetched;
    },
    [allMatchingRowsForCombo, fetchMatchingRowById, adjacentParcelleCandidates]
  );

  const onToggleDiscoveryParcelle = useCallback(
    async (parcelleId: string, include: boolean) => {
      const candidate = adjacentParcelleCandidates.find((c) => c.scout_v5_id === parcelleId);
      let rowsPool = allMatchingRowsForCombo;

      const mergeIds =
        include && candidate?.combo_parcelle_scout_v5_ids?.length
          ? candidate.combo_parcelle_scout_v5_ids
          : parcelleIdsForComboMerge(parcelleId, rowsPool);

      if (include) {
        const missing = mergeIds.filter((id) => !rowsPool.some((r) => r.id === id));
        if (missing.length > 0) {
          const fetched = await ensureMatchingRowsLoaded(missing);
          rowsPool = rowsPool.concat(fetched);
        }
      }

      setParcelleEditState((prev) => {
        const next = applyDiscoveryParcelleEditToggle(
          prev,
          effectiveParcelleIdSet,
          rowsPool,
          parcelleId,
          include,
          include ? mergeIds : undefined
        );
        if (include && next === prev) {
          toast.info("Cette parcelle fait déjà partie du périmètre.");
          return prev;
        }
        if (include) {
          const added = mergeIds.filter((id) => !effectiveParcelleIdSet.has(id)).length;
          if (added > 0) {
            toast.success(
              added > 1
                ? `${added} parcelles ajoutées au périmètre`
                : "Parcelle ajoutée au périmètre"
            );
          }
        } else {
          toast.success("Parcelle retirée du périmètre");
        }
        return next;
      });
    },
    [
      allMatchingRowsForCombo,
      adjacentParcelleCandidates,
      effectiveParcelleIdSet,
      ensureMatchingRowsLoaded,
    ]
  );

  useEffect(() => {
    if (!discoveryEditMode) {
      adjacentExcludeAtEditStartRef.current = null;
      setAdjacentParcelleCandidates([]);
      return;
    }
    if (effectiveDiscoveryLinkedParcelleRows.length === 0) return;

    if (adjacentExcludeAtEditStartRef.current === null) {
      adjacentExcludeAtEditStartRef.current = effectiveDiscoveryLinkedParcelleRows.map((r) => r.id);
    }

    let cancelled = false;
    const ids = effectiveDiscoveryLinkedParcelleRows.map((r) => r.id);
    const sp = buildParcellesAdjacentSearchParams({
      parcelleIds: ids,
      excludeIds: adjacentExcludeAtEditStartRef.current,
      bufferM: 5,
    });
    setAdjacentParcellesLoading(true);
    void (async () => {
      try {
        const res = await fetchWithAuth(`/api/matching-v5/parcelles-adjacent?${sp.toString()}`);
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { parcelles?: DiscoveryAdjacentParcelle[] };
        if (!cancelled && Array.isArray(json.parcelles)) {
          setAdjacentParcelleCandidates(json.parcelles);
          if (json.parcelles.length === 0) {
            toast.info("Aucune parcelle cadastrale voisine trouvée à proximité.");
          }
        }
      } catch {
        if (!cancelled) {
          setAdjacentParcelleCandidates([]);
          toast.error("Impossible de charger les parcelles voisines.");
        }
      } finally {
        if (!cancelled) setAdjacentParcellesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [discoveryEditMode, discoveryComboSelectionKey, effectiveDiscoveryLinkedParcelleRows]);

  useEffect(() => {
    const persisted = discoveryPipelineMatch?.matchingV5ParcelleIds?.filter(Boolean) ?? [];
    if (persisted.length === 0 || !selectedRow) return;
    void ensureMatchingRowsLoaded(persisted);
    const matchingIds = new Set(discoveryLinkedParcelleRows.map((r) => r.id));
    const custom = new Set<string>();
    for (const id of persisted) {
      if (!matchingIds.has(id)) custom.add(id);
    }
    if (custom.size > 0) {
      setParcelleEditState({ customParcelleIds: custom, removedParcelleIds: new Set() });
    }
  }, [
    discoveryPipelineMatch?.matchingV5RowId,
    discoveryPipelineMatch?.matchingV5ParcelleIds,
    selectedRow?.id,
    discoveryLinkedParcelleRows,
    ensureMatchingRowsLoaded,
    selectedRow,
  ]);

  useEffect(() => {
    if (!discoveryPipelineMatch?.matchingV5BuildingSelectionIds?.length) return;
    setSelectedBuildingIds(new Set(discoveryPipelineMatch.matchingV5BuildingSelectionIds));
  }, [discoveryPipelineMatch?.matchingV5RowId, discoveryPipelineMatch?.matchingV5BuildingSelectionIds]);

  useEffect(() => {
    setDiscoveryEditMode(false);
    setParcelleEditState(emptyDiscoveryComboParcelleEditState());
    setAdjacentParcelleCandidates([]);
    setExtraMatchingV5Rows([]);
    adjacentExcludeAtEditStartRef.current = null;
  }, [discoveryComboSelectionKey]);

  const parkingHighlightFc = useMemo((): GeoJSON.FeatureCollection => {
    const rows = [...parcelleHighlightRows];
    if (selectedRow && !rows.some((r) => r.id === selectedRow.id)) {
      rows.push(selectedRow);
    }
    return { type: "FeatureCollection", features: collectMatchingV5ParkingFeatures(rows) };
  }, [parcelleHighlightRows, selectedRow]);

  const handleDiscoveryDrawerOpenChange = useCallback(
    (open: boolean) => {
      setIsDrawerOpen(open);
      if (!open) {
        setSelectedOsmBuildingId(null);
        setSelectedComboId(null);
        setSelectedRowId(null);
        setDiscoveryEditMode(false);
        setParcelleEditState(emptyDiscoveryComboParcelleEditState());
        setAdjacentParcelleCandidates([]);
      }
    },
    [setIsDrawerOpen]
  );

  /**
   * Tiroir synchronisé sur la sélection, en useLayoutEffect (avant peinture) pour limiter le décalage visuel.
   * Ne pas ouvrir le tiroir dans le handler Leaflet : mettre à jour le contexte drawer dans le même tour que
   * le clic provoquait un re-render qui cassait la prise en compte des clics.
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
        discoveryComboZoneTags={discoveryComboZoneTagsForDrawer}
        discoveryExistingPipelineProspect={discoveryPipelineMatch}
        discoverySelectedBuildingIds={selectedBuildingIds}
        onDiscoveryToggleBuilding={onToggleDiscoveryBuilding}
        discoveryEditMode={discoveryEditMode}
        onDiscoveryEditModeChange={setDiscoveryEditMode}
        discoveryEffectiveParcelleCount={effectiveDiscoveryLinkedParcelleRows.length}
        bdnbLoading={false}
        isOpen
        onOpenChange={handleDiscoveryDrawerOpenChange}
        voirHref={(_prospectId) => "/discovery"}
        onDiscoveryPipelineAdded={onDiscoveryPipelineAdded}
        onDiscoveryMatchingV5Persisted={onDiscoveryMatchingV5Persisted}
      />
    );
  }, [
    selectedRow,
    effectiveDiscoveryLinkedParcelleRows,
    discoveryComboZoneTagsForDrawer,
    discoveryPipelineMatch,
    selectedBuildingIds,
    onToggleDiscoveryBuilding,
    discoveryEditMode,
    effectiveDiscoveryLinkedParcelleRows.length,
    setIsDrawerOpen,
    setDrawerContent,
    handleDiscoveryDrawerOpenChange,
    onDiscoveryPipelineAdded,
    onDiscoveryMatchingV5Persisted,
  ]);

  const onDiscoveryViewportZoomChange = useCallback((z: number) => {
    setViewportZoom((prev) => (prev === z ? prev : z));
  }, []);

  const onSelectOsmBuildingId = useCallback((id: string | null) => {
    setSelectedOsmBuildingId(id);
    if (id == null) setSelectedComboId(null);
  }, []);

  const onSelectComboId = useCallback(
    (comboId: string | null) => {
      setSelectedComboId(comboId);
      if (comboId == null) {
        setSelectedOsmBuildingId(null);
        setSelectedRowId(null);
        return;
      }
      const sel = resolveComboMarkerSelection(comboId, comboMarkers);
      if (sel) {
        setSelectedRowId(sel.anchorParcelleId);
        setSelectedOsmBuildingId(sel.representativeOsmBuildingId || null);
        return;
      }
      if (isValidOsmBuildingId(comboId)) {
        setSelectedOsmBuildingId(comboId);
        setSelectedRowId(null);
        return;
      }
      setSelectedRowId(null);
      setSelectedOsmBuildingId(null);
    },
    [comboMarkers]
  );

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
          comboMarkers={comboMarkers}
          osmBuildingDisplayFilter={osmBuildingDisplayFilter}
          parcelleHighlightRows={parcelleHighlightRows}
          buildingHighlightFc={buildingHighlightFc}
          buildingNumberLabels={buildingNumberLabels}
          selectedBuildingIds={selectedBuildingIds}
          onToggleDiscoveryBuilding={onToggleDiscoveryBuilding}
          discoveryEditMode={discoveryEditMode}
          addableParcellesFc={addableParcellesFc}
          onToggleAdjacentParcelle={onToggleDiscoveryParcelle}
          adjacentParcellesLoading={adjacentParcellesLoading}
          effectiveParcelleIds={effectiveParcelleIdSet}
          parkingHighlightFc={parkingHighlightFc}
          selectedOsmBuildingId={selectedOsmBuildingId}
          selectedComboId={selectedComboId}
          onSelectComboId={onSelectComboId}
          onSelectOsmBuildingId={onSelectOsmBuildingId}
          onViewBoundsChange={onViewBoundsChange}
          onViewportZoomChange={onDiscoveryViewportZoomChange}
          defaultCenter={DEFAULT_MAP_CENTER}
          defaultZoom={DEFAULT_ZOOM}
          flyTo={flyToTarget}
          onFlyToConsumed={handleFlyToConsumed}
          enedisPoints={enedisFilterEnabled ? enedisPoints : []}
          selectedEnedisId={selectedEnedisId}
          onSelectEnedisId={setSelectedEnedisId}
        />
        {combosOverviewLoading && isMatchingOverviewZoom(viewportZoom) ? (
          <div
            className="pointer-events-none absolute inset-0 z-[1050] flex items-center justify-center"
            role="status"
            aria-live="polite"
            aria-label="Chargement des clusters"
          >
            <div className="pointer-events-none flex size-10 items-center justify-center rounded-full border border-border bg-card/90 shadow-lg backdrop-blur-sm">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          </div>
        ) : null}
        <div className="pointer-events-none absolute left-3 top-3 z-[1100] max-h-[calc(100%-1.5rem)] w-[min(18rem,calc(100vw-1.5rem))]">
          <div className="pointer-events-auto max-h-full overflow-y-auto overscroll-contain">
            <DiscoveryFiltersPanel
              surfaceMinM2={surfaceMinM2}
              surfaceMaxM2={surfaceMaxM2}
              onSurfaceMinChange={setSurfaceMinM2}
              onSurfaceMaxChange={setSurfaceMaxM2}
              parkingFilterEnabled={parkingFilterEnabled}
              onParkingFilterEnabledChange={setParkingFilterEnabled}
              parkingMinM2={parkingMinM2}
              parkingMaxM2={parkingMaxM2}
              onParkingMinChange={setParkingMinM2}
              onParkingMaxChange={setParkingMaxM2}
              footprintRatioMinPct={footprintRatioMinPct}
              footprintRatioMaxPct={footprintRatioMaxPct}
              onFootprintRatioMinChange={setFootprintRatioMinPct}
              onFootprintRatioMaxChange={setFootprintRatioMaxPct}
              constructionYearMin={constructionYearMin}
              constructionYearMax={constructionYearMax}
              onConstructionYearMinChange={setConstructionYearMin}
              onConstructionYearMaxChange={setConstructionYearMax}
              osmActivityOptions={osmActivityOptions}
              selectedOsmActivityTag={selectedOsmActivityTag}
              onSelectedOsmActivityTagChange={setSelectedOsmActivityTag}
              sirenRole={sirenRole}
              onSirenRoleChange={onSirenRoleChange}
              sirenQuery={sirenQuery}
              onSirenQueryChange={setSirenQuery}
              nafDivisionQuery={nafDivisionQuery}
              onNafDivisionQueryChange={setNafDivisionQuery}
              nafDivisionOptions={nafDivisionOptions}
              rowCount={comboMarkers.length}
              loading={combosOverviewLoading}
              error={error}
              enedisFilterEnabled={enedisFilterEnabled}
              onEnedisFilterEnabledChange={setEnedisFilterEnabled}
              enedisMwhMin={enedisMwhMin}
              enedisMwhMax={enedisMwhMax}
              onEnedisMwhMinChange={setEnedisMwhMin}
              onEnedisMwhMaxChange={setEnedisMwhMax}
              enedisYear={enedisYear}
              onEnedisYearChange={setEnedisYear}
              enedisPointCount={enedisPoints.length}
              enedisLoading={enedisLoading}
              enedisError={enedisError}
              enedisTruncated={enedisTruncated}
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
