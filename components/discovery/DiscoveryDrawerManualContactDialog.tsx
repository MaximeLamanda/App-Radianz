"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createManualProspectContact, updateManualProspectContact } from "@/lib/prospect-contacts";
import { mergeProspectContacts } from "@/lib/apollo-people-search";
import { updateProspect } from "@/lib/firestore";
import type { ProspectContact, ProspectContactOriginKind } from "@/types";
import type { DiscoveryContactOriginOptions } from "@/components/discovery/DiscoveryDrawerContactsOverview";

interface DiscoveryDrawerManualContactDialogProps {
  prospectId?: string;
  existingContacts?: ProspectContact[];
  originOptions: DiscoveryContactOriginOptions;
  /** Présélection (ex. POI depuis une ligne). */
  defaultOriginKind?: ProspectContactOriginKind;
  defaultOriginRef?: string;
  onContactsPersisted?: (contacts: ProspectContact[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Contact à modifier (sinon création). */
  editingContact?: ProspectContact | null;
  /** Avant ouverture via le bouton « Ajouter ». */
  onBeforeAddOpen?: () => void;
}

const ORIGIN_KIND_OPTIONS: Array<{ value: ProspectContactOriginKind; label: string }> = [
  { value: "parcelle", label: "Parcelle" },
  { value: "etablissement", label: "Établissement" },
  { value: "poi", label: "POI" },
  { value: "autre", label: "Autre" },
];

export function DiscoveryDrawerManualContactDialog({
  prospectId,
  existingContacts,
  originOptions,
  defaultOriginKind,
  defaultOriginRef,
  onContactsPersisted,
  open,
  onOpenChange,
  editingContact = null,
  onBeforeAddOpen,
}: DiscoveryDrawerManualContactDialogProps) {
  const isEdit = Boolean(editingContact?.id);
  const [pending, setPending] = useState(false);
  const [fullName, setFullName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [originKind, setOriginKind] = useState<ProspectContactOriginKind>("autre");
  const [originRef, setOriginRef] = useState("");
  const [autreLabel, setAutreLabel] = useState("");

  const refOptions = useMemo(() => {
    if (originKind === "poi") return originOptions.pois;
    if (originKind === "parcelle") return originOptions.parcelles;
    if (originKind === "etablissement") return originOptions.etablissements;
    return [];
  }, [originKind, originOptions]);

  const reset = () => {
    setFullName("");
    setTitle("");
    setEmail("");
    setPhone("");
    setLinkedinUrl("");
    setOriginKind(defaultOriginKind ?? "autre");
    setOriginRef(defaultOriginRef ?? "");
    setAutreLabel("");
  };

  useEffect(() => {
    if (!open) return;
    if (editingContact) {
      setFullName(editingContact.fullName);
      setTitle(editingContact.title ?? "");
      setEmail(editingContact.email ?? "");
      setPhone(editingContact.phone ?? "");
      setLinkedinUrl(editingContact.linkedinUrl ?? "");
      const kind = editingContact.originKind ?? "autre";
      setOriginKind(kind);
      if (kind === "autre") {
        setAutreLabel(editingContact.originLabel ?? editingContact.originRef ?? "");
        setOriginRef("");
      } else {
        setOriginRef(editingContact.originRef ?? "");
        setAutreLabel("");
      }
      return;
    }
    const kind = defaultOriginKind ?? pickDefaultKind(originOptions);
    setOriginKind(kind);
    const opts =
      kind === "poi"
        ? originOptions.pois
        : kind === "parcelle"
          ? originOptions.parcelles
          : kind === "etablissement"
            ? originOptions.etablissements
            : [];
    setOriginRef(defaultOriginRef ?? opts[0]?.ref ?? "");
    setAutreLabel("");
    setFullName("");
    setTitle("");
    setEmail("");
    setPhone("");
    setLinkedinUrl("");
  }, [open, editingContact, defaultOriginKind, defaultOriginRef, originOptions]);

  useEffect(() => {
    if (originKind === "autre") return;
    if (refOptions.length === 0) {
      setOriginRef("");
      return;
    }
    if (!refOptions.some((o) => o.ref === originRef)) {
      setOriginRef(refOptions[0]?.ref ?? "");
    }
  }, [originKind, refOptions, originRef]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prospectId) {
      toast.info("Ajoutez ce combo au pipeline pour enregistrer un contact.");
      return;
    }
    if (originKind !== "autre" && refOptions.length > 0 && !originRef) {
      toast.error("Choisissez une origine dans la liste.");
      return;
    }
    try {
      const selected =
        originKind === "autre"
          ? { ref: trimOptional(autreLabel) ?? "", label: trimOptional(autreLabel) ?? "Autre" }
          : refOptions.find((o) => o.ref === originRef);

      setPending(true);
      let merged: ProspectContact[];
      if (isEdit && editingContact) {
        const updated = updateManualProspectContact(editingContact, {
          fullName,
          title,
          email,
          phone,
          linkedinUrl,
          originKind,
          originRef: originKind === "autre" ? selected?.ref : originRef,
          originLabel: selected?.label,
        });
        merged = (existingContacts ?? []).map((c) => (c.id === updated.id ? updated : c));
        await updateProspect(prospectId, { contacts: merged });
        toast.success("Contact mis à jour.");
      } else {
        const created = createManualProspectContact({
          fullName,
          title,
          email,
          phone,
          linkedinUrl,
          originKind,
          originRef: originKind === "autre" ? selected?.ref : originRef,
          originLabel: selected?.label,
        });
        merged = mergeProspectContacts(existingContacts, [created]);
        await updateProspect(prospectId, { contacts: merged });
        toast.success("Contact enregistré.");
      }
      onContactsPersisted?.(merged);
      reset();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      toast.error(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-3 text-xs"
        onClick={() => {
          onBeforeAddOpen?.();
          onOpenChange(true);
        }}
      >
        <UserPlus className="h-3.5 w-3.5" aria-hidden />
        Ajouter
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md gap-0 p-0">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold">
              {isEdit ? "Modifier le contact" : "Contact manuel"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isEdit
                ? "Mettez à jour les informations de ce contact."
                : "Rattachez ce contact à une origine du projet."}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Type d&apos;origine</Label>
              <Select
                value={originKind}
                onValueChange={(v) => setOriginKind(v as ProspectContactOriginKind)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORIGIN_KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {originKind === "autre" ? (
              <div className="space-y-1">
                <Label htmlFor="manual-autre-label" className="text-[11px]">
                  Libellé
                </Label>
                <Input
                  id="manual-autre-label"
                  value={autreLabel}
                  onChange={(e) => setAutreLabel(e.target.value)}
                  className="h-9 text-sm"
                  placeholder="Ex. Syndic, groupe…"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-[11px]">
                  {originKind === "poi"
                    ? "POI"
                    : originKind === "parcelle"
                      ? "Parcelle"
                      : "Établissement"}
                </Label>
                <Select value={originRef || undefined} onValueChange={setOriginRef}>
                  <SelectTrigger className="h-9 text-sm" disabled={refOptions.length === 0}>
                    <SelectValue
                      placeholder={
                        refOptions.length === 0 ? "Aucune entrée disponible" : "Choisir…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {refOptions.map((o) => (
                      <SelectItem key={o.ref} value={o.ref}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="manual-fullName" className="text-[11px]">
              Nom complet <span className="text-destructive">*</span>
            </Label>
            <Input
              id="manual-fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-9 text-sm"
              required
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="manual-title" className="text-[11px]">
                Poste
              </Label>
              <Input
                id="manual-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="manual-email" className="text-[11px]">
                Email
              </Label>
              <Input
                id="manual-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="manual-phone" className="text-[11px]">
                Téléphone
              </Label>
              <Input
                id="manual-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="manual-linkedin" className="text-[11px]">
                LinkedIn
              </Label>
              <Input
                id="manual-linkedin"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : isEdit ? (
                <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              ) : (
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              Enregistrer
            </Button>
          </div>
        </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function pickDefaultKind(options: DiscoveryContactOriginOptions): ProspectContactOriginKind {
  if (options.parcelles.length > 0) return "parcelle";
  if (options.etablissements.length > 0) return "etablissement";
  if (options.pois.length > 0) return "poi";
  return "autre";
}

function trimOptional(value: string): string | undefined {
  const t = value.trim();
  return t === "" ? undefined : t;
}
