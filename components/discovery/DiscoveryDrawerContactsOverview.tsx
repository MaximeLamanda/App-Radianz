"use client";

import { useMemo } from "react";
import { Pencil, Trash2, Mail, Phone, Linkedin } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  PROSPECT_CONTACT_ORIGIN_KIND_LABEL,
  prospectContactInitials,
  resolveContactOriginMeta,
  type ProspectContactOriginLabelContext,
} from "@/lib/prospect-contacts";
import type { ProspectContact } from "@/types";

export type DiscoveryDrawerContactsOverviewPoi = {
  key: string;
  name: string;
};

export type DiscoveryContactOriginOptions = {
  pois: Array<{ ref: string; label: string }>;
  parcelles: Array<{ ref: string; label: string }>;
  etablissements: Array<{ ref: string; label: string }>;
};

export interface DiscoveryProjectContactsListProps {
  contacts: ProspectContact[] | undefined;
  originLabelContext: ProspectContactOriginLabelContext;
  allowManualActions?: boolean;
  onEditManual?: (contact: ProspectContact) => void;
  onDeleteManual?: (contact: ProspectContact) => void;
  emptyMessage?: string;
}

function ContactAvatar({ contact }: { contact: ProspectContact }) {
  const initials = prospectContactInitials(contact);
  return (
    <Avatar className="h-9 w-9 shrink-0" aria-hidden>
      <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

function ContactLinks({ contact }: { contact: ProspectContact }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {contact.email ? (
        <a
          href={`mailto:${contact.email}`}
          className="inline-flex items-center gap-1 text-[10px] text-foreground underline-offset-2 hover:underline"
        >
          <Mail className="h-3 w-3" aria-hidden />
          {contact.email}
        </a>
      ) : null}
      {contact.phone ? (
        <a
          href={`tel:${contact.phone}`}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-foreground underline-offset-2 hover:underline"
        >
          <Phone className="h-3 w-3" aria-hidden />
          {contact.phone}
        </a>
      ) : null}
      {contact.linkedinUrl ? (
        <a
          href={contact.linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-foreground underline-offset-2 hover:underline"
        >
          <Linkedin className="h-3 w-3" aria-hidden />
          LinkedIn
        </a>
      ) : null}
    </div>
  );
}

function ContactRow({
  contact,
  originLabelContext,
  allowManualActions,
  onEditManual,
  onDeleteManual,
}: {
  contact: ProspectContact;
  originLabelContext: ProspectContactOriginLabelContext;
  allowManualActions?: boolean;
  onEditManual?: (contact: ProspectContact) => void;
  onDeleteManual?: (contact: ProspectContact) => void;
}) {
  const isManual = contact.source === "manual";
  const origin = resolveContactOriginMeta(contact, originLabelContext);

  return (
    <li className="flex items-start justify-between gap-2 rounded-lg border border-border/70 bg-background px-3 py-2">
      <ContactAvatar contact={contact} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{contact.fullName}</p>
        {contact.title ? (
          <p className="text-[10px] text-muted-foreground">{contact.title}</p>
        ) : null}
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {PROSPECT_CONTACT_ORIGIN_KIND_LABEL[origin.kind]}
          {origin.label ? ` · ${origin.label}` : null}
        </p>
        <ContactLinks contact={contact} />
        <p className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground">
          {contact.source === "manual" ? "Manuel" : "Apollo"}
        </p>
      </div>
      {isManual && allowManualActions ? (
        <div className="flex shrink-0 gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={`Modifier ${contact.fullName}`}
            onClick={() => onEditManual?.(contact)}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                aria-label={`Supprimer ${contact.fullName}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer ce contact ?</AlertDialogTitle>
                <AlertDialogDescription>
                  {contact.fullName} sera retiré de la liste du projet.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDeleteManual?.(contact)}>Supprimer</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </li>
  );
}

/** Liste des contacts du projet (origine affichée sur chaque carte). */
export function DiscoveryProjectContactsList({
  contacts,
  originLabelContext,
  allowManualActions = false,
  onEditManual,
  onDeleteManual,
  emptyMessage = "Aucun contact pour ce projet.",
}: DiscoveryProjectContactsListProps) {
  const contactEntries = useMemo(
    () =>
      (contacts ?? []).map((contact, index) => ({
        contact,
        key: contact.id ?? `contact-${index}-${contact.fullName}`,
      })),
    [contacts]
  );

  if (contactEntries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-8 text-center text-xs text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {contactEntries.map(({ contact, key }) => (
        <ContactRow
          key={key}
          contact={contact}
          originLabelContext={originLabelContext}
          allowManualActions={allowManualActions}
          onEditManual={onEditManual}
          onDeleteManual={onDeleteManual}
        />
      ))}
    </ul>
  );
}

/** @deprecated */
export function DiscoveryDrawerContactsOverview({
  contacts,
  pois,
  prospectId,
  onEditManual,
  onDeleteManual,
}: {
  contacts: ProspectContact[] | undefined;
  pois: DiscoveryDrawerContactsOverviewPoi[];
  prospectId?: string;
  onEditManual?: (contact: ProspectContact) => void;
  onDeleteManual?: (contact: ProspectContact) => void;
}) {
  const originLabelContext = useMemo(
    () => ({
      poiNameByKey: new Map(pois.map((p) => [p.key, p.name])),
      parcelleLabelById: new Map<string, string>(),
      etablissementLabelBySiret: new Map<string, string>(),
    }),
    [pois]
  );

  return (
    <DiscoveryProjectContactsList
      contacts={contacts}
      originLabelContext={originLabelContext}
      allowManualActions={Boolean(prospectId)}
      onEditManual={onEditManual}
      onDeleteManual={onDeleteManual}
    />
  );
}
