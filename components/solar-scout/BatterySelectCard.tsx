"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Battery, FileCheck } from "lucide-react";
import { getCountryFlagUrl } from "@/lib/solar-settings";
import type { BatteryReference } from "@/types";

export function BatterySelectCard({
  value,
  onChange,
  batteries,
}: {
  value: BatteryReference | null;
  onChange: (b: BatteryReference | null) => void;
  batteries: BatteryReference[];
}) {
  const [open, setOpen] = useState(false);

  if (!batteries.length) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex justify-end items-center gap-1.5 mb-1">
        {value?.recommended && (
          <span className="inline-flex items-center rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
            recommandé
          </span>
        )}
        <span
          className="inline-flex items-center rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800"
          title="Paramètres utilisés dans les calculs (injection / tirage batterie)"
        >
          Calculs
        </span>
      </div>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="w-full h-auto rounded-xl border border-border bg-white p-3 flex items-stretch gap-3 hover:bg-muted/50 focus:outline-none font-normal text-xs"
        >
          {value ? (
            <>
              <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                {value.imageUrl ? (
                  <Image
                    src={value.imageUrl}
                    alt={value.name}
                    width={48}
                    height={48}
                    className="w-full h-full object-cover"
                    unoptimized
                  />
                ) : (
                  <Battery className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center text-left">
                <div className="font-semibold text-xs text-foreground truncate">
                  {value.name}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    €{value.costEur}
                  </span>
                  <span className="text-muted-foreground/40 text-xs">|</span>
                  <span
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                    title="Capacité utilisée dans la simulation"
                  >
                    <Battery className="h-3 w-3 text-muted-foreground/80" />
                    {value.capacityKwh} kWh
                  </span>
                  {value.warrantyYears != null && (
                    <>
                      <span className="text-muted-foreground/40 text-xs">|</span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <FileCheck className="h-3 w-3 text-muted-foreground/80" />
                        {value.warrantyYears}y
                      </span>
                    </>
                  )}
                  {value.countryCode && (
                    <>
                      <span className="text-muted-foreground/40 text-xs">|</span>
                      <span
                        className="inline-flex items-center shrink-0"
                        title={value.countryOfOrigin}
                      >
                        <img
                          src={getCountryFlagUrl(value.countryCode)}
                          alt=""
                          className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50"
                          width={12}
                          height={12}
                        />
                      </span>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="w-full flex items-center justify-center gap-2 py-2 text-muted-foreground text-xs">
              <Battery className="h-5 w-5" />
              Choisir une batterie
            </div>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-w-[360px] p-2"
        align="start"
      >
        <div className="space-y-1 max-h-[280px] overflow-y-auto">
          {batteries.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                onChange(b);
                setOpen(false);
              }}
              className={`w-full rounded-xl border p-2.5 flex items-stretch gap-2.5 text-left transition-colors hover:bg-muted/50 focus:outline-none ${
                value?.id === b.id
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border bg-white"
              }`}
            >
              <div className="shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                {b.imageUrl ? (
                  <Image
                    src={b.imageUrl}
                    alt=""
                    width={40}
                    height={40}
                    className="w-full h-full object-cover"
                    unoptimized
                  />
                ) : (
                  <Battery className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="font-medium text-xs text-foreground truncate">
                  {b.name}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] text-muted-foreground">
                  <span>€{b.costEur}</span>
                  <span>·</span>
                  <span>{b.capacityKwh} kWh</span>
                  <span>·</span>
                  <span>{b.powerChargeKw} kW</span>
                  {b.recommended && (
                    <span className="inline-flex items-center rounded bg-gray-900 px-1 py-0.5 text-[10px] font-medium text-white">
                      recommandé
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
