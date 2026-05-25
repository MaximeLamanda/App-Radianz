"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { auth } from "@/lib/firebase";
import { discoveryDebug } from "@/lib/discovery-debug";
import { ensureLeafletDomEventFakeStopPolyfill } from "@/lib/leaflet-dom-event-fake-stop-polyfill";

/** Aligné sur `PANE_FP_BUILDING` dans DiscoveryMapView (empreintes bâtiment au-dessus du cadastre). */
const MVT_PANE = "discoveryFpBuilding";

export type DiscoveryOsmBuildingDisplayFilter =
  | { mode: "all" }
  | { mode: "whitelist"; ids: ReadonlySet<string> };

const MVT_BUILDING_VISIBLE_STYLE = {
  stroke: true,
  weight: 1.25,
  color: "#7a8c3b",
  fill: true,
  fillOpacity: 0.4,
  fillColor: "#b8c469",
} as const;

const MVT_BUILDING_HIDDEN_STYLE = {
  stroke: false,
  fill: false,
  fillOpacity: 0,
  opacity: 0,
  weight: 0,
} as const;

type VectorGridLeaflet = typeof L & {
  vectorGrid: {
    protobuf: (
      tileUrl: string,
      opts: Record<string, unknown>
    ) => MvtProtobufLayer;
  };
  canvas: { tile: (tileCoord: unknown, tileSize: unknown, opts?: unknown) => L.Layer };
};

type MvtProtobufLayer = L.Layer & {
  on: (ev: string, fn: (e: unknown) => void) => void;
  options?: { vectorTileLayerStyles?: Record<string, unknown> };
  redraw?: () => void;
  _reset?: () => void;
};

function mvtStyleForFilter(
  properties: Record<string, unknown>,
  filter: DiscoveryOsmBuildingDisplayFilter
) {
  if (filter.mode === "all") return MVT_BUILDING_VISIBLE_STYLE;
  const id = String(properties?.osm_building_id ?? "").trim();
  return id && filter.ids.has(id) ? MVT_BUILDING_VISIBLE_STYLE : MVT_BUILDING_HIDDEN_STYLE;
}

function applyMvtBuildingStyles(layer: MvtProtobufLayer, filter: DiscoveryOsmBuildingDisplayFilter) {
  layer.options = layer.options ?? {};
  layer.options.vectorTileLayerStyles = {
    buildings: (properties: Record<string, unknown>) => mvtStyleForFilter(properties, filter),
  };
  if (typeof layer.redraw === "function") {
    layer.redraw();
    return;
  }
  if (typeof layer._reset === "function") {
    layer._reset();
  }
}

export type DiscoveryMvtBuildingsLayerProps = {
  enabled: boolean;
  /** Aligné sur les filtres Discovery (clusters + tuiles). */
  osmBuildingDisplayFilter: DiscoveryOsmBuildingDisplayFilter;
  /** Clé stable pour recréer la couche quand la whitelist change. */
  whitelistKey: string;
  /** Callback déclenché au clic sur un polygone bâtiment (osm_building_id du pipeline V5). */
  onOsmBuildingId?: (osmBuildingId: string) => void;
  /** Mode édition combo : laisser passer les clics vers les parcelles voisines. */
  mapClickPassthrough?: boolean;
};

/**
 * Couche MVT des bâtiments OSM dédupliqués servie par /api/matching-v5/tiles
 * (source : public.scout_matching_v5_buildings_mv, layer MVT `buildings`).
 *
 * Un bâtiment partagé entre N parcelles n'apparaît qu'une seule fois côté carte
 * (déduplication par osm_building_id côté SQL).
 */
export function DiscoveryMvtBuildingsLayer({
  enabled,
  osmBuildingDisplayFilter,
  whitelistKey,
  onOsmBuildingId,
  mapClickPassthrough = false,
}: DiscoveryMvtBuildingsLayerProps) {
  const map = useMap();
  const layerRef = useRef<MvtProtobufLayer | null>(null);
  const lastWhitelistKeyRef = useRef<string | null>(null);
  const filterRef = useRef(osmBuildingDisplayFilter);
  filterRef.current = osmBuildingDisplayFilter;
  const onOsmBuildingIdRef = useRef(onOsmBuildingId);
  onOsmBuildingIdRef.current = onOsmBuildingId;
  const mapClickPassthroughRef = useRef(mapClickPassthrough);
  mapClickPassthroughRef.current = mapClickPassthrough;

  const attachClickHandler = useCallback((layer: MvtProtobufLayer) => {
    layer.on("click", (e: unknown) => {
      if (mapClickPassthroughRef.current) return;
      const ev = e as {
        layer?: { properties?: { osm_building_id?: unknown } };
        originalEvent?: Event;
      };
      if (ev.originalEvent) {
        L.DomEvent.stopPropagation(ev.originalEvent);
      }
      const id = String(ev.layer?.properties?.osm_building_id ?? "").trim();
      if (!id) return;
      const filter = filterRef.current;
      if (filter.mode === "whitelist" && !filter.ids.has(id)) {
        return;
      }
      onOsmBuildingIdRef.current?.(id);
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      ensureLeafletDomEventFakeStopPolyfill();
      await import("leaflet.vectorgrid/dist/Leaflet.VectorGrid.bundled.js");
      if (cancelled) return;
      await new Promise<void>((r) => {
        requestAnimationFrame(() => r());
      });
      if (cancelled) return;

      const token =
        typeof window !== "undefined" && auth.currentUser
          ? await auth.currentUser.getIdToken().catch(() => null)
          : null;
      if (cancelled) return;

      const base = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${base}/api/matching-v5/tiles/{z}/{x}/{y}`;

      const Lvg = L as VectorGridLeaflet;
      const filter = filterRef.current;

      const layer = Lvg.vectorGrid.protobuf(url, {
        rendererFactory: Lvg.canvas.tile,
        vectorTileLayerStyles: {
          buildings: (properties: Record<string, unknown>) => mvtStyleForFilter(properties, filter),
        },
        interactive: !mapClickPassthroughRef.current,
        getFeatureId: (f: { properties?: { osm_building_id?: unknown } }) =>
          String(f.properties?.osm_building_id ?? ""),
        fetchOptions: {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
        maxNativeZoom: 19,
        minZoom: 6,
        pane: MVT_PANE,
      });

      attachClickHandler(layer);

      if (cancelled) return;
      layer.addTo(map);
      layerRef.current = layer;
      discoveryDebug("map", "MVT buildings : couche ajoutée", { urlTemplate: url });
    })();

    return () => {
      cancelled = true;
      lastWhitelistKeyRef.current = null;
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [enabled, map, attachClickHandler, mapClickPassthrough]);

  /** Désactive les clics MVT dès l’entrée en mode édition (couche déjà montée). */
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !enabled) return;
    layer.options = layer.options ?? {};
    (layer.options as { interactive?: boolean }).interactive = !mapClickPassthrough;
    applyMvtBuildingStyles(layer, filterRef.current);
  }, [enabled, mapClickPassthrough]);

  /** Repeint les tuiles déjà chargées quand la whitelist change (filtres), pas à chaque sélection. */
  useEffect(() => {
    if (!enabled) return;
    if (lastWhitelistKeyRef.current === whitelistKey) return;
    const layer = layerRef.current;
    if (!layer) return;
    lastWhitelistKeyRef.current = whitelistKey;
    applyMvtBuildingStyles(layer, filterRef.current);
    discoveryDebug("map", "MVT buildings : styles whitelist mis à jour", { whitelistKey });
  }, [enabled, whitelistKey]);

  return null;
}
