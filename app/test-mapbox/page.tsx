"use client";

import { useState } from "react";

// Roinville (coords du projet)
const LAT = 48.5311;
const LNG = 2.0508;
const ZOOM = 15;
const W = 400;
const H = 300;

function buildMapboxStaticUrl(
  lng: number,
  lat: number,
  zoom: number,
  width: number,
  height: number,
  style: "satellite-v9" | "streets-v12"
): string {
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (!token) return "";
  return `https://api.mapbox.com/styles/v1/mapbox/${style}/static/${lng},${lat},${zoom}/${width}x${height}?access_token=${token}`;
}

export default function TestMapboxPage() {
  const [imgError, setImgError] = useState<"satellite" | "streets" | null>(null);
  const [loaded, setLoaded] = useState({ streets: false, satellite: false });

  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();
  const urlSatellite = token ? buildMapboxStaticUrl(LNG, LAT, ZOOM, W, H, "satellite-v9") : "";
  const urlStreets = token ? buildMapboxStaticUrl(LNG, LAT, ZOOM, W, H, "streets-v12") : "";

  return (
    <div className="min-h-screen p-6 bg-gray-100">
      <h1 className="text-2xl font-bold mb-2">Test Mapbox Static API</h1>
      <p className="text-sm text-gray-600 mb-6">
        Coordonnées : {LAT}, {LNG} (Roinville) · Zoom {ZOOM} · {W}×{H}px
      </p>

      {!token ? (
        <div className="bg-amber-100 border border-amber-400 text-amber-800 px-4 py-3 rounded">
          <strong>Clé Mapbox manquante.</strong> Ajoutez <code className="bg-amber-200 px-1 rounded">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> dans{" "}
          <code className="bg-amber-200 px-1 rounded">.env.local</code> et redémarrez le serveur.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-2">Style Streets (plan)</h2>
            {urlStreets ? (
              <img
                src={urlStreets}
                alt="Mapbox Streets"
                className="border border-gray-200 rounded max-w-full h-auto"
                onLoad={() => { setImgError((e) => (e === "streets" ? null : e)); setLoaded((l) => ({ ...l, streets: true })); }}
                onError={() => setImgError("streets")}
              />
            ) : null}
            {imgError === "streets" && (
              <p className="mt-2 text-red-600 text-sm">Erreur chargement image (vérifiez le token).</p>
            )}
          </div>

          <div className="bg-white p-4 rounded-lg shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-2">Style Satellite</h2>
            {urlSatellite ? (
              <img
                src={urlSatellite}
                alt="Mapbox Satellite"
                className="border border-gray-200 rounded max-w-full h-auto"
                onLoad={() => { setImgError((e) => (e === "satellite" ? null : e)); setLoaded((l) => ({ ...l, satellite: true })); }}
                onError={() => setImgError("satellite")}
              />
            ) : null}
            {imgError === "satellite" && (
              <p className="mt-2 text-red-600 text-sm">Erreur chargement image (vérifiez le token).</p>
            )}
          </div>

          {loaded.streets && loaded.satellite && !imgError && (
            <p className="text-green-700 font-medium">Les deux images se sont chargées : la clé Mapbox est valide.</p>
          )}
        </div>
      )}
    </div>
  );
}
