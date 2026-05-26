"use client";

import type { V5ChargingStationEntry, V5ParkingEntry, V5ParkingParcelEntry, V5ParkingSource } from "@/lib/matching-v5-parking";
import {
  formatParkingAreaM2,
  parkingSourceHoverText,
  parkingSourceLabel,
} from "@/lib/matching-v5-parking";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  parkings: V5ParkingEntry[];
};

export function DiscoveryDrawerParkingSection({ parkings }: Props) {
  const enrCount = parkings.filter((p) => p.parkingSource === "enr").length;
  const osmCount = parkings.length - enrCount;

  return (
    <TooltipProvider delayDuration={200}>
      <section aria-labelledby="discovery-info-parking" className="space-y-2 border-t border-border pt-5">
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
          <div className="drawer-discovery-table-wrap">
            <Table className="text-[11px]">
              <TableHeader>
                <TableRow className="border-0 hover:bg-transparent">
                  <TableHead className="whitespace-nowrap">N°</TableHead>
                  <TableHead className="whitespace-nowrap">Source</TableHead>
                  <TableHead className="min-w-[10rem]">Nom</TableHead>
                  <TableHead className="whitespace-nowrap">Surface</TableHead>
                  <TableHead className="min-w-[8rem]">Parcelles</TableHead>
                  <TableHead className="whitespace-nowrap">Bornes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parkings.map((p, i) => (
                  <ParkingTableRow key={`${p.osmParkingType}:${p.osmParkingId}`} parking={p} index={i} />
                ))}
              </TableBody>
            </Table>
          </div>
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
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Survolez un parking sur la carte ou l’icône ℹ️ pour le détail.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function ParkingSourceBadge({ source }: { source: V5ParkingSource }) {
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
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset",
            badgeClass
          )}
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

function parkingTitle(parking: V5ParkingEntry): string {
  return (
    (parking.parkingName || "").trim() ||
    `Parking ${parking.osmParkingType}:${parking.osmParkingId}`
  );
}

function parkingParcelsForRow(parking: V5ParkingEntry): V5ParkingParcelEntry[] {
  if (parking.parkingParcels.length > 0) return parking.parkingParcels;
  return parking.commonParcels.map((c) => ({
    codeInsee: c.codeInsee,
    section: c.section,
    numeroNorm: c.numeroNorm,
  }));
}

function formatParcelleCell(parcels: V5ParkingParcelEntry[]): { label: string; title?: string } {
  if (parcels.length === 0) return { label: "—" };
  const lines = parcels.map((par) => {
    const base = `${par.section} ${par.numeroNorm}`.trim();
    if (par.intersectionAreaM2 != null) {
      return `${base} · ${Math.round(par.intersectionAreaM2).toLocaleString("fr-FR")} m²`;
    }
    return base;
  });
  return {
    label: lines.length === 1 ? lines[0]! : `${lines.length} parcelles`,
    title: lines.join("\n"),
  };
}

function formatBornesCell(stations: V5ChargingStationEntry[]): { label: string; title?: string } {
  if (stations.length === 0) return { label: "—" };
  const lines = stations.map((st) => {
    const cap = st.capacity ? ` · ${st.capacity} place(s)` : "";
    return `${st.poiTypeLabel}${cap}`;
  });
  if (stations.length === 1) {
    return { label: stations[0]!.poiTypeLabel, title: lines[0] };
  }
  return {
    label: String(stations.length),
    title: lines.join("\n"),
  };
}

function ParkingTableRow({ parking, index }: { parking: V5ParkingEntry; index: number }) {
  const title = parkingTitle(parking);
  const parcels = parkingParcelsForRow(parking);
  const parcelleCell = formatParcelleCell(parcels);
  const bornesCell = formatBornesCell(parking.chargingStations);

  return (
    <TableRow className="border-0 align-top">
      <TableCell className="min-w-0 whitespace-nowrap font-mono tabular-nums align-top">
        {index + 1}
      </TableCell>
      <TableCell className="min-w-0 align-top">
        <ParkingSourceBadge source={parking.parkingSource} />
      </TableCell>
      <TableCell className="min-w-0 align-top">
        <span className="block truncate font-medium text-foreground" title={title}>
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={parkingSourceLabel(parking.parkingSource)}>
          {parkingSourceLabel(parking.parkingSource)}
        </span>
      </TableCell>
      <TableCell className="min-w-0 whitespace-nowrap font-mono tabular-nums align-top">
        {formatParkingAreaM2(parking.parkingAreaM2)}
      </TableCell>
      <TableCell
        className="min-w-0 align-top font-mono text-[11px] text-muted-foreground"
        title={parcelleCell.title}
      >
        <span className="block min-w-0 text-foreground">{parcelleCell.label}</span>
      </TableCell>
      <TableCell className="min-w-0 whitespace-nowrap font-mono tabular-nums align-top" title={bornesCell.title}>
        {bornesCell.label}
      </TableCell>
    </TableRow>
  );
}
