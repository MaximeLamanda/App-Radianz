"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ProspectDisplayNameEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Nom généré (découverte / POI) — info-bulle si différent de la valeur saisie. */
  generatedHint?: string;
  placeholder?: string;
  variant?: "discovery-hero" | "prospect-card";
  id?: string;
  "aria-label"?: string;
}

const discoveryTitleTypography =
  "font-sans text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-[1.65rem]";
const prospectCardTitleTypography =
  "text-xl font-medium leading-tight text-foreground";

/** Affichage titre + édition au clic sur une icône discrète. */
export function ProspectDisplayNameEditor({
  value,
  onChange,
  generatedHint,
  placeholder = "Nom du prospect",
  variant = "prospect-card",
  id,
  "aria-label": ariaLabel = "Nom du prospect",
}: ProspectDisplayNameEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    const el = inputRef.current;
    el?.focus();
    el?.select();
  }, [isEditing]);

  const trimmedHint = generatedHint?.trim();
  const readTitle =
    trimmedHint && trimmedHint !== value.trim()
      ? `Nom d’origine : ${trimmedHint}`
      : value.trim() || placeholder;

  const displayText = value.trim() || placeholder;
  const isPlaceholderDisplay = !value.trim();

  const isDiscovery = variant === "discovery-hero";
  const typography = isDiscovery ? discoveryTitleTypography : prospectCardTitleTypography;

  const commit = () => {
    onChange(draft);
    setIsEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setIsEditing(false);
  };

  const titleClassName = cn(
    "min-w-0 flex-1 text-balance",
    typography,
    isDiscovery ? "drawer-discovery-title" : "m-0 truncate"
  );

  const editInputClassName = cn(
    titleClassName,
    "w-full border-0 bg-transparent p-0 shadow-none outline-none",
    "rounded-sm focus-visible:ring-1 focus-visible:ring-border focus-visible:ring-offset-0",
    "placeholder:text-muted-foreground/60"
  );

  const iconSpacer = <span className="inline-block h-7 w-7 shrink-0" aria-hidden />;

  if (isEditing) {
    return (
      <div className="group/name flex min-w-0 flex-1 items-center gap-0.5">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          title={readTitle}
          aria-label={ariaLabel}
          autoComplete="organization"
          className={editInputClassName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
        />
        {iconSpacer}
      </div>
    );
  }

  const TitleTag = isDiscovery ? "h3" : "p";

  return (
    <div className="group/name flex min-w-0 flex-1 items-center gap-0.5">
      <TitleTag
        className={cn(titleClassName, isPlaceholderDisplay && "text-muted-foreground")}
        title={readTitle}
      >
        {displayText}
      </TitleTag>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7 shrink-0 text-muted-foreground/40 hover:bg-muted/50 hover:text-muted-foreground",
          "opacity-40 transition-opacity group-hover/name:opacity-70 focus-visible:opacity-100"
        )}
        onClick={() => setIsEditing(true)}
        aria-label="Modifier le nom"
        title="Modifier le nom"
      >
        <Pencil className="h-3 w-3" strokeWidth={1.75} aria-hidden />
      </Button>
    </div>
  );
}

/** Nom à persister : saisie utilisateur, sinon repli fourni. */
export function resolveProspectDisplayNameForSave(
  draft: string,
  fallback: string
): string {
  const trimmed = draft.trim();
  if (trimmed) return trimmed;
  const fb = fallback.trim();
  return fb || "Prospect";
}
