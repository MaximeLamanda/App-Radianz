"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { GeoJSON, useMap, useMapEvents } from "react-leaflet";
import { cn } from "@/lib/utils";
import {
  ESRI_WORLD_IMAGERY_ATTRIBUTION,
  ESRI_WORLD_IMAGERY_URL,
  Map,
  MapMarker,
  MapMarkerClusterGroup,
  MapTileLayer,
  MapZoomControl,
} from "@/components/ui/map";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";
import type { MapBounds } from "@/lib/swr-hooks";
import { discoveryBoundsKey, discoveryDebug } from "@/lib/discovery-debug";
import { BRAND_INK } from "@/lib/brand-colors";
import {
  DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM,
  DISCOVERY_VIEWPORT_FETCH_DEBOUNCE_MS,
} from "@/lib/discovery-zoom-modes";
import { DiscoveryMvtBuildingsLayer, type DiscoveryOsmBuildingDisplayFilter } from "@/components/discovery/DiscoveryMvtBuildingsLayer";
import { DiscoveryEnedisConsumptionLayer } from "@/components/discovery/DiscoveryEnedisConsumptionLayer";
import type { DiscoveryEnedisPoint } from "@/lib/discovery-enedis-layer";
import type { DiscoveryComboMarker } from "@/lib/discovery-combo-markers";
import {
  simplifyFeatureCollectionForMapDisplay,
  toleranceDegForParcelHighlightZoom,
} from "@/lib/geojson-simplify-display";
import { parkingSourceFromFeatureProps, parkingSourceHoverText } from "@/lib/matching-v5-parking";
import type { DiscoveryComboBuildingNumberLabel } from "@/lib/discovery-combo-building-labels";
import { DiscoveryComboBuildingNumberLabelsLayer } from "@/components/discovery/DiscoveryComboBuildingNumberLabelsLayer";
import {
  discoveryBuildingSelectionIdFromFeature,
  isDiscoveryBuildingSelected,
} from "@/lib/discovery-combo-building-selection";

/**
 * Empilement des panes Leaflet — overlayPane par défaut = 400.
 * - Cadastre / parcelle (surcouche sélection) restent en dessous des bâtiments.
 * - La couche MVT bâtiments est dessinée par-dessus.
 */
const PANE_CADASTRE_HL = "discoveryCadastreHl";
const PANE_PARKING_HL = "discoveryParkingHl";
const PANE_SELECTED_PARCELLE = "discoverySelectedParcelle";
const PANE_FP_BUILDING = "discoveryFpBuilding";
/** Au-dessus des empreintes MVT pour recevoir les clics en mode édition combo. */
const PANE_ADDABLE_PARCELLE = "discoveryAddableParcelle";

/**
 * Marqueurs + clusters isolés dans un `memo` : les mises à jour bounds/zoom parent ne re-rendent pas
 * toute la couche tant que la liste des points est inchangée. Couleurs des clusters = défaut
 * Leaflet.markercluster (cf. exemple shadcn-map sans prop `icon`).
 */
const DiscoveryClusteredBuildings = memo(function DiscoveryClusteredBuildings({
  markers,
  selectedComboId,
  onSelectRef,
}: {
  markers: readonly { id: string; position: L.LatLngExpression }[];
  selectedComboId: string | null;
  onSelectRef: React.RefObject<(comboId: string | null) => void>;
}) {
  useEffect(() => {
    const first = markers[0]?.id;
    const last = markers.length > 0 ? markers[markers.length - 1]?.id : undefined;
    discoveryDebug("map", "DiscoveryClusteredBuildings (marqueurs cluster)", {
      markerCount: markers.length,
      firstId: first,
      lastId: last,
    });
  }, [markers]);

  return (
    <MapMarkerClusterGroup
      showCoverageOnHover={false}
      removeOutsideVisibleBounds
      maxClusterRadius={64}
      spiderfyOnMaxZoom={false}
      chunkedLoading
      chunkInterval={200}
      chunkDelay={50}
    >
      {markers.map((m) => (
        <MapMarker
          key={m.id}
          position={m.position}
          selected={selectedComboId === m.id}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              onSelectRef.current?.(m.id);
            },
          }}
        />
      ))}
    </MapMarkerClusterGroup>
  );
});

function DiscoveryMapZoomBridge({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap();
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  useEffect(() => {
    const z = map.getZoom();
    discoveryDebug("map", "zoom bridge → sync initial", { z });
    onZoomRef.current(z);
  }, [map]);
  useMapEvents({
    zoomend: () => {
      const z = map.getZoom();
      discoveryDebug("map", "zoom bridge → zoomend", { z });
      onZoomRef.current(z);
    },
  });
  return null;
}

function DiscoveryMapVectorPanes() {
  const map = useMap();
  useLayoutEffect(() => {
    /**
     * Cadastre / parcelle sélectionnée sous 400 (overlayPane), bâtiments au-dessus pour rester
     * visibles au-dessus des polygones parcelle.
     */
    const defs: Array<[string, number]> = [
      [PANE_CADASTRE_HL, 340],
      [PANE_PARKING_HL, 360],
      [PANE_SELECTED_PARCELLE, 370],
      [PANE_FP_BUILDING, 430],
      [PANE_ADDABLE_PARCELLE, 500],
    ];
    for (const [name, z] of defs) {
      const pane = map.getPane(name) ?? map.createPane(name);
      pane.style.zIndex = String(z);
      pane.style.pointerEvents = "auto";
    }
  }, [map]);
  return null;
}

function rowsToFeatureCollection(rows: ScoutMatchingV5Row[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature" as const,
      id: r.id,
      properties: { id: r.id, grain: r.grain },
      geometry: r.geometry,
    })),
  };
}

/** Polygone(s) parking OSM liés au bâtiment sélectionné. */
const selectedParkingPathOsm: L.PathOptions = {
  color: "#d97706",
  weight: 2,
  opacity: 0.95,
  fillColor: "#fbbf24",
  fillOpacity: 0.28,
  pane: PANE_PARKING_HL,
  interactive: true,
};

const selectedParkingPathEnr: L.PathOptions = {
  color: "#0369a1",
  weight: 2,
  opacity: 0.95,
  fillColor: "#38bdf8",
  fillOpacity: 0.26,
  pane: PANE_PARKING_HL,
  interactive: true,
};

function parkingHighlightStyle(feature?: GeoJSON.Feature): L.PathOptions {
  const props = feature?.properties as Record<string, unknown> | undefined;
  return parkingSourceFromFeatureProps(props) === "enr" ? selectedParkingPathEnr : selectedParkingPathOsm;
}

function bindParkingHighlightTooltip(feature: GeoJSON.Feature, layer: L.Layer): void {
  if (!("bindTooltip" in layer) || typeof (layer as L.Path).bindTooltip !== "function") return;
  const props = feature.properties as Record<string, unknown> | undefined;
  const source = parkingSourceFromFeatureProps(props);
  (layer as L.Path).bindTooltip(parkingSourceHoverText(source), { sticky: true });
}

/** Parcelle(s) liée(s) à la sélection bâtiment : contour clair + voile translucide. */
const selectedParcellePath: L.PathOptions = {
  color: "#fafafa",
  weight: 1.4,
  opacity: 0.95,
  fillColor: BRAND_INK,
  fillOpacity: 0.18,
  pane: PANE_SELECTED_PARCELLE,
  interactive: false,
};

/** Emprise(s) bâtiment OSM sélectionnée(s) — visible même si tuile MVT absente du cache. */
const selectedBuildingPath: L.PathOptions = {
  color: "#e8f0a0",
  weight: 2,
  opacity: 1,
  fillColor: "#b8c469",
  fillOpacity: 0.55,
  pane: PANE_FP_BUILDING,
  interactive: false,
};

/** Parcelle voisine non incluse — clic pour ajouter. */
const addableParcellePath: L.PathOptions = {
  color: "#60a5fa",
  weight: 1.2,
  opacity: 0.9,
  dashArray: "5 4",
  fillColor: "#3b82f6",
  fillOpacity: 0.1,
  pane: PANE_ADDABLE_PARCELLE,
  interactive: true,
};

/** Parcelle voisine déjà dans le périmètre — clic pour retirer. */
const adjacentParcelleIncludedPath: L.PathOptions = {
  color: "#2563eb",
  weight: 2,
  opacity: 1,
  fillColor: "#3b82f6",
  fillOpacity: 0.28,
  pane: PANE_ADDABLE_PARCELLE,
  interactive: true,
};

function addableParcelleStyleForFeature(feature: GeoJSON.Feature | undefined): L.PathOptions {
  const props = feature?.properties as Record<string, unknown> | undefined;
  if (props?.in_effective === true) return adjacentParcelleIncludedPath;
  return addableParcellePath;
}

/** Emprise bâtiment exclue du combo personnalisé. */
const deselectedBuildingPath: L.PathOptions = {
  color: "#a1a1aa",
  weight: 1,
  opacity: 0.55,
  fillColor: "#71717a",
  fillOpacity: 0.12,
  pane: PANE_FP_BUILDING,
  interactive: false,
};

function buildingHighlightStyleForSelection(
  feature: GeoJSON.Feature | undefined,
  selectedBuildingIds: ReadonlySet<string> | undefined
): L.PathOptions {
  if (!selectedBuildingIds) return selectedBuildingPath;
  const id = feature ? discoveryBuildingSelectionIdFromFeature(feature) : "";
  if (id && !isDiscoveryBuildingSelected(selectedBuildingIds, id)) {
    return deselectedBuildingPath;
  }
  return selectedBuildingPath;
}

function rowIdsSignature(rows: ScoutMatchingV5Row[]): string {
  let hash = 2166136261;
  for (const row of rows) {
    const id = row.id;
    for (let i = 0; i < id.length; i += 1) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 124;
    hash = Math.imul(hash, 16777619);
  }
  return `${rows.length}:${(hash >>> 0).toString(36)}`;
}

function comboMarkersSignature(markers: readonly DiscoveryComboMarker[]): string {
  const parts: string[] = [];
  for (const m of markers) {
    const osmSig = [...m.osmBuildingIds].sort().join(",");
    parts.push(
      `${m.comboId};${m.position.lat.toFixed(5)};${m.position.lng.toFixed(5)};${m.anchorParcelleId};${Math.round(m.footprintSumM2)};${osmSig}`
    );
  }
  parts.sort();
  return `${parts.length}|${parts.join("|")}`;
}

/** Clé stable pour recréer la couche MVT quand la whitelist change (évite de re-hasher tout le Set côté effet). */
function osmBuildingWhitelistSignature(ids: ReadonlySet<string>): string {
  let hash = 2166136261;
  const sorted = Array.from(ids).sort();
  const n = sorted.length;
  for (const id of sorted) {
    for (let i = 0; i < id.length; i += 1) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 124;
    hash = Math.imul(hash, 16777619);
  }
  return `${n}:${(hash >>> 0).toString(36)}`;
}

function MapResizeInvalidate({ layoutRevision }: { layoutRevision?: string }) {
  const map = useMap();
  useEffect(() => {
    discoveryDebug("map", "invalidateSize (layoutRevision)", { layoutRevision });
    const id = requestAnimationFrame(() => {
      map.invalidateSize();
    });
    return () => cancelAnimationFrame(id);
  }, [map, layoutRevision]);

  useEffect(() => {
    const el = map.getContainer()?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);

  return null;
}

function MapBoundsEmitter({ onViewBoundsChange }: { onViewBoundsChange: (bounds: MapBounds | null) => void }) {
  const map = useMap();
  const onViewBoundsChangeRef = useRef(onViewBoundsChange);
  onViewBoundsChangeRef.current = onViewBoundsChange;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emitBounds = useCallback(
    (reason: "raf-initial" | "moveend-debounced") => {
      const b = map.getBounds();
      const payload: MapBounds = {
        sw: { lat: b.getSouth(), lng: b.getWest() },
        ne: { lat: b.getNorth(), lng: b.getEast() },
      };
      discoveryDebug("map", "MapBoundsEmitter → parent", {
        reason,
        key: discoveryBoundsKey(payload),
      });
      onViewBoundsChangeRef.current(payload);
    },
    [map]
  );

  useEffect(() => {
    const t = setTimeout(() => emitBounds("raf-initial"), 0);
    return () => clearTimeout(t);
  }, [emitBounds]);

  useMapEvents({
    moveend: () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        emitBounds("moveend-debounced");
      }, DISCOVERY_VIEWPORT_FETCH_DEBOUNCE_MS);
    },
  });

  return null;
}

function MapBackgroundDeselect({ onDeselect }: { onDeselect: () => void }) {
  const onDeselectRef = useRef(onDeselect);
  onDeselectRef.current = onDeselect;
  useMapEvents({
    click: () => {
      onDeselectRef.current();
    },
  });
  return null;
}

/** Vol programmatique (deep link pipeline → Découverte) ; notifie le parent après `moveend` (repli timeout). */
function DiscoveryMapFlyTo({
  flyTo,
  onFlyToConsumed,
}: {
  flyTo: { lat: number; lng: number; zoom?: number } | null;
  onFlyToConsumed: () => void;
}) {
  const map = useMap();
  const onConsumedRef = useRef(onFlyToConsumed);
  onConsumedRef.current = onFlyToConsumed;

  useEffect(() => {
    if (!flyTo) return;
    const z = flyTo.zoom ?? 17;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      map.off("moveend", done);
      onConsumedRef.current();
    };
    map.flyTo([flyTo.lat, flyTo.lng], z, { duration: 0.65 });
    map.on("moveend", done);
    const tid = window.setTimeout(done, 1200);
    return () => {
      window.clearTimeout(tid);
      map.off("moveend", done);
    };
  }, [map, flyTo]);

  return null;
}

export type DiscoveryMapViewProps = {
  /**
   * Marqueurs cluster (1 par combo parcelles/bâtiments liés) au zoom ≤ DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM.
   */
  comboMarkers: readonly DiscoveryComboMarker[];
  /** Filtres découverte : restreint clusters + MVT aux bâtiments liés aux emprises filtrées. */
  osmBuildingDisplayFilter: DiscoveryOsmBuildingDisplayFilter;
  /** Parcelles à mettre en surcouche (cluster « partage » de la sélection bâtiment). */
  parcelleHighlightRows: ScoutMatchingV5Row[];
  /** Polygones bâtiment (building_geometries_json) pour la sélection courante. */
  buildingHighlightFc: GeoJSON.FeatureCollection;
  /** Numéros 1…N au centroïde de chaque empreinte surlignée (combo sélectionné). */
  buildingNumberLabels?: readonly DiscoveryComboBuildingNumberLabel[];
  /** Bâtiments inclus dans le combo personnalisé (`bc:` / `osm:`). */
  selectedBuildingIds?: ReadonlySet<string>;
  onToggleDiscoveryBuilding?: (selectionId: string) => void;
  /** Mode édition : parcelles voisines cliquables pour étendre le combo. */
  discoveryEditMode?: boolean;
  addableParcellesFc?: GeoJSON.FeatureCollection;
  onToggleAdjacentParcelle?: (parcelleId: string, include: boolean) => void;
  adjacentParcellesLoading?: boolean;
  /** Périmètre parcelles courant (toggle ajout / retrait sur les voisines). */
  effectiveParcelleIds?: ReadonlySet<string>;
  /** Polygones parking OSM (`parking_geometries_json`) pour la sélection courante. */
  parkingHighlightFc: GeoJSON.FeatureCollection;
  /** Bâtiment OSM courant (MVT / whitelist). */
  selectedOsmBuildingId: string | null;
  /** Combo sélectionné (marqueur cluster). */
  selectedComboId: string | null;
  /** Clic marqueur cluster → comboId (`combo:p1|p2` ou fallback `w:123`). */
  onSelectComboId: (comboId: string | null) => void;
  /** Clic polygone MVT → osm_building_id. */
  onSelectOsmBuildingId: (osmBuildingId: string | null) => void;
  onViewBoundsChange: (bounds: MapBounds | null) => void;
  /** Notifié à l’init (zoom bridge) et à chaque `zoomend` — pour piloter les fetchs côté page. */
  onViewportZoomChange?: (zoom: number) => void;
  defaultCenter: { lat: number; lng: number };
  defaultZoom: number;
  /** Vol carte (deep link) ; consommé après `moveend`. */
  flyTo?: { lat: number; lng: number; zoom?: number } | null;
  /** Appelé une fois le vol terminé (défaut no-op). */
  onFlyToConsumed?: () => void;
  /** Classes pour le conteneur Leaflet. */
  className?: string;
  /** Couche Enedis (points consommation) — affichée si non vide. */
  enedisPoints?: readonly DiscoveryEnedisPoint[];
  selectedEnedisId?: string | null;
  onSelectEnedisId?: (id: string | null) => void;
};

export function DiscoveryMapView({
  comboMarkers,
  osmBuildingDisplayFilter,
  parcelleHighlightRows,
  buildingHighlightFc,
  buildingNumberLabels = [],
  selectedBuildingIds,
  onToggleDiscoveryBuilding,
  discoveryEditMode = false,
  addableParcellesFc = { type: "FeatureCollection", features: [] },
  onToggleAdjacentParcelle,
  adjacentParcellesLoading = false,
  effectiveParcelleIds,
  parkingHighlightFc,
  selectedOsmBuildingId,
  selectedComboId,
  onSelectComboId,
  onSelectOsmBuildingId,
  onViewBoundsChange,
  onViewportZoomChange,
  defaultCenter,
  defaultZoom,
  flyTo = null,
  onFlyToConsumed = () => {},
  className,
  enedisPoints = [],
  selectedEnedisId = null,
  onSelectEnedisId = () => {},
}: DiscoveryMapViewProps) {
  const [mounted, setMounted] = useState(false);
  const [viewportZoom, setViewportZoom] = useState(defaultZoom);
  useEffect(() => {
    setMounted(true);
  }, []);

  const onSelectOsmBuildingIdRef = useRef(onSelectOsmBuildingId);
  onSelectOsmBuildingIdRef.current = onSelectOsmBuildingId;
  const onSelectComboIdRef = useRef(onSelectComboId);
  onSelectComboIdRef.current = onSelectComboId;
  const onSelectEnedisIdRef = useRef(onSelectEnedisId);
  onSelectEnedisIdRef.current = onSelectEnedisId;

  const onToggleDiscoveryBuildingRef = useRef(onToggleDiscoveryBuilding);
  onToggleDiscoveryBuildingRef.current = onToggleDiscoveryBuilding;
  const onToggleAdjacentParcelleRef = useRef(onToggleAdjacentParcelle);
  onToggleAdjacentParcelleRef.current = onToggleAdjacentParcelle;

  const buildingIdsForHighlight = selectedBuildingIds;

  const showBuildingPolygons = viewportZoom > DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM;

  const parcelleHighlightFcRaw = useMemo(
    () => rowsToFeatureCollection(parcelleHighlightRows),
    [parcelleHighlightRows]
  );

  const parcelleHighlightFc = useMemo(
    () =>
      simplifyFeatureCollectionForMapDisplay(
        parcelleHighlightFcRaw,
        toleranceDegForParcelHighlightZoom(viewportZoom)
      ),
    [parcelleHighlightFcRaw, viewportZoom]
  );

  const parkingHighlightFcDisplay = useMemo(
    () =>
      simplifyFeatureCollectionForMapDisplay(
        parkingHighlightFc,
        toleranceDegForParcelHighlightZoom(viewportZoom)
      ),
    [parkingHighlightFc, viewportZoom]
  );

  const parcelleHighlightKey = useMemo(
    () =>
      `pl:${rowIdsSignature(parcelleHighlightRows)}:b:${buildingHighlightFc.features.length}:pk:${parkingHighlightFc.features.length}:sel:${selectedOsmBuildingId ?? "-"}`,
    [
      parcelleHighlightRows,
      buildingHighlightFc.features.length,
      parkingHighlightFc.features.length,
      selectedOsmBuildingId,
    ]
  );

  /** Resize carte : géométries de surbrillance uniquement (pas la sélection → évite reload tuiles MVT au clic). */
  const mapLayoutRevision = useMemo(
    () => `pl:${rowIdsSignature(parcelleHighlightRows)}:b:${buildingHighlightFc.features.length}`,
    [parcelleHighlightRows, buildingHighlightFc.features.length]
  );

  const buildingHighlightFcDisplay = useMemo(
    () =>
      simplifyFeatureCollectionForMapDisplay(
        buildingHighlightFc,
        toleranceDegForParcelHighlightZoom(viewportZoom)
      ),
    [buildingHighlightFc, viewportZoom]
  );

  const comboMarkersCacheRef = useRef<{
    sig: string;
    markers: { id: string; position: L.LatLngExpression; osmBuildingIds: string[] }[];
  } | null>(null);

  const comboMapMarkers = useMemo(() => {
    const sig = comboMarkersSignature(comboMarkers);
    const cached = comboMarkersCacheRef.current;
    if (cached && cached.sig === sig) return cached.markers;
    const out: { id: string; position: L.LatLngExpression; osmBuildingIds: string[] }[] = [];
    for (const m of comboMarkers) {
      out.push({
        id: m.comboId,
        position: [m.position.lat, m.position.lng],
        osmBuildingIds: m.osmBuildingIds,
      });
    }
    comboMarkersCacheRef.current = { sig, markers: out };
    return out;
  }, [comboMarkers]);

  /** Les combos sont déjà filtrés côté page (`mapBuildingPoints` + filtres) — pas de second passage whitelist. */
  const clusteredMarkers = comboMapMarkers;

  const mvtWhitelistKey = useMemo(
    () =>
      osmBuildingDisplayFilter.mode === "all"
        ? "all"
        : `w:${osmBuildingWhitelistSignature(osmBuildingDisplayFilter.ids)}`,
    [osmBuildingDisplayFilter]
  );

  useEffect(() => {
    discoveryDebug("map", "viewportZoom / mode affichage", {
      viewportZoom,
      modePolygones: showBuildingPolygons,
      seuilClusterMaxZoom: DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM,
    });
  }, [viewportZoom, showBuildingPolygons]);

  useEffect(() => {
    discoveryDebug("map", "données carte (clés couches)", {
      comboMarkerCount: comboMarkers.length,
      parcelleHighlightCount: parcelleHighlightRows.length,
      parcelleHighlightKey,
    });
  }, [comboMarkers.length, parcelleHighlightRows.length, parcelleHighlightKey]);

  useEffect(() => {
    if (!mounted) return;
    discoveryDebug("map", "DiscoveryMapView — client Leaflet actif (mounted)");
  }, [mounted]);

  const center = useMemo<[number, number]>(
    () => [defaultCenter.lat, defaultCenter.lng],
    [defaultCenter.lat, defaultCenter.lng]
  );

  if (!mounted) {
    return (
      <div
        className={cn(
          "h-full min-h-[320px] w-full rounded-lg border border-zinc-800 bg-zinc-950",
          className
        )}
        aria-hidden
      />
    );
  }

  return (
    <Map
      center={center}
      zoom={defaultZoom}
      attributionControl
      className={cn(
        className,
        "[&.leaflet-container]:!bg-zinc-950 [&_.leaflet-control-attribution]:!border-zinc-700 [&_.leaflet-control-attribution]:!bg-black/55 [&_.leaflet-control-attribution]:!text-[11px] [&_.leaflet-control-attribution]:!text-zinc-200 [&_.leaflet-control-attribution_a]:!text-sky-300"
      )}
    >
      <DiscoveryMapVectorPanes />
      <MapTileLayer
        url={ESRI_WORLD_IMAGERY_URL}
        attribution={ESRI_WORLD_IMAGERY_ATTRIBUTION}
        maxZoom={19}
      />
      <MapZoomControl variant="minimal" />
      <MapResizeInvalidate layoutRevision={mapLayoutRevision} />
      <MapBoundsEmitter onViewBoundsChange={onViewBoundsChange} />
      {flyTo != null ? <DiscoveryMapFlyTo flyTo={flyTo} onFlyToConsumed={onFlyToConsumed} /> : null}
      <MapBackgroundDeselect
        onDeselect={() => {
          onSelectComboIdRef.current(null);
          onSelectOsmBuildingIdRef.current(null);
          onSelectEnedisIdRef.current(null);
        }}
      />
      <DiscoveryMapZoomBridge
        onZoom={(z) => {
          setViewportZoom(z);
          onViewportZoomChange?.(z);
        }}
      />
      <DiscoveryMvtBuildingsLayer
        enabled={showBuildingPolygons}
        osmBuildingDisplayFilter={osmBuildingDisplayFilter}
        whitelistKey={mvtWhitelistKey}
        mapClickPassthrough={discoveryEditMode}
        onOsmBuildingId={(id) => onSelectOsmBuildingIdRef.current(id)}
      />
      {!showBuildingPolygons ? (
        <DiscoveryClusteredBuildings
          markers={clusteredMarkers}
          selectedComboId={selectedComboId}
          onSelectRef={onSelectComboIdRef}
        />
      ) : null}
      {parkingHighlightFcDisplay.features.length > 0 ? (
        <GeoJSON
          key={`parking-hl-${parcelleHighlightKey}`}
          data={parkingHighlightFcDisplay}
          style={parkingHighlightStyle}
          onEachFeature={bindParkingHighlightTooltip}
        />
      ) : null}
      {discoveryEditMode ? (
        <div
          className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-[min(100%,20rem)] rounded-lg border border-blue-200/80 bg-white/95 px-3 py-2 text-xs text-foreground shadow-sm"
          role="status"
        >
          {adjacentParcellesLoading
            ? "Chargement des parcelles voisines…"
            : "Parcelles voisines : clic pour ajouter (pointillés) ou retirer (plein bleu)."}
        </div>
      ) : null}
      <GeoJSON
        key={`parcelles-hl-${parcelleHighlightKey}`}
        data={parcelleHighlightFc}
        style={() => selectedParcellePath}
      />
      {buildingHighlightFcDisplay.features.length > 0 ? (
        <GeoJSON
          key={`buildings-hl-${parcelleHighlightKey}`}
          data={buildingHighlightFcDisplay}
          style={(feature) => ({
            ...buildingHighlightStyleForSelection(feature, buildingIdsForHighlight),
            interactive: !discoveryEditMode,
          })}
        />
      ) : null}
      {discoveryEditMode && addableParcellesFc.features.length > 0 ? (
        <GeoJSON
          key={`parcelles-add-${parcelleHighlightKey}-${addableParcellesFc.features.length}-${effectiveParcelleIds?.size ?? 0}`}
          data={addableParcellesFc}
          style={(feature) => addableParcelleStyleForFeature(feature)}
          onEachFeature={(feature, layer) => {
            const pid = String(feature.properties?.scout_v5_id ?? feature.id ?? "").trim();
            if (!pid) return;
            const included = Boolean(
              (feature.properties as Record<string, unknown> | undefined)?.in_effective
            );
            if (layer instanceof L.Path) {
              layer.options.className = included
                ? "discovery-adjacent-parcelle-included-path"
                : "discovery-addable-parcelle-path";
            }
            layer.on("click", (e) => {
              L.DomEvent.stopPropagation(e);
              const nextInclude = !(
                effectiveParcelleIds?.has(pid) ??
                (feature.properties as Record<string, unknown> | undefined)?.in_effective ===
                  true
              );
              onToggleAdjacentParcelleRef.current?.(pid, nextInclude);
            });
          }}
        />
      ) : null}
      {buildingNumberLabels.length > 0 && onToggleDiscoveryBuilding && selectedBuildingIds ? (
        <DiscoveryComboBuildingNumberLabelsLayer
          labels={buildingNumberLabels}
          selectedBuildingIds={selectedBuildingIds}
          onToggleBuilding={(id) => onToggleDiscoveryBuildingRef.current?.(id)}
        />
      ) : null}
      {enedisPoints.length > 0 ? (
        <DiscoveryEnedisConsumptionLayer
          points={enedisPoints}
          selectedEnedisId={selectedEnedisId}
          onSelectEnedisId={onSelectEnedisId}
        />
      ) : null}
    </Map>
  );
}
