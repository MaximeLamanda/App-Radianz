"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { prospectContactInitials } from "@/lib/prospect-contacts";
import type { ProspectContact } from "@/types";
import { cn } from "@/lib/utils";

const SIZE_CLASS = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-[11px]",
} as const;

export type ProspectContactAvatarStackProps = {
  contacts: ProspectContact[];
  /** Nombre d'avatars visibles avant l'indicateur « +N ». */
  max?: number;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
};

/** Pile d'avatars chevauchants (pattern shadcn : `-space-x-2` + `ring-background`). */
export function ProspectContactAvatarStack({
  contacts,
  max = 3,
  size = "sm",
  className,
}: ProspectContactAvatarStackProps) {
  const withName = contacts.filter((c) => c.fullName.trim().length > 0);
  if (withName.length === 0) return null;

  const visible = withName.slice(0, max);
  const overflow = withName.length - visible.length;
  const title = withName.map((c) => c.fullName.trim()).join(", ");
  const sizeClass = SIZE_CLASS[size];

  return (
    <div
      className={cn("flex -space-x-2", className)}
      title={title}
      aria-label={title}
    >
      {visible.map((contact) => (
        <Avatar
          key={contact.id}
          className={cn(sizeClass, "ring-2 ring-background")}
        >
          <AvatarFallback className="bg-primary/10 font-semibold text-primary">
            {prospectContactInitials(contact)}
          </AvatarFallback>
        </Avatar>
      ))}
      {overflow > 0 ? (
        <Avatar className={cn(sizeClass, "ring-2 ring-background")}>
          <AvatarFallback className="bg-muted text-[10px] font-medium text-muted-foreground">
            +{overflow}
          </AvatarFallback>
        </Avatar>
      ) : null}
    </div>
  );
}
