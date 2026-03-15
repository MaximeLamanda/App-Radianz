"use client";

import Image from "next/image";

const MOCK_PANEL = {
  name: "Longi Hi-MO 6",
  imageUrl: "/panel-longi.jpeg",
  costEur: "142",
  powerW: 450,
  warrantyYears: 25,
};

const MOCK_INVERTER = {
  name: "SMA Sunny Tripower",
  imageUrl: "/inverter-sunny-tripower.webp",
  costEur: "1250",
  powerW: 60000,
  warrantyYears: 20,
};

/** Mini carte panneau/onduleur - même structure que le drawer, taille réduite */
function MiniRefCard({
  name,
  imageUrl,
  costEur,
  powerW,
  warrantyYears,
}: {
  name: string;
  imageUrl: string;
  costEur: string;
  powerW: number;
  warrantyYears: number;
}) {
  const powerLabel = powerW >= 1000 ? `${Math.round(powerW / 1000)} kW` : `${powerW} W`;
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-white p-1.5 shadow-xs dark:border-zinc-700 dark:bg-zinc-900">
      <div className="size-8 shrink-0 overflow-hidden rounded-md bg-muted">
        <Image src={imageUrl} alt={name} width={32} height={32} className="size-full object-cover" unoptimized />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[8px] font-semibold lg:text-[9px]">{name}</p>
        <p className="flex items-center gap-1 text-[7px] text-muted-foreground lg:text-[8px]">
          <span>€{costEur}</span>
          <span className="opacity-50">|</span>
          <span>{powerLabel}</span>
          <span className="opacity-50">|</span>
          <span>{warrantyYears}y</span>
        </p>
      </div>
    </div>
  );
}

export function IllustrationMaterial() {
  return (
    <div className="relative min-h-[280px] rounded-xl bg-zinc-200 dark:bg-zinc-700 lg:min-h-[360px] overflow-visible">
      <div className="absolute inset-0 overflow-hidden rounded-xl">
        <Image
        src="/amazon-platform-lyon.png"
        alt="Amazon Platform Lyon - vue satellite"
        fill
        className="object-cover"
        sizes="(max-width: 1024px) 448px, 512px"
        />
      </div>
      {/* Carte panneau + onduleur - même style que le drawer, version mini */}
      <div className="absolute left-2 bottom-4 w-[160px] min-w-[160px] rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-white lg:left-4 lg:bottom-6 lg:w-[190px] lg:min-w-[190px] lg:rounded-xl lg:p-2.5">
        <h3 className="mb-1 text-[8px] font-semibold lg:mb-1.5 lg:text-[9px]">Références</h3>
        <div className="space-y-1 lg:space-y-1.5">
          <MiniRefCard {...MOCK_PANEL} />
          <MiniRefCard {...MOCK_INVERTER} />
        </div>
      </div>
    </div>
  );
}
