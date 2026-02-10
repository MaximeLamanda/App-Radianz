"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

const SCRIPT_TIMEOUT_MS = 15000;

declare global {
  interface Window {
    __MAP_READY__?: boolean;
    initSnapshotMap?: () => void;
  }
}

export default function SnapshotMapPage() {
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const lat = Number(searchParams.get("lat") ?? "48.53");
  const lng = Number(searchParams.get("lng") ?? "2.05");
  const zoom = Math.min(21, Math.max(0, Number(searchParams.get("zoom") ?? "15")));
  const w = Math.min(1200, Math.max(100, Number(searchParams.get("w") ?? "400")));
  const h = Math.min(1200, Math.max(100, Number(searchParams.get("h") ?? "300")));

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey?.trim()) {
      setError("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY manquant");
      return;
    }

    if (!containerRef.current) return;

    window.__MAP_READY__ = false;

    if (window.google?.maps?.Map) {
      initMap(apiKey);
      return;
    }

    const existing = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existing) {
      const check = setInterval(() => {
        if (window.google?.maps?.Map) {
          clearInterval(check);
          initMap(apiKey);
        }
      }, 100);
      return () => clearInterval(check);
    }

    const t = setTimeout(() => {
      if (!window.__MAP_READY__) setError("Timeout chargement Google Maps");
    }, SCRIPT_TIMEOUT_MS);

    window.initSnapshotMap = () => {
      clearTimeout(t);
      if (window.google?.maps?.Map) initMap(apiKey);
      else setError("Google Maps non chargée");
      delete window.initSnapshotMap;
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initSnapshotMap`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      clearTimeout(t);
      setError("Erreur chargement script Maps");
      delete window.initSnapshotMap;
    };
    document.head.appendChild(script);

    return () => clearTimeout(t);
  }, [lat, lng, zoom, w, h]);

  function initMap(apiKey: string) {
    if (!containerRef.current || !window.google?.maps) return;
    const maps = window.google.maps;

    const map = new maps.Map(containerRef.current, {
      center: { lat, lng },
      zoom,
      mapTypeId: maps.MapTypeId.SATELLITE,
      disableDefaultUI: true,
      zoomControl: false,
      mapTypeControl: false,
      scaleControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });

    let readyFired = false;
    maps.event.addListenerOnce(map, "idle", () => {
      if (!readyFired) {
        readyFired = true;
        window.__MAP_READY__ = true;
      }
    });
  }

  if (error) {
    return (
      <div id="snapshot-map" ref={containerRef} style={{ width: w, height: h, background: "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#c00", padding: 16 }}>{error}</p>
      </div>
    );
  }

  return (
    <div
      id="snapshot-map"
      ref={containerRef}
      style={{ width: w, height: h, minHeight: h }}
      data-testid="snapshot-map"
    />
  );
}
