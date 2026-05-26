"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DiscoveryNafDivisionOption } from "@/lib/discovery-naf-divisions";
import { searchNafRev2Divisions, formatNafRev2DivisionOption } from "@/lib/naf-rev2-division-labels";

export type DiscoveryNafDivisionPickerProps = {
  value: string;
  onValueChange: (code: string) => void;
  /** Divisions du viewport en tête + référentiel complet. */
  options: readonly DiscoveryNafDivisionOption[];
  className?: string;
};

export function DiscoveryNafDivisionPicker({
  value,
  onValueChange,
  options,
  className,
}: DiscoveryNafDivisionPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = options.find((o) => o.code === value);
  const triggerLabel = selected?.displayLabel ?? (value ? formatNafRev2DivisionOption(value) : null);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const hits = new Set(searchNafRev2Divisions(search).map((d) => d.code));
    return options.filter((o) => hits.has(o.code));
  }, [options, search]);

  const inViewport = filteredOptions.filter((o) => o.count > 0);
  const other = filteredOptions.filter((o) => o.count === 0);

  return (
    <div className={cn("flex gap-1.5", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Choisir une division NAF"
            className={cn(
              "h-7 min-h-7 min-w-0 flex-1 justify-between gap-1.5 px-2 py-1 text-[11px] font-normal shadow-none",
              "bg-card dark:bg-card/80",
              !triggerLabel && "text-muted-foreground"
            )}
          >
            <span className="min-w-0 truncate text-left">
              {triggerLabel ?? "Division NAF…"}
            </span>
            <ChevronsUpDown className="size-3 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="z-[1200] w-[min(100vw-2rem,22rem)] p-0"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Rechercher (code ou activité)…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-64">
              <CommandEmpty>Aucune division trouvée.</CommandEmpty>
              {inViewport.length > 0 ? (
                <CommandGroup heading="Dans la vue carte">
                  {inViewport.map((opt) => (
                    <CommandItem
                      key={`vp-${opt.code}`}
                      value={opt.code}
                      onSelect={() => {
                        onValueChange(opt.code === value ? "" : opt.code);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4 shrink-0",
                          value === opt.code ? "opacity-100" : "opacity-0"
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{opt.displayLabel}</span>
                        <span className="text-xs text-muted-foreground">
                          {opt.count.toLocaleString("fr-FR")} combo{opt.count > 1 ? "s" : ""}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {other.length > 0 ? (
                <CommandGroup heading={inViewport.length > 0 ? "Autres divisions" : "Toutes les divisions"}>
                  {other.map((opt) => (
                    <CommandItem
                      key={opt.code}
                      value={opt.code}
                      onSelect={() => {
                        onValueChange(opt.code === value ? "" : opt.code);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4 shrink-0",
                          value === opt.code ? "opacity-100" : "opacity-0"
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 truncate text-sm">{opt.displayLabel}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="Effacer le filtre NAF"
          onClick={() => onValueChange("")}
        >
          <X className="size-3" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
