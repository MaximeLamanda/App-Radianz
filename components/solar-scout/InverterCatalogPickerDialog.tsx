"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { FileCheck, Loader2, Zap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useInverterCatalog } from "@/lib/swr-hooks";
import { saveInverterReferenceToFirebase } from "@/lib/firestore-inverter-references";
import {
  getInvertersAddableFromCatalog,
  mergeInverterFromCatalogForUser,
} from "@/lib/inverter-catalog-availability";
import { getCountryFlagUrl } from "@/lib/solar-settings";
import type { InverterReference } from "@/types";

type InverterCatalogPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userReferences: InverterReference[];
  onUserReferencesChange: () => void;
};

export function InverterCatalogPickerDialog({
  open,
  onOpenChange,
  userId,
  userReferences,
  onUserReferencesChange,
}: InverterCatalogPickerDialogProps) {
  const { data: catalog, isLoading: catalogLoading } = useInverterCatalog();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const addable = useMemo(
    () => getInvertersAddableFromCatalog(catalog ?? [], userReferences),
    [catalog, userReferences]
  );

  const userById = useMemo(
    () => new Map(userReferences.map((r) => [r.id, r])),
    [userReferences]
  );

  async function handleAdd(catalogRef: InverterReference) {
    setPendingId(catalogRef.id);
    try {
      const existing = userById.get(catalogRef.id);
      const toSave = mergeInverterFromCatalogForUser(catalogRef, existing);
      await saveInverterReferenceToFirebase(toSave, userId);
      onUserReferencesChange();
    } catch (e) {
      console.error("[InverterCatalogPicker] add failed:", e);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle>Ajouter de la liste</DialogTitle>
          <DialogDescription>
            Modèles du catalogue Radianz. Choisissez ceux à afficher dans vos simulations.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
          {catalogLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement du catalogue…
            </div>
          ) : addable.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Tous les modèles du catalogue sont déjà dans votre liste.
            </p>
          ) : (
            <ul className="space-y-2">
              {addable.map(({ catalogRef, action }) => (
                <li
                  key={catalogRef.id}
                  className="rounded-xl border border-border bg-card p-3 flex items-center gap-3"
                >
                  <div className="shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-muted">
                    {catalogRef.imageUrl ? (
                      <Image
                        src={catalogRef.imageUrl}
                        alt={catalogRef.name}
                        width={56}
                        height={56}
                        className="w-full h-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        —
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{catalogRef.name}</div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-muted-foreground">
                      <span>€{catalogRef.costEur.toLocaleString("fr-FR")}</span>
                      <span>|</span>
                      <span className="flex items-center gap-0.5">
                        <Zap className="h-3 w-3" />
                        {(catalogRef.powerW / 1000).toLocaleString("fr-FR")} kW
                      </span>
                      {catalogRef.warrantyYears != null && (
                        <>
                          <span>|</span>
                          <span className="flex items-center gap-0.5">
                            <FileCheck className="h-3 w-3" />
                            {catalogRef.warrantyYears} ans
                          </span>
                        </>
                      )}
                      {catalogRef.countryCode && (
                        <>
                          <span>|</span>
                          <img
                            src={getCountryFlagUrl(catalogRef.countryCode)}
                            alt=""
                            className="w-3 h-3 rounded-full object-cover"
                            width={12}
                            height={12}
                          />
                        </>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0 h-8"
                    disabled={pendingId === catalogRef.id}
                    onClick={() => handleAdd(catalogRef)}
                  >
                    {pendingId === catalogRef.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : action === "restore" ? (
                      "Réafficher"
                    ) : (
                      "Ajouter"
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
