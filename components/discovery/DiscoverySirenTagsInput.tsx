"use client";

import { useCallback, useRef } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { isCombosOverviewSirenExact } from "@/lib/discovery-combos-overview-http";
import { cn } from "@/lib/utils";

export type DiscoverySirenTagsInputProps = {
  value: readonly string[];
  draft: string;
  onValueChange: (sirens: string[]) => void;
  onDraftChange: (draft: string) => void;
  className?: string;
  maxSirens?: number;
};

const inputClassName = cn(
  "h-7 min-h-7 px-2 py-1 text-[11px] md:text-[11px] font-mono tabular-nums shadow-none",
  "bg-card dark:bg-card/80"
);

const tagClassName = cn(
  "inline-flex h-5 items-center gap-0.5 rounded-md border border-input bg-card px-1",
  "font-mono text-[10px] tabular-nums text-foreground"
);

function normalizeDraft(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 9);
}

function SirenTag({
  siren,
  onRemove,
}: {
  siren: string;
  onRemove: () => void;
}) {
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className={tagClassName}
    >
      {siren}
      <button
        type="button"
        className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={`Retirer le SIREN ${siren}`}
        onClick={onRemove}
      >
        <X className="size-2.5" aria-hidden />
      </button>
    </motion.span>
  );
}

export function DiscoverySirenTagsInput({
  value,
  draft,
  onValueChange,
  onDraftChange,
  className,
  maxSirens = 12,
}: DiscoverySirenTagsInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const atLimit = value.length >= maxSirens;

  const addSiren = useCallback(
    (raw: string) => {
      const siren = normalizeDraft(raw);
      if (!isCombosOverviewSirenExact(siren)) return;
      if (value.includes(siren)) {
        onDraftChange("");
        return;
      }
      if (atLimit) return;
      onValueChange([...value, siren]);
      onDraftChange("");
    },
    [atLimit, onDraftChange, onValueChange, value]
  );

  const removeSiren = useCallback(
    (siren: string) => {
      onValueChange(value.filter((s) => s !== siren));
      inputRef.current?.focus();
    },
    [onValueChange, value]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      if (draft.length === 0) return;
      if (isCombosOverviewSirenExact(draft)) {
        e.preventDefault();
        addSiren(draft);
      }
      return;
    }
    if (e.key === "Backspace" && draft.length === 0 && value.length > 0) {
      onValueChange(value.slice(0, -1));
    }
  };

  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
      <Input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        disabled={atLimit}
        aria-label="Ajouter un SIREN au filtre"
        placeholder={
          atLimit
            ? `Limite atteinte (${maxSirens})`
            : value.length === 0
              ? "SIREN (9 chiffres)"
              : "Ajouter…"
        }
        className={inputClassName}
        onChange={(e) => onDraftChange(normalizeDraft(e.target.value))}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (isCombosOverviewSirenExact(draft)) addSiren(draft);
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          const matches = text.match(/\d{9}/g);
          if (!matches?.length) return;
          e.preventDefault();
          const next = [...value];
          for (const m of matches) {
            if (next.length >= maxSirens) break;
            if (!next.includes(m)) next.push(m);
          }
          onValueChange(next);
          onDraftChange("");
        }}
      />
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <AnimatePresence mode="popLayout">
            {value.map((siren) => (
              <SirenTag
                key={siren}
                siren={siren}
                onRemove={() => removeSiren(siren)}
              />
            ))}
          </AnimatePresence>
        </div>
      ) : null}
    </div>
  );
}
