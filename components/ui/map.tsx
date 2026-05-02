"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import "leaflet/dist/leaflet.css";
import type { MapContainerProps, TileLayerProps } from "react-leaflet";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";

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
  bottomleft: "bottom-10 left-2",
  bottomright: "bottom-10 right-2",
};

function MapZoomControlInner({ position }: { position: MapZoomControlPosition }) {
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

  return createPortal(
    <div
      className={cn(
        "pointer-events-auto absolute z-[1000] flex flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white p-0.5 shadow-sm",
        ZOOM_CONTROL_POSITION[position]
      )}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 shrink-0 border-zinc-200 bg-white text-zinc-900 shadow-none hover:bg-zinc-50"
        aria-label="Zoom avant"
        disabled={zoom >= maxZ}
        onClick={() => map.zoomIn()}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9 shrink-0 border-zinc-200 bg-white text-zinc-900 shadow-none hover:bg-zinc-50"
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
export function MapZoomControl({ position = "topright" }: { position?: MapZoomControlPosition }) {
  return <MapZoomControlInner position={position} />;
}
