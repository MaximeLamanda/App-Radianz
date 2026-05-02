"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { GeoJSON, useMap, useMapEvents } from "react-leaflet";
import { cn } from "@/lib/utils";
import {
  ESRI_WORLD_IMAGERY_ATTRIBUTION,
  ESRI_WORLD_IMAGERY_URL,
  Map,
  MapTileLayer,
  MapZoomControl,
} from "@/components/ui/map";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";
import type { MapBounds } from "@/lib/swr-hooks";

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

const parcellePath: L.PathOptions = {
  color: "#0369a1",
  weight: 1.5,
  fillColor: "#0ea5e9",
  fillOpacity: 0.22,
};

/** Parcelle (empreinte Σ bâtiments) — aligné sur les teintes Solar Scout matching V5. */
const parcelleFootprintPath: L.PathOptions = {
  color: "#047857",
  weight: 1.5,
  fillColor: "#10b981",
  fillOpacity: 0.22,
};

const parcelleFootprintSelectedPath: L.PathOptions = {
  color: "#065f46",
  weight: 2.5,
  fillColor: "#059669",
  fillOpacity: 0.38,
};

/** Bâtiment multi-parcelles (grain building). */
const buildingFootprintPath: L.PathOptions = {
  color: "#d97706",
  weight: 1.5,
  fillColor: "#fbbf24",
  fillOpacity: 0.28,
};

const buildingFootprintSelectedPath: L.PathOptions = {
  color: "#b45309",
  weight: 2.5,
  fillColor: "#f59e0b",
  fillOpacity: 0.45,
};

/** Empreintes BDNB (`/api/matching-v5/buildings`) — même palette que MapComponent Solar Scout. */
const bdnbConstructionPath: L.PathOptions = {
  color: "#0ea5e9",
  weight: 2,
  fillColor: "#38bdf8",
  fillOpacity: 0.14,
  interactive: false,
};

function MapResizeInvalidate({ layoutRevision }: { layoutRevision?: string }) {
  const map = useMap();
  useEffect(() => {
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

  const emitBounds = useCallback(() => {
    const b = map.getBounds();
    onViewBoundsChangeRef.current({
      sw: { lat: b.getSouth(), lng: b.getWest() },
      ne: { lat: b.getNorth(), lng: b.getEast() },
    });
  }, [map]);

  useEffect(() => {
    const t = setTimeout(() => emitBounds(), 0);
    return () => clearTimeout(t);
  }, [emitBounds]);

  useMapEvents({
    moveend: () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        emitBounds();
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

function styleForFootprintFeature(feature: GeoJSON.Feature, selected: boolean): L.PathOptions {
  const grain = feature.properties?.grain;
  const isBuilding = grain === "building";
  if (selected) {
    return isBuilding ? buildingFootprintSelectedPath : parcelleFootprintSelectedPath;
  }
  return isBuilding ? buildingFootprintPath : parcelleFootprintPath;
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
  className,
}: DiscoveryMapViewProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const onSelectRowIdRef = useRef(onSelectRowId);
  onSelectRowIdRef.current = onSelectRowId;

  const parcellesFc = useMemo(
    () => rowsToFeatureCollection(parcelleHighlightRows),
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

  const mainFootprintsFc = useMemo(() => rowsToFeatureCollection(otherFootprints), [otherFootprints]);
  const selectedFc = useMemo(() => rowsToFeatureCollection(selectedRow), [selectedRow]);

  /**
   * react-leaflet GeoJSON ne met pas à jour `data` après le 1er rendu (seulement `style` dans updateGeoJSON).
   * Sans remontage, les couches restent vides si la 1ère passe était sans entités puis l’API remplit les rows.
   */
  const vectorLayersKey = useMemo(() => {
    const n = footprintRows.length;
    if (n === 0) return `e0:sel:${selectedRowId ?? "-"}`;
    return `n${n}:${footprintRows[0]!.id}:${footprintRows[n - 1]!.id}:h${parcelleHighlightRows.length}:sel:${selectedRowId ?? "-"}`;
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

  const vectorAndBdnbKey = `${vectorLayersKey}|${bdnbLayerKey}`;

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
      <MapTileLayer
        url={ESRI_WORLD_IMAGERY_URL}
        attribution={ESRI_WORLD_IMAGERY_ATTRIBUTION}
        maxZoom={19}
      />
      <MapZoomControl position="topright" />
      <MapResizeInvalidate layoutRevision={vectorAndBdnbKey} />
      <MapBoundsEmitter onViewBoundsChange={onViewBoundsChange} />
      <MapBackgroundDeselect onDeselect={() => onSelectRowIdRef.current(null)} />
      <Fragment key={vectorAndBdnbKey}>
        <GeoJSON
          data={parcellesFc}
          style={() => parcellePath}
          onEachFeature={(_feature, layer) => {
            layer.on("click", (e) => {
              L.DomEvent.stopPropagation(e);
            });
          }}
        />
        <GeoJSON
          data={mainFootprintsFc}
          style={(feature) => styleForFootprintFeature(feature as GeoJSON.Feature, false)}
          onEachFeature={(feature, layer) => {
            layer.on("click", (e) => {
              L.DomEvent.stopPropagation(e);
              const id = feature.properties?.id;
              if (typeof id === "string" && id) onSelectRowIdRef.current(id);
            });
          }}
        />
        <GeoJSON data={bdnbFc} style={() => bdnbConstructionPath} />
        <GeoJSON
          data={selectedFc}
          style={(feature) => styleForFootprintFeature(feature as GeoJSON.Feature, true)}
          onEachFeature={(feature, layer) => {
            layer.on("click", (e) => {
              L.DomEvent.stopPropagation(e);
              const id = feature.properties?.id;
              if (typeof id === "string" && id) onSelectRowIdRef.current(id);
            });
          }}
        />
      </Fragment>
    </Map>
  );
}
