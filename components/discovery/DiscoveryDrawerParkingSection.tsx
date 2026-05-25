"use client";

import type { V5ChargingStationEntry, V5ParkingEntry, V5ParkingParcelEntry, V5ParkingSource } from "@/lib/matching-v5-parking";
import {
  formatParkingAreaM2,
  parkingSourceHoverText,
  parkingSourceLabel,
} from "@/lib/matching-v5-parking";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

type Props = {
  parkings: V5ParkingEntry[];
};

export function DiscoveryDrawerParkingSection({ parkings }: Props) {
  const enrCount = parkings.filter((p) => p.parkingSource === "enr").length;
  const osmCount = parkings.length - enrCount;

  return (
    <TooltipProvider delayDuration={200}>
      <section aria-labelledby="discovery-info-parking" className="space-y-2">
        <h4
          id="discovery-info-parking"
          className="drawer-discovery-section-title flex items-center justify-between gap-3"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-base uppercase tracking-tight text-black">Parking</span>
            <ParkingSourceLegend enrCount={enrCount} osmCount={osmCount} />
          </span>
          <span className="ml-auto shrink-0 font-mono text-[0.7rem] font-normal text-foreground">
            {parkings.length}
          </span>
        </h4>
        {parkings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
            Aucun parking associé à ce bâtiment (parcelle cadastrale commune requise).
          </div>
        ) : (
          <ul className="space-y-3">
            {parkings.map((p) => (
              <li
                key={`${p.osmParkingType}:${p.osmParkingId}`}
                className="rounded-xl border border-border/80 bg-muted/20 px-3 py-2.5 text-xs"
              >
                <ParkingCard parking={p} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </TooltipProvider>
  );
}

function ParkingSourceLegend({ enrCount, osmCount }: { enrCount: number; osmCount: number }) {
  if (enrCount === 0 && osmCount === 0) return null;
  const parts: string[] = [];
  if (enrCount > 0) parts.push(`${enrCount} ENR`);
  if (osmCount > 0) parts.push(`${osmCount} OSM`);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label="Sources des données parking"
        >
          <Info className="size-3.5" strokeWidth={2} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-xs">
        <p className="font-medium text-foreground">Sources</p>
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          <li>
            <span className="font-medium text-sky-700">ENR</span> — Portail énergies renouvelables
            (Geoplateforme), surfaces &gt; 500 m²
          </li>
          <li>
            <span className="font-medium text-amber-700">OSM</span> — OpenStreetMap
          </li>
        </ul>
        <p className="mt-1.5 text-[10px] text-muted-foreground">Survolez un parking sur la carte ou l’icône ℹ️ pour le détail.</p>
      </TooltipContent>
    </Tooltip>
  );
}

function ParkingSourceInfo({ source }: { source: V5ParkingSource }) {
  const short = source === "enr" ? "ENR" : "OSM";
  const badgeClass =
    source === "enr"
      ? "bg-sky-100 text-sky-800 ring-sky-200/80"
      : "bg-amber-100 text-amber-900 ring-amber-200/80";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${badgeClass}`}
          aria-label={`Source : ${parkingSourceHoverText(source)}`}
        >
          {short}
          <Info className="size-3 opacity-80" strokeWidth={2.25} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[220px] text-xs">
        {parkingSourceHoverText(source)}
      </TooltipContent>
    </Tooltip>
  );
}

function ParkingCard({ parking }: { parking: V5ParkingEntry }) {
  const title =
    (parking.parkingName || "").trim() ||
    `Parking ${parking.osmParkingType}:${parking.osmParkingId}`;
  const parcels: V5ParkingParcelEntry[] =
    parking.parkingParcels.length > 0
      ? parking.parkingParcels
      : parking.commonParcels.map((c) => ({
          codeInsee: c.codeInsee,
          section: c.section,
          numeroNorm: c.numeroNorm,
        }));

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 font-semibold text-foreground">{title}</div>
        <ParkingSourceInfo source={parking.parkingSource} />
      </div>
      <div className="text-muted-foreground">
        {parkingSourceLabel(parking.parkingSource)}
        {" · "}
        Surface :{" "}
        <span className="font-mono text-foreground">{formatParkingAreaM2(parking.parkingAreaM2)}</span>
      </div>
      <ParcelList parcels={parcels} />
      <ChargingList stations={parking.chargingStations} />
    </div>
  );
}

function ParcelList({ parcels }: { parcels: V5ParkingParcelEntry[] }) {
  if (parcels.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Parcelles (intersection)
      </div>
      <ul className="space-y-0.5 font-mono text-[11px] text-foreground/90">
        {parcels.map((par) => (
          <li key={`${par.section}-${par.numeroNorm}`}>
            {par.section} {par.numeroNorm}
            {par.intersectionAreaM2 != null
              ? ` · ${Math.round(par.intersectionAreaM2).toLocaleString("fr-FR")} m²`
              : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChargingList({ stations }: { stations: V5ChargingStationEntry[] }) {
  if (stations.length === 0) {
    return <div className="text-muted-foreground">Aucune borne sur les parcelles communes.</div>;
  }
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Bornes de recharge
      </div>
      <ul className="mt-1 space-y-1">
        {stations.map((st) => (
          <li key={`${st.osmType}:${st.osmId}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{st.poiTypeLabel}</span>
            {st.capacity ? <span className="text-muted-foreground">· {st.capacity} place(s)</span> : null}
            {st.osmUrl ? (
              <a
                href={st.osmUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-600 underline-offset-2 hover:underline"
              >
                OSM
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
