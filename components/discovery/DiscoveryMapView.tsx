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
import { centroidFromGeoJsonPolygonLike } from "@/lib/matching-v5-google-poi-fallback/centroid-from-geojson";
import {
  findMatchingV5RowIdForBatimentFootprint,
  type ScoutMatchingV5Row,
} from "@/lib/scout-matching-v5-map";
import type { MapBounds } from "@/lib/swr-hooks";
import { discoveryBoundsKey, discoveryDebug } from "@/lib/discovery-debug";
import { BRAND_INK, BRAND_LIME, BRAND_LIME_HOVER } from "@/lib/brand-colors";

/** Contour plus foncé que `BRAND_LIME_HOVER` pour rester lisible sur imagerie / cadastre sombre. */
const LIME_STROKE_DARK = "#b0c45a";

/**
 * Empilement « cadastre / parcelle » vs « bâtiment » :
 *
 * - Souvent **toutes** les lignes exportées sont `grain === "parcelle"` : le « building » vu sur la
 *   carte, c’est surtout le **BDNB** (lime + bord lime foncé) + éventuellement des lignes `building` rares.
 * - L’empreinte parcelle a un **plein sombre** (fill) ; le BDNB était à fillOpacity 0.1 → le bâtiment
 *   est **souvent au-dessus en z-index** mais **visuellement noyé** sous le cadastre (illusion de
 *   polygone building « en dessous »).
 * - Quand du BDNB est chargé : parcelle / surbrillance cadastre en **contour** (fill désactivé),
 *   BDNB plus opaque, panes avec **z-index** bien séparés du fond parcelle.
 * - Leaflet applique `.leaflet-pane { z-index: 400 }` par défaut ; les empreintes **bâtiment** (GeoJSON
 *   `grain === "building"`) doivent rester **strictement au-dessus** des couches cadastre / parcelle
 *   (souvent sous 400), sinon le plein cadastre peut masquer le polygone bâtiment.
 */
const PANE_CADASTRE_HL = "discoveryCadastreHl";
const PANE_FP_PARCELLE = "discoveryFpParcelle";
const PANE_FP_BUILDING = "discoveryFpBuilding";
const PANE_SELECTED_PARCELLE = "discoverySelectedParcelle";
const PANE_BDNB = "discoveryBdnb";
const PANE_SELECTED_BUILDING = "discoverySelectedBuilding";

/** Zoom « reculé » : au-delà, empreintes matching en polygones ; en dessous, points + MapMarkerClusterGroup (shadcn-map). */
const DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM = 14;

/**
 * Marqueurs + clusters isolés dans un `memo` : les mises à jour bounds/zoom parent ne
 * re-rendent pas toute la couche tant que la liste des points est inchangée.
 * Couleurs des clusters = défaut Leaflet.markercluster (cf. exemple shadcn-map sans prop `icon`).
 */
const DiscoveryClusteredFootprints = memo(function DiscoveryClusteredFootprints({
  markers,
  onSelectRef,
}: {
  markers: readonly { id: string; position: L.LatLngExpression }[];
  onSelectRef: React.RefObject<(id: string | null) => void>;
}) {
  useEffect(() => {
    const first = markers[0]?.id;
    const last = markers.length > 0 ? markers[markers.length - 1]?.id : undefined;
    discoveryDebug("map", "DiscoveryClusteredFootprints (marqueurs cluster)", {
      markerCount: markers.length,
      firstId: first,
      lastId: last,
    });
  }, [markers]);

  return (
    <MapMarkerClusterGroup
      showCoverageOnHover={false}
      removeOutsideVisibleBounds={false}
      spiderfyOnMaxZoom
    >
      {markers.map((m) => (
        <MapMarker
          key={m.id}
          position={m.position}
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
     * overlayPane Leaflet = 400 (`.leaflet-pane`). Cadastre / parcelle sous 400 ; bâtiments au-dessus de 400
     * pour que le GeoJSON building reste visible au-dessus des polygones cadastre.
     */
    const defs: Array<[string, number]> = [
      [PANE_CADASTRE_HL, 340],
      [PANE_FP_PARCELLE, 355],
      [PANE_SELECTED_PARCELLE, 370],
      [PANE_FP_BUILDING, 430],
      [PANE_BDNB, 520],
      [PANE_SELECTED_BUILDING, 540],
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

/** Surbrillance cadastre (sous tout le reste) — non interactive : les clics vont aux footprints / BDNB. */
const parcelleCadastreHighlightPath: L.PathOptions = {
  color: BRAND_INK,
  weight: 1.5,
  fillColor: "#09090b",
  fillOpacity: 0.35,
  pane: PANE_CADASTRE_HL,
  interactive: false,
};

/** Parcelle (empreinte Σ bâtiments) — même lecture « cadastre » sombre que les parcelles. */
const parcelleFootprintPath: L.PathOptions = {
  color: "#27272a",
  weight: 1.5,
  fillColor: "#09090b",
  fillOpacity: 0.28,
};

/** Sélection parcelle / surbrillance cadastre : même plein que `parcelleFootprintPath`, contour fin (lisibilité surtout par la couleur). */
const parcelleSelectedStrokeOnly: Pick<L.PathOptions, "color" | "weight" | "opacity"> = {
  color: "#fafafa",
  weight: 1,
  opacity: 1,
};

/** Bâtiment multi-parcelles (grain building) — lime DS + contour lime foncé. */
const buildingFootprintPath: L.PathOptions = {
  color: LIME_STROKE_DARK,
  weight: 2.5,
  fillColor: BRAND_LIME,
  fillOpacity: 0.4,
};

const buildingFootprintSelectedPath: L.PathOptions = {
  color: LIME_STROKE_DARK,
  weight: 2,
  fillColor: BRAND_LIME_HOVER,
  fillOpacity: 0.55,
};

/** Empreintes BDNB — plein lime marque, bord lime plus foncé. */
const bdnbConstructionPath: L.PathOptions = {
  color: LIME_STROKE_DARK,
  weight: 3,
  fillColor: BRAND_LIME,
  fillOpacity: 0.46,
  pane: PANE_BDNB,
};

/** BDNB correspondant à la ligne sélectionnée (souvent `grain === "parcelle"`). */
const bdnbConstructionSelectedPath: L.PathOptions = {
  color: LIME_STROKE_DARK,
  weight: 2.5,
  fillColor: BRAND_LIME_HOVER,
  fillOpacity: 0.58,
  pane: PANE_SELECTED_BUILDING,
};

/**
 * Empreinte stable des points cluster (tri par id) : si le pan ne change pas le jeu de parcelles
 * / positions affichées, on garde la **même référence** de tableau → `memo` ne refait pas tout le groupe.
 */
function footprintClusterMarkersSignature(rows: ScoutMatchingV5Row[]): string {
  const parts: string[] = [];
  for (const r of rows) {
    const c = centroidFromGeoJsonPolygonLike(r.geometry);
    if (!c) continue;
    parts.push(`${r.id};${c.lat.toFixed(5)};${c.lng.toFixed(5)}`);
  }
  parts.sort();
  return `${parts.length}|${parts.join("|")}`;
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

function batimentIdFromBdnbGeoJsonFeature(feature: GeoJSON.Feature): string {
  const p = feature.properties as Record<string, unknown> | undefined;
  const c = String(p?.batiment_construction_id ?? "").trim();
  if (c) return c;
  const g = String(p?.batiment_groupe_id ?? "").trim();
  if (g) return g;
  const fid = typeof feature.id === "string" ? feature.id.trim() : "";
  if (fid.startsWith("bdnbcstr:")) return fid.slice("bdnbcstr:".length);
  return "";
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
      }, 500);
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

function styleForFootprintFeature(feature: GeoJSON.Feature, selected: boolean): L.PathOptions {
  const grain = feature.properties?.grain;
  const isBuilding = grain === "building";
  if (selected) {
    if (isBuilding) {
      return { ...buildingFootprintSelectedPath, pane: PANE_SELECTED_BUILDING };
    }
    /** Sous le BDNB : ne pas intercepter les clics (sélection bâtiment / empreinte fine). */
    return {
      ...parcelleFootprintPath,
      ...parcelleSelectedStrokeOnly,
      pane: PANE_SELECTED_PARCELLE,
      interactive: false,
    };
  }
  if (isBuilding) {
    return { ...buildingFootprintPath, pane: PANE_FP_BUILDING };
  }
  return { ...parcelleFootprintPath, pane: PANE_FP_PARCELLE };
}

export type DiscoveryMapViewProps = {
  /** Lignes matching V5 à tracer (parcelle et/ou building), comme sur Solar Scout. */
  footprintRows: ScoutMatchingV5Row[];
  /** Polygones BDNB (`batiment_construction`), chargés à part depuis Postgres. */
  bdnbBuildingFeatures?: GeoJSON.Feature[];
  parcelleHighlightRows: ScoutMatchingV5Row[];
  selectedRowId: string | null;
  onSelectRowId: (id: string | null) => void;
  onViewBoundsChange: (bounds: MapBounds | null) => void;
  defaultCenter: { lat: number; lng: number };
  defaultZoom: number;
  /** Vol carte (deep link) ; consommé après `moveend`. */
  flyTo?: { lat: number; lng: number; zoom?: number } | null;
  /** Appelé une fois le vol terminé (défaut no-op). */
  onFlyToConsumed?: () => void;
  /** Classes pour le conteneur Leaflet (ex. carte pleine hauteur dans un parent `relative`). */
  className?: string;
};

export function DiscoveryMapView({
  footprintRows,
  bdnbBuildingFeatures = [],
  parcelleHighlightRows,
  selectedRowId,
  onSelectRowId,
  onViewBoundsChange,
  defaultCenter,
  defaultZoom,
  flyTo = null,
  onFlyToConsumed = () => {},
  className,
}: DiscoveryMapViewProps) {
  const [mounted, setMounted] = useState(false);
  const [viewportZoom, setViewportZoom] = useState(defaultZoom);
  useEffect(() => {
    setMounted(true);
  }, []);

  const onSelectRowIdRef = useRef(onSelectRowId);
  onSelectRowIdRef.current = onSelectRowId;
  const footprintRowsRef = useRef(footprintRows);
  footprintRowsRef.current = footprintRows;

  const parcellesFc = useMemo(
    () => rowsToFeatureCollection(parcelleHighlightRows),
    [parcelleHighlightRows]
  );

  /** Toute parcelle du groupe « partage » / multi-cadastre (clic BDNB ou parcelle). */
  const selectedLinkedParcelleIdSet = useMemo(
    () => new Set(parcelleHighlightRows.map((r) => r.id)),
    [parcelleHighlightRows]
  );

  const selectedRow = useMemo(
    () => (selectedRowId ? footprintRows.filter((r) => r.id === selectedRowId) : []),
    [footprintRows, selectedRowId]
  );
  const otherFootprints = useMemo(
    () =>
      selectedRowId ? footprintRows.filter((r) => r.id !== selectedRowId) : footprintRows,
    [footprintRows, selectedRowId]
  );

  /** Deux couches : d’abord parcelle puis building — sinon Leaflet empile les polygons dans l’ordre des features et le cadastre capte les clics au-dessus du bâtiment. */
  const otherParcelleFootprints = useMemo(
    () => otherFootprints.filter((r) => r.grain === "parcelle"),
    [otherFootprints]
  );
  const otherBuildingFootprints = useMemo(
    () => otherFootprints.filter((r) => r.grain === "building"),
    [otherFootprints]
  );
  const mainParcelleFootprintsFc = useMemo(
    () => rowsToFeatureCollection(otherParcelleFootprints),
    [otherParcelleFootprints]
  );
  const mainBuildingFootprintsFc = useMemo(
    () => rowsToFeatureCollection(otherBuildingFootprints),
    [otherBuildingFootprints]
  );
  /**
   * - `grain === "building"` : toutes les parcelles de `parcelleHighlightRows` + le polygone building.
   * - `grain === "parcelle"` (ex. clic BDNB) : `findMatchingV5RowIdForBatimentFootprint` ne retient qu’un
   *   id canonique, mais `parcelleHighlightRows` liste déjà toutes les parcelles en partage — on les trace
   *   toutes en style « sélection » pour que chaque cadastre lié (ex. HB 0088 + HB 0093) soit surligné.
   */
  const selectedFc = useMemo((): GeoJSON.FeatureCollection => {
    if (selectedRow.length === 0) {
      return { type: "FeatureCollection", features: [] };
    }
    const anchor = selectedRow[0]!;
    if (anchor.grain === "building") {
      const linkedFc = rowsToFeatureCollection(parcelleHighlightRows);
      const buildingFc = rowsToFeatureCollection(selectedRow);
      return {
        type: "FeatureCollection",
        features: [...linkedFc.features, ...buildingFc.features],
      };
    }
    if (anchor.grain === "parcelle" && parcelleHighlightRows.length > 0) {
      return rowsToFeatureCollection(parcelleHighlightRows);
    }
    return rowsToFeatureCollection(selectedRow);
  }, [selectedRow, parcelleHighlightRows]);

  /**
   * react-leaflet GeoJSON ne met pas à jour `data` après le 1er rendu (seulement `style` dans updateGeoJSON).
   * Sans remontage, les couches restent vides si la 1ère passe était sans entités puis l’API remplit les rows.
   */
  const vectorLayersKey = useMemo(() => {
    const footprintSig = rowIdsSignature(footprintRows);
    const highlightSig = rowIdsSignature(parcelleHighlightRows);
    return `fp:${footprintSig}:hl:${highlightSig}:sel:${selectedRowId ?? "-"}`;
  }, [footprintRows, parcelleHighlightRows, selectedRowId]);

  const bdnbFc = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: bdnbBuildingFeatures,
    }),
    [bdnbBuildingFeatures]
  );

  const bdnbLayerKey = useMemo(() => {
    const n = bdnbBuildingFeatures.length;
    if (n === 0) return "bdnb0";
    const f0 = bdnbBuildingFeatures[0];
    const id0 =
      typeof f0?.id === "string" && f0.id
        ? f0.id
        : String((f0?.properties as Record<string, unknown> | undefined)?.batiment_construction_id ?? "");
    return `bdnb${n}:${id0}`;
  }, [bdnbBuildingFeatures]);

  /** Dès qu’on affiche du BDNB, l’empreinte parcelle ne doit plus voler les clics sur la majeure partie de la surface. */
  const hasBdnbFootprints = bdnbBuildingFeatures.length > 0;

  const showFootprintPolygons = viewportZoom > DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM;
  /** BDNB + contours « fines » seulement quand les empreintes sont en mode polygone. */
  const hasBdnbFootprintsForStyle = hasBdnbFootprints && showFootprintPolygons;

  const footprintClusterMarkersCacheRef = useRef<{
    sig: string;
    markers: { id: string; position: L.LatLngExpression }[];
  } | null>(null);

  const footprintClusterMarkers = useMemo(() => {
    const sig = footprintClusterMarkersSignature(otherFootprints);
    const cached = footprintClusterMarkersCacheRef.current;
    if (cached && cached.sig === sig) {
      return cached.markers;
    }
    const out: { id: string; position: L.LatLngExpression }[] = [];
    for (const row of otherFootprints) {
      const c = centroidFromGeoJsonPolygonLike(row.geometry);
      if (!c) continue;
      out.push({ id: row.id, position: [c.lat, c.lng] });
    }
    footprintClusterMarkersCacheRef.current = { sig, markers: out };
    return out;
  }, [otherFootprints]);

  useEffect(() => {
    discoveryDebug("map", "cluster markers : nouvelle référence de liste (remontage MarkerClusterGroup possible)", {
      count: footprintClusterMarkers.length,
    });
  }, [footprintClusterMarkers]);

  useEffect(() => {
    discoveryDebug("map", "viewportZoom / mode affichage", {
      viewportZoom,
      modePolygones: showFootprintPolygons,
      seuilClusterMaxZoom: DISCOVERY_FOOTPRINT_CLUSTER_MAX_ZOOM,
    });
  }, [viewportZoom, showFootprintPolygons]);

  useEffect(() => {
    discoveryDebug("map", "données carte (clés couches)", {
      footprintRowCount: footprintRows.length,
      bdnbFeatureCount: bdnbBuildingFeatures.length,
      vectorLayersKey,
      bdnbLayerKey,
    });
  }, [footprintRows.length, bdnbBuildingFeatures.length, vectorLayersKey, bdnbLayerKey]);

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
      {/** Pas lier à `vectorLayersKey` : sinon chaque fetch empreintes → invalidateSize → Leaflet recalcule tout. */}
      <MapResizeInvalidate layoutRevision={bdnbLayerKey} />
      <MapBoundsEmitter onViewBoundsChange={onViewBoundsChange} />
      {flyTo != null ? <DiscoveryMapFlyTo flyTo={flyTo} onFlyToConsumed={onFlyToConsumed} /> : null}
      <MapBackgroundDeselect onDeselect={() => onSelectRowIdRef.current(null)} />
      <DiscoveryMapZoomBridge onZoom={setViewportZoom} />
      <>
        {/**
         * Clés séparées empreintes matching vs BDNB : évite de remonter toute la pile (dont 600 polygones BDNB)
         * quand seul `vectorLayersKey` change (ex. léger pan, n 615→618, ids BDNB inchangés).
         */}
        <GeoJSON
          key={`parcelles-hl-${vectorLayersKey}`}
          data={parcellesFc}
          style={() =>
            hasBdnbFootprintsForStyle
              ? {
                  ...parcelleCadastreHighlightPath,
                  fill: false,
                  fillOpacity: 0,
                  weight: 2,
                  color: "#a1a1aa",
                  opacity: 0.95,
                }
              : parcelleCadastreHighlightPath
          }
        />
        {showFootprintPolygons ? (
          <>
            <GeoJSON
              key={`fp-parcelle-${vectorLayersKey}`}
              data={mainParcelleFootprintsFc}
              style={(feature) => {
                const base = styleForFootprintFeature(feature as GeoJSON.Feature, false);
                if (!hasBdnbFootprintsForStyle) return base;
                /** Plein parcelle masque le BDNB : avec BDNB, seul le contour reste (bâtiment lisible). */
                return {
                  ...base,
                  interactive: false,
                  fill: false,
                  fillOpacity: 0,
                  color: "#737373",
                  weight: 1.5,
                  opacity: 0.92,
                };
              }}
              onEachFeature={(feature, layer) => {
                if (hasBdnbFootprintsForStyle) return;
                layer.on("click", (e) => {
                  L.DomEvent.stopPropagation(e);
                  const id = feature.properties?.id;
                  if (typeof id === "string" && id) onSelectRowIdRef.current(id);
                });
              }}
            />
            <GeoJSON
              key={`fp-building-${vectorLayersKey}`}
              data={mainBuildingFootprintsFc}
              style={(feature) => styleForFootprintFeature(feature as GeoJSON.Feature, false)}
              onEachFeature={(feature, layer) => {
                layer.on("click", (e) => {
                  L.DomEvent.stopPropagation(e);
                  const id = feature.properties?.id;
                  if (typeof id === "string" && id) onSelectRowIdRef.current(id);
                });
              }}
            />
            {hasBdnbFootprints ? (
              <GeoJSON
                key={`bdnb-${bdnbLayerKey}`}
                data={bdnbFc}
                style={(feature) => {
                  const f = feature as GeoJSON.Feature;
                  if (!selectedRowId) return bdnbConstructionPath;
                  const bid = batimentIdFromBdnbGeoJsonFeature(f);
                  if (!bid) return bdnbConstructionPath;
                  const rowId = findMatchingV5RowIdForBatimentFootprint(footprintRows, bid);
                  const matchesGroup =
                    rowId != null &&
                    (rowId === selectedRowId || selectedLinkedParcelleIdSet.has(rowId));
                  return matchesGroup ? bdnbConstructionSelectedPath : bdnbConstructionPath;
                }}
                onEachFeature={(feature, layer) => {
                  layer.on("click", (e) => {
                    L.DomEvent.stopPropagation(e);
                    const bid = batimentIdFromBdnbGeoJsonFeature(feature as GeoJSON.Feature);
                    if (!bid) return;
                    const rowId = findMatchingV5RowIdForBatimentFootprint(footprintRowsRef.current, bid);
                    if (rowId) onSelectRowIdRef.current(rowId);
                  });
                }}
              />
            ) : null}
          </>
        ) : (
          <DiscoveryClusteredFootprints
            markers={footprintClusterMarkers}
            onSelectRef={onSelectRowIdRef}
          />
        )}
        <GeoJSON
          key={`selected-${vectorLayersKey}`}
          data={selectedFc}
          style={(feature) => {
            const f = feature as GeoJSON.Feature;
            const base = styleForFootprintFeature(f, true);
            if (hasBdnbFootprintsForStyle && f.properties?.grain !== "building") {
              return {
                ...base,
                fill: false,
                fillOpacity: 0,
                color: base.color ?? "#e4e4e7",
                weight: 1,
                opacity: 0.98,
              };
            }
            return base;
          }}
          onEachFeature={(feature, layer) => {
            layer.on("click", (e) => {
              L.DomEvent.stopPropagation(e);
              const id = (feature as GeoJSON.Feature).properties?.id;
              if (typeof id === "string" && id) onSelectRowIdRef.current(id);
            });
          }}
        />
      </>
    </Map>
  );
}
