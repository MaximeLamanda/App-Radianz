"use client";

import React, { useState, type ReactNode } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

export interface EquipmentSelectCardProps<T> {
  value: T | null;
  options: T[];
  onChange: (item: T | null) => void;
  getItemId: (item: T) => string;
  /** Contenu du trigger quand un élément est sélectionné (image/icône + nom + métadonnées) */
  renderTriggerContent: (item: T, ctx: { badges: ReactNode }) => ReactNode;
  /** Contenu de chaque option dans la liste du popover */
  renderOptionContent: (item: T, selected: boolean) => ReactNode;
  /** Icône ou texte affiché quand aucune sélection (ex. "Choisir un panneau") */
  placeholder: ReactNode;
  /** Affiche le badge "recommandé" (noir) */
  showRecommendedBadge?: boolean;
  /** Badge à droite au-dessus du bouton (ex. nombre de panneaux "24", ou "1" pour 1 modèle) */
  rightBadge?: ReactNode;
  /** Title (tooltip) du rightBadge */
  rightBadgeTitle?: string;
  /** Badge d’avertissement qui remplace "recommandé" quand présent (ex. "Changer de modèle") */
  warningBadge?: ReactNode;
}

export function EquipmentSelectCard<T>({
  value,
  options,
  onChange,
  getItemId,
  renderTriggerContent,
  renderOptionContent,
  placeholder,
  showRecommendedBadge = false,
  rightBadge,
  rightBadgeTitle,
  warningBadge,
}: EquipmentSelectCardProps<T>) {
  const [open, setOpen] = useState(false);

  if (!options.length) return null;

  const badges = (
    <>
      {warningBadge}
      {rightBadge != null && (
        React.isValidElement(rightBadge) ? (
          <span className="inline-flex items-center" title={rightBadgeTitle}>
            {rightBadge}
          </span>
        ) : (
          <span
            className="inline-flex items-center rounded-md bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700"
            title={rightBadgeTitle}
          >
            {rightBadge}
          </span>
        )
      )}
    </>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="w-full h-auto rounded-xl border border-border bg-white p-3 flex items-stretch gap-3 justify-start text-left hover:bg-muted/50 focus:outline-none font-normal text-xs"
        >
          {value ? (
            renderTriggerContent(value, { badges })
          ) : (
            <div className="w-full flex items-center justify-center gap-2 py-2 text-muted-foreground text-xs">
              {placeholder}
            </div>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-w-[360px] p-2"
        align="start"
      >
        <div className="space-y-1 max-h-[280px] overflow-y-auto">
          {options.map((option) => {
            const id = getItemId(option);
            const selected = value ? getItemId(value) === id : false;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={`w-full rounded-xl border p-2 flex items-stretch gap-2 text-left transition-colors hover:bg-muted/50 focus:outline-none ${
                  selected
                    ? "border-accent-lime bg-accent-lime/10 ring-1 ring-accent-lime/40"
                    : "border-border bg-white"
                }`}
              >
                {renderOptionContent(option, selected)}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Affiche une vignette image ou une icône de fallback dans le trigger ou la liste */
export function EquipmentThumbnail({
  imageUrl,
  alt,
  fallback,
  size = "md",
}: {
  imageUrl?: string | null;
  alt: string;
  fallback: ReactNode;
  size?: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "w-10 h-10" : "w-12 h-12";
  return (
    <div className={`shrink-0 ${sizeClass} rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center`}>
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={alt}
          width={size === "sm" ? 40 : 48}
          height={size === "sm" ? 40 : 48}
          className="w-full h-full object-cover"
          unoptimized
        />
      ) : (
        fallback
      )}
    </div>
  );
}
