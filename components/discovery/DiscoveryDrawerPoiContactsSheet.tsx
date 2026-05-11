"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  AlertCircle,
  Linkedin,
  Mail,
  Phone,
  ExternalLink,
  Save,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchWithAuth } from "@/lib/api-client";
import { mergeProspectContacts } from "@/lib/apollo-people-search";
import { updateProspect } from "@/lib/firestore";
import type { ProspectContact } from "@/types";

/** Forme minimale du POI nécessaire pour l'appel Apollo. */
export type DiscoveryPoiContactsSheetPoi = {
  key: string;
  source: "osm" | "google" | "osm_building";
  name: string;
  website: string;
  externalUrl: string;
  /** `place_id` Google (uniquement quand `source === "google"`). */
  placeId?: string;
};

interface ApolloRouteResponse {
  ok?: boolean;
  domain?: string;
  rawCount?: number;
  contacts?: ProspectContact[];
  error?: string;
  retryAfterSeconds?: number;
}

interface DiscoveryDrawerPoiContactsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poi: DiscoveryPoiContactsSheetPoi | null;
  /** ID du prospect Firestore associé (si la ligne est déjà dans le pipeline). */
  prospectId?: string;
  /** Contacts déjà persistés sur le prospect (pour fusion à la sauvegarde). */
  existingContacts?: ProspectContact[];
  /** Callback invoqué après une sauvegarde réussie sur Firestore. */
  onContactsPersisted?: (contacts: ProspectContact[]) => void;
}

type Status = "idle" | "loading" | "ok" | "error";

/**
 * Panneau Apollo (people search par domaine) — contenu du popover.
 */
function DiscoveryDrawerPoiContactsPanel({
  open,
  onOpenChange,
  poi,
  prospectId,
  existingContacts,
  onContactsPersisted,
}: DiscoveryDrawerPoiContactsPanelProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [contacts, setContacts] = useState<ProspectContact[]>([]);
  const [domain, setDomain] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [persistPending, setPersistPending] = useState(false);
  const lastRequestKey = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !poi) return;
    const requestKey = poi.key;
    if (lastRequestKey.current === requestKey) return;
    lastRequestKey.current = requestKey;

    setStatus("loading");
    setContacts([]);
    setDomain(undefined);
    setErrorMessage(null);

    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/apollo/people-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            poi: {
              source: poi.source,
              name: poi.name,
              website: poi.website || null,
              externalUrl: poi.externalUrl || null,
              placeId: poi.placeId || null,
            },
          }),
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as ApolloRouteResponse;
        if (!res.ok || !data.ok) {
          const fallback = `Apollo HTTP ${res.status}`;
          setErrorMessage(data.error || fallback);
          setStatus("error");
          return;
        }
        setDomain(data.domain);
        setContacts(Array.isArray(data.contacts) ? data.contacts : []);
        setStatus("ok");
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setErrorMessage("Erreur réseau lors de l'appel Apollo.");
        setStatus("error");
      }
    })();

    return () => controller.abort();
  }, [open, poi]);

  useEffect(() => {
    if (!open) {
      lastRequestKey.current = null;
    }
  }, [open]);

  const canPersist = useMemo(
    () => Boolean(prospectId) && contacts.length > 0 && status === "ok",
    [prospectId, contacts.length, status]
  );

  const handlePersist = async () => {
    if (!prospectId || contacts.length === 0) return;
    setPersistPending(true);
    try {
      const hydratedContacts: ProspectContact[] = contacts.map((c) => ({
        ...c,
        fetchedAt:
          c.fetchedAt instanceof Date
            ? c.fetchedAt
            : typeof c.fetchedAt === "string"
              ? new Date(c.fetchedAt)
              : new Date(),
      }));
      const merged = mergeProspectContacts(existingContacts, hydratedContacts);
      await updateProspect(prospectId, { contacts: merged });
      toast.success(
        `${contacts.length} contact${contacts.length > 1 ? "s" : ""} enregistré${
          contacts.length > 1 ? "s" : ""
        } sur le prospect.`
      );
      onContactsPersisted?.(merged);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      toast.error("Enregistrement impossible.", { description: message });
    } finally {
      setPersistPending(false);
    }
  };

  return (
    <div className="flex max-h-[min(85vh,560px)] w-full min-w-0 flex-col">
      <div className="shrink-0 border-b px-4 py-3 pr-12">
        <h2 className="text-sm font-semibold leading-tight text-foreground">Contacts décisionnaires</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {poi ? (
            <span className="block break-words">
              <span className="font-medium text-foreground">{poi.name}</span>
              {domain ? (
                <>
                  {" — "}
                  <span className="font-mono text-[0.7rem] text-muted-foreground">{domain}</span>
                </>
              ) : null}
            </span>
          ) : (
            "Aucun POI sélectionné."
          )}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {status === "loading" ? (
          <div className="space-y-3" aria-label="Recherche Apollo en cours">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        ) : status === "error" ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">Recherche Apollo impossible.</p>
              <p className="text-xs leading-relaxed">{errorMessage}</p>
            </div>
          </div>
        ) : status === "ok" && contacts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-5 text-center text-sm text-muted-foreground">
            Aucun décisionnaire trouvé sur ce domaine
            {domain ? (
              <>
                {" "}
                (<span className="font-mono text-[0.7rem]">{domain}</span>).
              </>
            ) : (
              "."
            )}
          </div>
        ) : status === "ok" ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <Table className="text-[11px]">
              <TableHeader>
                <TableRow className="border-0 hover:bg-transparent">
                  <TableHead className="min-w-[8rem]">Nom</TableHead>
                  <TableHead className="min-w-[7rem]">Poste</TableHead>
                  <TableHead className="whitespace-nowrap">Liens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((c) => (
                  <TableRow key={c.id ?? c.linkedinUrl ?? c.email ?? c.fullName} className="border-0 align-top">
                    <TableCell className="min-w-0 align-top">
                      <span className="block break-words text-xs font-medium leading-snug text-foreground">
                        {c.fullName}
                      </span>
                      {c.organizationName ? (
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {c.organizationName}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="min-w-0 align-top text-muted-foreground">
                      <span className="block break-words text-xs leading-snug">{c.title || "—"}</span>
                    </TableCell>
                    <TableCell className="min-w-0 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.email ? (
                          <a
                            href={`mailto:${c.email}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground hover:bg-accent"
                            title={c.email}
                          >
                            <Mail className="h-3 w-3" aria-hidden />
                            <span className="max-w-[6rem] truncate">{c.email}</span>
                            {c.emailStatus === "verified" ? (
                              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px]">
                                ok
                              </Badge>
                            ) : null}
                          </a>
                        ) : null}
                        {c.linkedinUrl ? (
                          <a
                            href={c.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground hover:bg-accent"
                            title="Ouvrir LinkedIn"
                          >
                            <Linkedin className="h-3 w-3" aria-hidden />
                            <span>LinkedIn</span>
                            <ExternalLink className="h-2.5 w-2.5 text-muted-foreground" aria-hidden />
                          </a>
                        ) : null}
                        {c.phone ? (
                          <a
                            href={`tel:${c.phone}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:bg-accent"
                          >
                            <Phone className="h-3 w-3" aria-hidden />
                            <span>{c.phone}</span>
                          </a>
                        ) : null}
                        {!c.email && !c.linkedinUrl && !c.phone ? (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t bg-muted/30 px-4 py-3">
        <p className="mb-3 text-[11px] leading-snug text-muted-foreground">
          {prospectId
            ? "Les contacts seront fusionnés avec ceux déjà enregistrés sur le prospect."
            : "Cette ligne n'est pas dans le pipeline. Ajoutez le prospect pour persister les contacts."}
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canPersist || persistPending}
            onClick={() => void handlePersist()}
          >
            {persistPending ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
                Enregistrement...
              </>
            ) : (
              <>
                <Save className="mr-2 h-3.5 w-3.5" aria-hidden />
                Enregistrer sur le prospect
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface DiscoveryDrawerPoiContactsDialogCellProps {
  poi: DiscoveryPoiContactsSheetPoi;
  /** ID du prospect Firestore associé (si la ligne est déjà dans le pipeline). */
  prospectId?: string;
  existingContacts?: ProspectContact[];
  onContactsPersisted?: (contacts: ProspectContact[]) => void;
  /** Libellés accessibilité / tooltip du déclencheur. */
  enrichTitle: string;
}

/**
 * Bouton noir + flèche ouvrant un dialog Apollo (people search par domaine).
 */
export function DiscoveryDrawerPoiContactsDialogCell({
  poi,
  prospectId,
  existingContacts,
  onContactsPersisted,
  enrichTitle,
}: DiscoveryDrawerPoiContactsDialogCellProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 rounded-lg border-0 bg-neutral-950 text-white shadow-sm hover:bg-neutral-900 hover:text-white focus-visible:ring-2 focus-visible:ring-neutral-950/30 focus-visible:ring-offset-2"
          aria-label={enrichTitle}
          title={enrichTitle}
        >
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(90vh,640px)] w-[calc(100vw-1.5rem)] max-w-xl gap-0 overflow-hidden border-border/80 p-0 sm:w-full">
        <DiscoveryDrawerPoiContactsPanel
          open={open}
          onOpenChange={setOpen}
          poi={poi}
          prospectId={prospectId}
          existingContacts={existingContacts}
          onContactsPersisted={onContactsPersisted}
        />
      </DialogContent>
    </Dialog>
  );
}
