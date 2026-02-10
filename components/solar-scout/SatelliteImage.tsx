"use client";

import { useState, useRef, useEffect } from "react";
import { getSatelliteImageUrl } from "@/lib/satellite-image";
import { getMapboxStaticUrl, hasMapboxToken } from "@/lib/mapbox-static";
import type { AddressCoordinates } from "@/types";
import { MapPin, AlertCircle } from "lucide-react";

interface SatelliteImageProps {
  coordinates: AddressCoordinates;
  address: string;
  className?: string;
  zoom?: number;
  width?: number;
  height?: number;
  onClick?: () => void;
}

/**
 * Aperçu statique du lieu : préfère Mapbox satellite si la clé est configurée,
 * sinon Google roadmap (EEA : satellite statique non dispo côté Google).
 */
export function SatelliteImage({
  coordinates,
  address,
  className = "",
  zoom = 16,
  width = 400,
  height = 300,
  onClick,
}: SatelliteImageProps) {
  const [hasError, setHasError] = useState(false);
  const [useMapbox, setUseMapbox] = useState(hasMapboxToken());
  const [isEeaError, setIsEeaError] = useState(false);
  const prevKey = useRef<string | null>(null);
  const key = `${coordinates.lat.toFixed(4)}-${coordinates.lng.toFixed(4)}`;

  useEffect(() => {
    if (prevKey.current !== key) {
      prevKey.current = key;
      setHasError(false);
      setIsEeaError(false);
      setUseMapbox(hasMapboxToken());
    }
  }, [key]);

  const mapboxUrl = useMapbox ? getMapboxStaticUrl(coordinates, width, height, zoom, "satellite-v9") : "";
  const googleUrl = getSatelliteImageUrl(coordinates, address, width, height, zoom, "roadmap");

  const imageUrl = mapboxUrl || googleUrl;
  const isSatellite = !!mapboxUrl && useMapbox;

  const handleError = async () => {
    if (useMapbox && mapboxUrl) {
      setUseMapbox(false);
      setHasError(false);
      return;
    }
    setHasError(true);
    try {
      const res = await fetch(googleUrl);
      const text = await res.text();
      const eea =
        res.status === 403 &&
        (text.toLowerCase().includes("cannot be served because") ||
          text.toLowerCase().includes("not available for this location") ||
          text.toLowerCase().includes("eea/"));
      setIsEeaError(eea);
    } catch {
      setIsEeaError(false);
    }
  };

  if (!imageUrl) {
    return (
      <div className={`flex h-48 w-full items-center justify-center rounded-md bg-gray-200 ${className}`}>
        <p className="text-center text-sm text-gray-500">Clé API manquante (Google ou Mapbox)</p>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className={`flex h-48 w-full items-center justify-center rounded-md bg-gray-200 ${className}`}>
        <div className="flex flex-col items-center gap-2 px-4 text-center">
          <AlertCircle className="h-8 w-8 text-red-500" />
          <p className="text-sm font-medium text-red-600">Aperçu carte indisponible</p>
          {isEeaError ? (
            <p className="text-xs text-gray-600">
              En EEA, l’image statique satellite n’est plus fournie par Google. Configurez Mapbox ou utilisez la carte interactive.
            </p>
          ) : (
            <p className="text-xs text-gray-500">Vérifiez la clé API et les restrictions.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative h-48 w-full overflow-hidden rounded-md border border-gray-200 ${className}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
    >
      <img
        src={imageUrl}
        alt={isSatellite ? `Aperçu satellite – ${address}` : `Aperçu carte – ${address}`}
        className="absolute inset-0 h-full w-full object-cover"
        onLoad={() => setHasError(false)}
        onError={handleError}
      />
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 bg-black/70 p-2 text-xs text-white">
        <MapPin className="h-3 w-3 shrink-0" />
        <span className="truncate">{address}</span>
      </div>
      <div className="absolute top-0 left-0 right-0 bg-black/50 px-2 py-1 text-center text-[10px] text-white">
        {isSatellite ? "Aperçu satellite (Mapbox)" : "Aperçu plan • Vue satellite sur la carte interactive"}
      </div>
    </div>
  );
}
