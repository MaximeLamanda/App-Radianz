"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  contactFromDirigeant,
  dirigeantFullName,
  isDirigeantAlreadyAdded,
  type GouvDirigeantsCacheEntry,
} from "@/lib/discovery-dirigeants-suggestions";
import { mergeProspectContacts } from "@/lib/apollo-people-search";
import { prospectContactInitials } from "@/lib/prospect-contacts";
import { persistDiscoveryContactList } from "@/lib/discovery-contacts-persist";
import { cn } from "@/lib/utils";
import type { DirigeantPhysiqueGouv } from "@/lib/recherche-entreprises";
import type { ProspectContact } from "@/types";

export type DirigeantParcelleGroup = {
  parcelleId: string;
  parcelleLabel: string;
  siren: string;
  companyName?: string;
};

export type DirigeantEtablissementGroup = {
  siret: string;
  siren: string;
  label: string;
};

export interface DiscoveryDrawerDirigeantsSuggestionsProps {
  prospectId?: string;
  existingContacts: ProspectContact[];
  parcelleGroups: DirigeantParcelleGroup[];
  etablissementGroups: DirigeantEtablissementGroup[];
  gouvBySiren: Record<string, GouvDirigeantsCacheEntry>;
  /** Limite initiale d'établissements affichés / chargés (défaut 5). */
  etablissementsPageSize?: number;
  showAllEtablissements: boolean;
  onShowAllEtablissements: () => void;
  hiddenEtablissementCount: number;
  onContactsPersisted: (contacts: ProspectContact[]) => void;
}

type FlatDirigeantItem = {
  key: string;
  dirigeant: DirigeantPhysiqueGouv;
  companyName?: string;
  originKind: "parcelle" | "etablissement";
  originRef: string;
  originLabel: string;
  contextLabel: string;
};

function DirigeantCard({
  dirigeant,
  companyName,
  contextLabel,
  originKind,
  originRef,
  originLabel,
  existingContacts,
  prospectId,
  onContactsPersisted,
}: {
  dirigeant: DirigeantPhysiqueGouv;
  companyName?: string;
  contextLabel: string;
  originKind: "parcelle" | "etablissement";
  originRef: string;
  originLabel: string;
  existingContacts: ProspectContact[];
  prospectId?: string;
  onContactsPersisted: (contacts: ProspectContact[]) => void;
}) {
  const fullName = dirigeantFullName(dirigeant);
  const [pending, setPending] = useState(false);
  const alreadyAdded = isDirigeantAlreadyAdded(existingContacts, {
    originKind,
    originRef,
    fullName,
  });

  const handleAdd = useCallback(async () => {
    if (alreadyAdded || !fullName) return;
    setPending(true);
    try {
      const incoming = contactFromDirigeant({
        dirigeant,
        originKind,
        originRef,
        originLabel,
      });
      const merged = mergeProspectContacts(existingContacts, [incoming]);
      await persistDiscoveryContactList(prospectId, merged);
      onContactsPersisted(merged);
      toast.success("Contact ajouté.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      toast.error("Ajout impossible.", { description: message });
    } finally {
      setPending(false);
    }
  }, [
    prospectId,
    alreadyAdded,
    fullName,
    dirigeant,
    originKind,
    originRef,
    originLabel,
    existingContacts,
    onContactsPersisted,
  ]);

  const previewContact = useMemo(
    () => ({ fullName, firstName: dirigeant.prenoms, lastName: dirigeant.nom } as ProspectContact),
    [fullName, dirigeant.prenoms, dirigeant.nom]
  );

  if (!fullName) return null;

  return (
    <li className="flex items-start justify-between gap-2 rounded-lg border border-border/70 bg-muted/10 px-3 py-2">
      <Avatar className="h-9 w-9 shrink-0" aria-hidden>
        <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
          {prospectContactInitials(previewContact)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{fullName}</p>
        {dirigeant.qualite ? (
          <p className="text-[10px] text-muted-foreground">{dirigeant.qualite}</p>
        ) : null}
        {companyName ? (
          <p className="mt-0.5 text-[10px] text-muted-foreground">{companyName}</p>
        ) : null}
        <p className="mt-0.5 text-[10px] text-muted-foreground">{contextLabel}</p>
        <p className="mt-1 text-[9px] uppercase tracking-wide text-muted-foreground">api.gouv</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7 min-w-0 shrink-0 rounded-md [&_svg]:size-3.5",
          alreadyAdded
            ? "text-muted-foreground"
            : "text-foreground hover:bg-muted/40 hover:text-foreground"
        )}
        disabled={alreadyAdded || pending}
        aria-label={alreadyAdded ? `${fullName} déjà ajouté` : `Ajouter ${fullName}`}
        onClick={() => void handleAdd()}
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : alreadyAdded ? (
          <Check aria-hidden />
        ) : (
          <Plus aria-hidden />
        )}
      </Button>
    </li>
  );
}

function flattenParcelleDirigeants(
  groups: DirigeantParcelleGroup[],
  gouvBySiren: Record<string, GouvDirigeantsCacheEntry>
): FlatDirigeantItem[] {
  const items: FlatDirigeantItem[] = [];
  for (const g of groups) {
    const entry = gouvBySiren[g.siren];
    if (entry?.status !== "ok") continue;
    const dirigeants = entry.dirigeantsPhysiques ?? [];
    const companyName = entry.companyLegalName ?? g.companyName;
    dirigeants.forEach((d, i) => {
      const name = dirigeantFullName(d);
      if (!name) return;
      items.push({
        key: `parcelle-${g.parcelleId}-${g.siren}-${i}-${name}`,
        dirigeant: d,
        companyName,
        originKind: "parcelle",
        originRef: g.parcelleId,
        originLabel: g.parcelleLabel,
        contextLabel: g.parcelleLabel,
      });
    });
  }
  return items;
}

function flattenEtablissementDirigeants(
  groups: DirigeantEtablissementGroup[],
  gouvBySiren: Record<string, GouvDirigeantsCacheEntry>
): FlatDirigeantItem[] {
  const items: FlatDirigeantItem[] = [];
  for (const g of groups) {
    const entry = gouvBySiren[g.siren];
    if (entry?.status !== "ok") continue;
    const dirigeants = entry.dirigeantsPhysiques ?? [];
    const companyName = entry.companyLegalName ?? g.label;
    dirigeants.forEach((d, i) => {
      const name = dirigeantFullName(d);
      if (!name) return;
      items.push({
        key: `etab-${g.siret}-${i}-${name}`,
        dirigeant: d,
        companyName,
        originKind: "etablissement",
        originRef: g.siret,
        originLabel: g.label,
        contextLabel: `SIRET ${g.siret}`,
      });
    });
  }
  return items;
}

function DirigeantsTabPanel({
  groups,
  gouvBySiren,
  kind,
  flatItems,
  existingContacts,
  prospectId,
  onContactsPersisted,
  footer,
}: {
  groups: DirigeantParcelleGroup[] | DirigeantEtablissementGroup[];
  gouvBySiren: Record<string, GouvDirigeantsCacheEntry>;
  kind: "parcelle" | "etablissement";
  flatItems: FlatDirigeantItem[];
  existingContacts: ProspectContact[];
  prospectId?: string;
  onContactsPersisted: (contacts: ProspectContact[]) => void;
  footer?: ReactNode;
}) {
  const sirens = useMemo(() => new Set(groups.map((g) => g.siren)), [groups]);
  const anyLoading = useMemo(
    () =>
      [...sirens].some((s) => {
        const e = gouvBySiren[s];
        return !e || e.status === "loading";
      }),
    [sirens, gouvBySiren]
  );
  const allLoaded = useMemo(
    () =>
      sirens.size > 0 &&
      [...sirens].every((s) => {
        const e = gouvBySiren[s];
        return e && e.status !== "loading";
      }),
    [sirens, gouvBySiren]
  );

  if (groups.length === 0) return null;

  return (
    <div className="space-y-2">
      {anyLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5 text-[10px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
          Chargement dirigeants…
        </div>
      ) : null}
      {flatItems.length > 0 ? (
        <ul className="space-y-2">
          {flatItems.map((item) => (
            <DirigeantCard
              key={item.key}
              dirigeant={item.dirigeant}
              companyName={item.companyName}
              contextLabel={item.contextLabel}
              originKind={item.originKind}
              originRef={item.originRef}
              originLabel={item.originLabel}
              existingContacts={existingContacts}
              prospectId={prospectId}
              onContactsPersisted={onContactsPersisted}
            />
          ))}
        </ul>
      ) : allLoaded ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          {kind === "parcelle"
            ? "Aucun dirigeant personne physique trouvé pour les propriétaires parcelle."
            : "Aucun dirigeant personne physique trouvé pour les établissements."}
        </div>
      ) : null}
      {footer}
    </div>
  );
}

const DEFAULT_ETABLISSEMENTS_PAGE_SIZE = 5;

export function DiscoveryDrawerDirigeantsSuggestions({
  prospectId,
  existingContacts,
  parcelleGroups,
  etablissementGroups,
  gouvBySiren,
  etablissementsPageSize = DEFAULT_ETABLISSEMENTS_PAGE_SIZE,
  showAllEtablissements,
  onShowAllEtablissements,
  hiddenEtablissementCount,
  onContactsPersisted,
}: DiscoveryDrawerDirigeantsSuggestionsProps) {
  const visibleEtabGroups = showAllEtablissements
    ? etablissementGroups
    : etablissementGroups.slice(0, etablissementsPageSize);

  const hasParcelle = parcelleGroups.length > 0;
  const hasEtab = etablissementGroups.length > 0;
  const hasAnyGroup = hasParcelle || hasEtab;

  const defaultTab = hasParcelle ? "parcelle" : "etablissement";

  const parcelleItems = useMemo(
    () => flattenParcelleDirigeants(parcelleGroups, gouvBySiren),
    [parcelleGroups, gouvBySiren]
  );
  const etabItems = useMemo(
    () => flattenEtablissementDirigeants(visibleEtabGroups, gouvBySiren),
    [visibleEtabGroups, gouvBySiren]
  );

  if (!hasAnyGroup) return null;

  const showTabs = hasParcelle && hasEtab;

  const etabFooter =
    hiddenEtablissementCount > 0 && !showAllEtablissements ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={onShowAllEtablissements}
      >
        Voir plus ({hiddenEtablissementCount} établissement
        {hiddenEtablissementCount > 1 ? "s" : ""})
      </Button>
    ) : null;

  const parcellePanel = (
    <DirigeantsTabPanel
      groups={parcelleGroups}
      gouvBySiren={gouvBySiren}
      kind="parcelle"
      flatItems={parcelleItems}
      existingContacts={existingContacts}
      prospectId={prospectId}
      onContactsPersisted={onContactsPersisted}
    />
  );

  const etabPanel = (
    <DirigeantsTabPanel
      groups={visibleEtabGroups}
      gouvBySiren={gouvBySiren}
      kind="etablissement"
      flatItems={etabItems}
      existingContacts={existingContacts}
      prospectId={prospectId}
      onContactsPersisted={onContactsPersisted}
      footer={etabFooter}
    />
  );

  return (
    <section aria-labelledby="discovery-terrain-dirigeants" className="space-y-3">
      <h4
        id="discovery-terrain-dirigeants"
        className="drawer-discovery-section-title m-0 text-base uppercase tracking-tight text-black"
      >
        Dirigeants suggérés
      </h4>
      <p className="text-[11px] text-muted-foreground">
        Source api.gouv — propriétaires parcelle et établissements matchés.
      </p>

      {showTabs ? (
        <Tabs defaultValue={defaultTab} variant="line">
          <TabsList aria-label="Source des dirigeants suggérés" className="w-full min-w-0">
            <TabsTrigger value="parcelle">Propriétaires parcelle</TabsTrigger>
            <TabsTrigger value="etablissement">Établissements</TabsTrigger>
          </TabsList>
          <TabsContent value="parcelle">{parcellePanel}</TabsContent>
          <TabsContent value="etablissement">{etabPanel}</TabsContent>
        </Tabs>
      ) : hasParcelle ? (
        parcellePanel
      ) : (
        etabPanel
      )}
    </section>
  );
}
