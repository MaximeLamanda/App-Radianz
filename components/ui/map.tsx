"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { renderToString } from "react-dom/server";
import { MapPin, Minus, Plus } from "lucide-react";
import L from "leaflet";
import {
  BRAND_INK,
  BRAND_LIME,
  BRAND_LIME_FOREGROUND,
  BRAND_LIME_HOVER,
} from "@/lib/brand-colors";
import { disableLeafletDefaultMarkerIcon } from "@/lib/leaflet-marker-icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { MapContainerProps, MarkerProps, TileLayerProps } from "react-leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-markercluster";

disableLeafletDefaultMarkerIcon();

/** Instance de cluster Leaflet.markercluster (pas typée dans `@types/leaflet`). */
type LeafletMarkerCluster = L.Marker & { getChildCount(): number };

/** Fond clair CARTO (style shadcn-map, thème blanc). */
const CARTO_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Imagerie satellite (fond par défaut possible pour Discovery, etc.). */
export const ESRI_WORLD_IMAGERY_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export const ESRI_WORLD_IMAGERY_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export type MapZoomControlPosition = "topleft" | "topright" | "bottomleft" | "bottomright";

/** `minimal` : pas de bordure sur le groupe ni sur les boutons (pile verticale unifiée). */
export type MapZoomControlVariant = "default" | "minimal";

export type MapProps = Omit<MapContainerProps, "children"> & {
  children?: React.ReactNode;
};

/**
 * Conteneur carte (Leaflet / react-leaflet v4), aligné sur
 * https://shadcn-map.vercel.app/docs — Map + MapTileLayer + MapZoomControl.
 *
 * Ne pas combiner `className` avec `min-h-0` seul en parent flex : tailwind-merge peut
 * faire gagner `min-h-0` sur `min-h-[320px]` ci-dessous → hauteur 0 et carte invisible.
 */
export function Map({
  className,
  children,
  scrollWheelZoom = true,
  /** Désactivé par défaut : on utilise `MapZoomControl` (sinon doublon +/- Leaflet). */
  zoomControl = false,
  ...props
}: MapProps) {
  return (
    <MapContainer
      className={cn(
        "relative z-0 h-full min-h-[320px] w-full rounded-lg border border-zinc-200 bg-white [&.leaflet-container]:!bg-white [&.leaflet-container]:!font-sans",
        className
      )}
      scrollWheelZoom={scrollWheelZoom}
      zoomControl={zoomControl}
      {...props}
    >
      {children}
    </MapContainer>
  );
}

export function MapTileLayer(props: Partial<TileLayerProps>) {
  const { url, attribution, ...rest } = props;
  return (
    <TileLayer
      attribution={attribution ?? CARTO_ATTRIBUTION}
      url={url ?? CARTO_LIGHT}
      {...rest}
    />
  );
}

const ZOOM_CONTROL_POSITION: Record<MapZoomControlPosition, string> = {
  topleft: "left-2 top-2",
  topright: "right-2 top-2",
  bottomleft: "bottom-4 left-2",
  bottomright: "bottom-4 right-2",
};

const ZOOM_CONTROL_WRAPPER: Record<MapZoomControlVariant, string> = {
  default:
    "rounded-lg border border-zinc-200 bg-white p-0.5 shadow-sm",
  minimal:
    "rounded-lg border-0 bg-white/95 p-0 shadow-sm backdrop-blur-sm",
};

const ZOOM_CONTROL_BTN: Record<MapZoomControlVariant, string> = {
  default:
    "size-9 shrink-0 border-zinc-200 bg-white text-zinc-900 shadow-none hover:bg-zinc-50",
  minimal:
    "size-9 shrink-0 rounded-none border-0 bg-transparent text-zinc-900 shadow-none hover:bg-zinc-100/80",
};

function MapZoomControlInner({
  position,
  controlVariant,
}: {
  position: MapZoomControlPosition;
  controlVariant: MapZoomControlVariant;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setContainer(map.getContainer());
  }, [map]);

  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  if (!container) return null;

  const maxZ = map.getMaxZoom();
  const minZ = map.getMinZoom();

  const btnVariant = controlVariant === "minimal" ? "ghost" : "outline";

  return createPortal(
    <div
      className={cn(
        "pointer-events-auto absolute z-[1000] flex flex-col overflow-hidden",
        controlVariant === "default" && "gap-0.5",
        controlVariant === "minimal" && "gap-0",
        ZOOM_CONTROL_WRAPPER[controlVariant],
        ZOOM_CONTROL_POSITION[position]
      )}
    >
      <Button
        type="button"
        variant={btnVariant}
        size="icon"
        className={cn(ZOOM_CONTROL_BTN[controlVariant])}
        aria-label="Zoom avant"
        disabled={zoom >= maxZ}
        onClick={() => map.zoomIn()}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        type="button"
        variant={btnVariant}
        size="icon"
        className={cn(ZOOM_CONTROL_BTN[controlVariant])}
        aria-label="Zoom arrière"
        disabled={zoom <= minZ}
        onClick={() => map.zoomOut()}
      >
        <Minus className="size-4" />
      </Button>
    </div>,
    container
  );
}

/** Contrôles +/- style carte shadcn (pas le contrôle natif Leaflet). */
export function MapZoomControl({
  position = "bottomleft",
  variant = "default",
}: {
  position?: MapZoomControlPosition;
  /** `minimal` : groupe et boutons sans bordure. */
  variant?: MapZoomControlVariant;
}) {
  return <MapZoomControlInner position={position} controlVariant={variant} />;
}

/**
 * Marqueur Leaflet (react-leaflet) avec icône HTML alignée sur
 * [shadcn-map MapMarker](https://shadcn-map.vercel.app/docs/api) — DivIcon + contenu React sérialisé.
 */
export type MapMarkerProps = Omit<MarkerProps, "icon"> & {
  icon?: React.ReactNode;
  iconAnchor?: [number, number];
  /** Pastille lime (sélection Discovery, etc.). */
  selected?: boolean;
};

export function MapMarker({
  icon,
  iconAnchor = [12, 12],
  selected = false,
  zIndexOffset,
  ...props
}: MapMarkerProps) {
  const leafletIcon = useMemo(() => {
    const node = icon ?? (
      <MapPin
        className="size-3.5"
        style={{ color: selected ? BRAND_LIME_FOREGROUND : BRAND_INK }}
        aria-hidden
      />
    );
    const wrap = selected ? (
      <div
        className="flex size-7 items-center justify-center rounded-full border-2 shadow-md [&>svg]:shrink-0"
        style={{
          borderColor: BRAND_LIME_HOVER,
          backgroundColor: BRAND_LIME,
          boxShadow: `0 0 0 2px ${BRAND_LIME}99`,
        }}
      >
        {node}
      </div>
    ) : (
      <div className="flex size-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-sm [&>svg]:shrink-0">
        {node}
      </div>
    );
    const html = renderToString(wrap);
    return L.divIcon({
      html,
      className: "!flex !items-center !justify-center !bg-transparent",
      iconAnchor: L.point(iconAnchor[0], iconAnchor[1]),
      iconSize: selected ? [28, 28] : [24, 24],
    });
  }, [icon, iconAnchor, selected]);

  return (
    <Marker
      icon={leafletIcon}
      zIndexOffset={zIndexOffset ?? (selected ? 1000 : 0)}
      {...props}
    />
  );
}

export type MapMarkerClusterGroupProps = Omit<
  ComponentProps<typeof MarkerClusterGroup>,
  "iconCreateFunction"
> & {
  /** Comme shadcn-map : rendu en cluster (prioritaire sur `iconCreateFunction` Leaflet). */
  icon?: (markerCount: number) => React.ReactNode;
  iconCreateFunction?: (cluster: LeafletMarkerCluster) => L.Icon | L.DivIcon;
};

/**
 * Regroupement de marqueurs — même principe que
 * [MapMarkerClusterGroup shadcn-map](https://shadcn-map.vercel.app/docs/api) (`react-leaflet-markercluster`).
 */
export function MapMarkerClusterGroup({
  icon,
  iconCreateFunction: userIconCreate,
  children,
  ...rest
}: MapMarkerClusterGroupProps) {
  const iconRef = useRef(icon);
  const userIconCreateRef = useRef(userIconCreate);
  iconRef.current = icon;
  userIconCreateRef.current = userIconCreate;

  const usesShadcnIcon = icon != null || userIconCreate != null;

  /** Référence stable pour Leaflet : évite de recréer tous les clusters à chaque rendu React (ex. pan → parent). */
  const stableCustomIconCreate = useMemo(
    () => (cluster: LeafletMarkerCluster) => {
      const user = userIconCreateRef.current;
      if (user) return user(cluster);
      const ic = iconRef.current;
      const markerCount = cluster.getChildCount();
      const inner = ic ? ic(markerCount) : markerCount;
      const html = renderToString(
        <div className="border-popover-foreground/15 bg-popover text-popover-foreground flex size-10 items-center justify-center rounded-full border font-semibold shadow-md">
          {inner}
        </div>
      );
      return L.divIcon({
        html,
        className: "!flex !items-center !justify-center !bg-transparent",
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
    },
    []
  );

  return (
    <MarkerClusterGroup
      iconCreateFunction={usesShadcnIcon ? stableCustomIconCreate : undefined}
      {...rest}
    >
      {children}
    </MarkerClusterGroup>
  );
}
