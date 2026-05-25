"use client";

import { memo, useMemo, useRef } from "react";
import { renderToString } from "react-dom/server";
import L from "leaflet";
import { Marker } from "react-leaflet";
import type { DiscoveryComboBuildingNumberLabel } from "@/lib/discovery-combo-building-labels";
import { isDiscoveryBuildingSelected } from "@/lib/discovery-combo-building-selection";
import { BRAND_LIME, BRAND_LIME_FOREGROUND, BRAND_LINE, BRAND_MUTED } from "@/lib/brand-colors";

const LABEL_SIZE_PX = 18;

function numberDivIcon(n: number, selected: boolean): L.DivIcon {
  return L.divIcon({
    html: renderToString(
      <span
        style={{
          display: "flex",
          width: LABEL_SIZE_PX,
          height: LABEL_SIZE_PX,
          alignItems: "center",
          justifyContent: "center",
          transform: "translate(-50%, -50%)",
          backgroundColor: selected ? BRAND_LIME : "#FFFFFF",
          color: selected ? BRAND_LIME_FOREGROUND : BRAND_MUTED,
          border: selected ? "none" : `1px solid ${BRAND_LINE}`,
          fontSize: 11,
          fontWeight: 400,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        {n}
      </span>
    ),
    className: "!bg-transparent !border-0 !shadow-none",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/**
 * Numéro dans un carré lime (sélectionné) ou blanc (exclu) — clic pour basculer.
 */
export const DiscoveryComboBuildingNumberLabelsLayer = memo(
  function DiscoveryComboBuildingNumberLabelsLayer({
    labels,
    selectedBuildingIds,
    onToggleBuilding,
  }: {
    labels: readonly DiscoveryComboBuildingNumberLabel[];
    selectedBuildingIds: ReadonlySet<string>;
    onToggleBuilding: (selectionId: string) => void;
  }) {
    const onToggleRef = useRef(onToggleBuilding);
    onToggleRef.current = onToggleBuilding;

    if (labels.length === 0) return null;

    return (
      <>
        {labels.map((lb) => {
          if (!lb.selectionId) return null;
          const selected = isDiscoveryBuildingSelected(selectedBuildingIds, lb.selectionId);
          return (
            <BuildingNumberMarker
              key={`bld-num-${lb.selectionId}-${lb.number}`}
              label={lb}
              selected={selected}
              onToggleRef={onToggleRef}
            />
          );
        })}
      </>
    );
  }
);

function BuildingNumberMarker({
  label,
  selected,
  onToggleRef,
}: {
  label: DiscoveryComboBuildingNumberLabel;
  selected: boolean;
  onToggleRef: React.RefObject<(selectionId: string) => void>;
}) {
  const icon = useMemo(() => numberDivIcon(label.number, selected), [label.number, selected]);
  return (
    <Marker
      position={[label.lat, label.lng]}
      icon={icon}
      interactive
      zIndexOffset={1600}
      eventHandlers={{
        click: (e) => {
          L.DomEvent.stopPropagation(e.originalEvent);
          onToggleRef.current?.(label.selectionId);
        },
      }}
    />
  );
}
