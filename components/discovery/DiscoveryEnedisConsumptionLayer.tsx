"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import L from "leaflet";
import { GeoJSON, useMap } from "react-leaflet";
import type { DiscoveryEnedisPoint } from "@/lib/discovery-enedis-layer";
import { discoveryDebug } from "@/lib/discovery-debug";

const ENEDIS_MARKER_AMBER = "#f59e0b";
const ENEDIS_MARKER_FILL = "#fef3c7";
/** Au-dessus de markerPane Leaflet (600) et MVT bâtiments (430) pour capter les clics. */
const PANE_ENEDIS = "discoveryEnedis";
const PANE_ENEDIS_Z_INDEX = "620";

function DiscoveryEnedisPane() {
  const map = useMap();
  useLayoutEffect(() => {
    const pane = map.getPane(PANE_ENEDIS) ?? map.createPane(PANE_ENEDIS);
    pane.style.zIndex = PANE_ENEDIS_Z_INDEX;
    pane.style.pointerEvents = "auto";
  }, [map]);
  return null;
}

function formatMwhLabel(mwh: number): string {
  return mwh.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

function enedisTooltipHtml(point: DiscoveryEnedisPoint): string {
  const naf = point.code_secteur_naf2
    ? `<div class="text-[10px] text-zinc-500">NAF ${point.code_secteur_naf2}</div>`
    : "";
  return `<div class="text-xs leading-snug">
    <div class="font-medium">${point.adresse.replace(/</g, "&lt;")}</div>
    <div class="tabular-nums">${formatMwhLabel(point.mwh)} MWh/an · ${point.annee}</div>
    ${naf}
  </div>`;
}

function pointsToFeatureCollection(
  points: readonly DiscoveryEnedisPoint[]
): GeoJSON.FeatureCollection<GeoJSON.Point, DiscoveryEnedisPoint> {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      id: p.id,
      properties: p,
      geometry: {
        type: "Point",
        coordinates: [p.lng, p.lat],
      },
    })),
  };
}

export type DiscoveryEnedisConsumptionLayerProps = {
  points: readonly DiscoveryEnedisPoint[];
  selectedEnedisId: string | null;
  onSelectEnedisId: (id: string | null) => void;
};

export const DiscoveryEnedisConsumptionLayer = memo(function DiscoveryEnedisConsumptionLayer({
  points,
  selectedEnedisId,
  onSelectEnedisId,
}: DiscoveryEnedisConsumptionLayerProps) {
  useEffect(() => {
    discoveryDebug("map", "DiscoveryEnedisConsumptionLayer", { pointCount: points.length });
  }, [points.length]);

  const geoJson = useMemo(() => pointsToFeatureCollection(points), [points]);

  const layerKey = useMemo(() => {
    if (points.length === 0) return "enedis:0";
    return `enedis:${points.length}:${points[0]!.id}:${points[points.length - 1]!.id}:sel:${selectedEnedisId ?? "-"}`;
  }, [points, selectedEnedisId]);

  const pointToLayer = useCallback(
    (feature: GeoJSON.Feature<GeoJSON.Point, DiscoveryEnedisPoint>, latlng: L.LatLng) => {
      const p = feature.properties;
      const selected = p.id === selectedEnedisId;
      return L.circleMarker(latlng, {
        pane: PANE_ENEDIS,
        interactive: true,
        radius: selected ? 8 : 6,
        color: ENEDIS_MARKER_AMBER,
        fillColor: selected ? "#fde68a" : ENEDIS_MARKER_FILL,
        fillOpacity: 0.95,
        weight: selected ? 3 : 2,
      });
    },
    [selectedEnedisId]
  );

  const onEachFeature = useCallback(
    (feature: GeoJSON.Feature<GeoJSON.Point, DiscoveryEnedisPoint>, layer: L.Layer) => {
      const p = feature.properties;
      if (!(layer instanceof L.CircleMarker)) return;
      const html = enedisTooltipHtml(p);
      layer.bindTooltip(html, {
        direction: "top",
        offset: [0, -8],
        opacity: 0.95,
      });
      layer.bindPopup(html, {
        closeButton: true,
        autoPan: true,
        className: "discovery-enedis-popup",
      });
      layer.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        const nextId = selectedEnedisId === p.id ? null : p.id;
        onSelectEnedisId(nextId);
        if (nextId != null) {
          layer.openPopup();
        } else {
          layer.closePopup();
        }
      });
    },
    [onSelectEnedisId, selectedEnedisId]
  );

  if (points.length === 0) return null;

  return (
    <>
      <DiscoveryEnedisPane />
      <GeoJSON
        key={layerKey}
        pane={PANE_ENEDIS}
        data={geoJson}
        pointToLayer={pointToLayer}
        onEachFeature={onEachFeature}
      />
    </>
  );
});
