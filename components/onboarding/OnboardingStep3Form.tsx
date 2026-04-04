"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import Image from "next/image";
import { Plus, Zap, FileCheck, Battery, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelReferenceForm, InverterReferenceForm, BatteryReferenceForm } from "@/components/solar-scout/Sidebar";
import { getCountryFlagUrl } from "@/lib/solar-settings";
import { savePanelReferenceToFirebase } from "@/lib/firestore-panel-references";
import { saveInverterReferenceToFirebase } from "@/lib/firestore-inverter-references";
import { saveBatteryReferenceToFirebase } from "@/lib/firestore-battery-references";
import { usePanelReferences, useInverterReferences, useBatteryReferences } from "@/lib/swr-hooks";
import type { UserProfile } from "@/lib/firestore-user-profile";
import type { PanelReference, InverterReference, BatteryReference } from "@/types";

interface OnboardingStep3FormProps {
  formId: string;
  userId: string;
  initialValues?: Partial<UserProfile> | null;
  onSubmit: (data: Partial<UserProfile>) => void;
  isSubmitting?: boolean;
}

export function OnboardingStep3Form({
  formId,
  userId,
  initialValues,
  onSubmit,
  isSubmitting = false,
}: OnboardingStep3FormProps) {
  const [defaultPanelRefId, setDefaultPanelRefId] = useState(initialValues?.defaultPanelRefId ?? "");
  const [defaultInverterRefId, setDefaultInverterRefId] = useState(
    initialValues?.defaultInverterRefId ?? ""
  );
  const [defaultBatteryRefId, setDefaultBatteryRefId] = useState(
    initialValues?.defaultBatteryRefId ?? ""
  );
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [addInverterOpen, setAddInverterOpen] = useState(false);
  const [addBatteryOpen, setAddBatteryOpen] = useState(false);
  /** Listes matériel : aperçu 2 lignes + déplier (taille de zone maîtrisée) */
  const [showAllPanels, setShowAllPanels] = useState(false);
  const [showAllInverters, setShowAllInverters] = useState(false);
  const [showAllBatteries, setShowAllBatteries] = useState(false);

  const PREVIEW_COUNT = 2;

  const { data: panelRefs = [], mutate: mutatePanels } = usePanelReferences(userId);
  const { data: inverterRefs = [], mutate: mutateInverters } = useInverterReferences(userId);
  const { data: batteryRefs = [], mutate: mutateBatteries } = useBatteryReferences(userId);

  useEffect(() => {
    if (panelRefs.length > 0 && !defaultPanelRefId) {
      const visible = panelRefs.find((r) => r.visible === true);
      const rec = panelRefs.find((r) => r.recommended) ?? panelRefs[0];
      const pick = visible ?? rec;
      if (pick) setDefaultPanelRefId(pick.id);
    }
  }, [panelRefs, defaultPanelRefId]);

  useEffect(() => {
    if (inverterRefs.length > 0 && !defaultInverterRefId) {
      const visible = inverterRefs.find((r) => r.visible === true);
      const rec = inverterRefs.find((r) => r.recommended) ?? inverterRefs[0];
      const pick = visible ?? rec;
      if (pick) setDefaultInverterRefId(pick.id);
    }
  }, [inverterRefs, defaultInverterRefId]);

  useEffect(() => {
    if (batteryRefs.length > 0 && !defaultBatteryRefId) {
      const visible = batteryRefs.find((r) => r.visible === true);
      const rec = batteryRefs.find((r) => r.recommended) ?? batteryRefs[0];
      const pick = visible ?? rec;
      if (pick) setDefaultBatteryRefId(pick.id);
    }
  }, [batteryRefs, defaultBatteryRefId]);

  // Panneaux : un seul modèle visible, utilisé dans les simulations.
  const handlePanelVisible = async (ref: PanelReference, checked: boolean) => {
    if (!checked) return; // évite de se retrouver sans panneau "visible"
    const normalized = panelRefs.map((r) => (r.id === ref.id ? { ...r, visible: true } : { ...r, visible: false }));
    await Promise.all(normalized.map((r) => savePanelReferenceToFirebase(r, userId)));
    mutatePanels();
    setDefaultPanelRefId(ref.id);
  };

  const handleInverterVisible = async (ref: InverterReference, checked: boolean) => {
    const visibleCount = inverterRefs.filter((r) => r.visible === true).length;
    if (!checked && visibleCount === 1 && ref.visible === true) {
      console.log("[Onboarding] inverter visible: blocage (revert_on), dernière visible non décochée", { refId: ref.id, refName: ref.name });
      return;
    }
    console.log("[Onboarding] inverter visible: sauvegarde", { refId: ref.id, refName: ref.name, visible: checked });
    await saveInverterReferenceToFirebase({ ...ref, visible: checked }, userId);
    mutateInverters();
    if (checked) setDefaultInverterRefId(ref.id);
    if (!checked && ref.id === defaultInverterRefId) {
      const other = inverterRefs.find((r) => r.id !== ref.id && r.visible === true);
      if (other) {
        console.log("[Onboarding] inverter visible: défaut basculé vers", { refId: other.id, refName: other.name });
        setDefaultInverterRefId(other.id);
      }
    }
  };

  const handlePanelSave = async (ref: PanelReference) => {
    // Pour les panneaux : considérer le nouveau panneau comme "visible" (unique).
    const normalized = [...panelRefs.filter((r) => r.id !== ref.id).map((r) => ({ ...r, visible: false })), { ...ref, visible: true }];
    await Promise.all(normalized.map((r) => savePanelReferenceToFirebase(r, userId)));
    mutatePanels();
    setDefaultPanelRefId(ref.id);
    setAddPanelOpen(false);
  };

  const handleInverterSave = async (ref: InverterReference) => {
    await saveInverterReferenceToFirebase({ ...ref, visible: true }, userId);
    mutateInverters();
    if (inverterRefs.length === 0) setDefaultInverterRefId(ref.id);
    setAddInverterOpen(false);
  };

  const handleBatteryVisible = async (ref: BatteryReference, checked: boolean) => {
    const visibleCount = batteryRefs.filter((r) => r.visible === true).length;
    if (!checked && visibleCount === 1 && ref.visible === true) {
      console.log("[Onboarding] battery visible: blocage (revert_on), dernière visible non décochée", { refId: ref.id, refName: ref.name });
      return;
    }
    console.log("[Onboarding] battery visible: sauvegarde", { refId: ref.id, refName: ref.name, visible: checked });
    await saveBatteryReferenceToFirebase({ ...ref, visible: checked }, userId);
    mutateBatteries();
    if (checked) setDefaultBatteryRefId(ref.id);
    if (!checked && ref.id === defaultBatteryRefId) {
      const other = batteryRefs.find((r) => r.id !== ref.id && r.visible === true);
      if (other) {
        console.log("[Onboarding] battery visible: défaut basculé vers", { refId: other.id, refName: other.name });
        setDefaultBatteryRefId(other.id);
      }
    }
  };

  const handleBatterySave = async (ref: BatteryReference) => {
    await saveBatteryReferenceToFirebase({ ...ref, visible: true }, userId);
    mutateBatteries();
    if (batteryRefs.length === 0) setDefaultBatteryRefId(ref.id);
    setAddBatteryOpen(false);
  };

  const defaultPanelId =
    defaultPanelRefId || panelRefs.find((r) => r.visible === true)?.id || panelRefs.find((r) => r.recommended)?.id || panelRefs[0]?.id || "";
  const defaultInverterId =
    defaultInverterRefId || inverterRefs.find((r) => r.visible === true)?.id || inverterRefs.find((r) => r.recommended)?.id || inverterRefs[0]?.id || "";
  const defaultBatteryId =
    defaultBatteryRefId || batteryRefs.find((r) => r.visible === true)?.id || batteryRefs.find((r) => r.recommended)?.id || batteryRefs[0]?.id || "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      defaultPanelRefId: defaultPanelId || undefined,
      defaultInverterRefId: defaultInverterId || undefined,
      defaultBatteryRefId: defaultBatteryId || undefined,
    });
  };

  const visiblePanels =
    panelRefs.length <= PREVIEW_COUNT || showAllPanels ? panelRefs : panelRefs.slice(0, PREVIEW_COUNT);
  const visibleInverters =
    inverterRefs.length <= PREVIEW_COUNT || showAllInverters
      ? inverterRefs
      : inverterRefs.slice(0, PREVIEW_COUNT);
  const visibleBatteries =
    batteryRefs.length <= PREVIEW_COUNT || showAllBatteries
      ? batteryRefs
      : batteryRefs.slice(0, PREVIEW_COUNT);

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-3">
        <Label>Matériel pour la simulation</Label>
        <p className="text-xs text-muted-foreground">
          Vous pourrez en ajouter d&apos;autres plus tard dans les paramètres.
        </p>
        <Tabs defaultValue="panels" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="panels">Panneaux</TabsTrigger>
            <TabsTrigger value="inverters">Onduleurs</TabsTrigger>
            <TabsTrigger value="batteries">Batteries</TabsTrigger>
          </TabsList>
          <TabsContent value="panels" className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Références de panneau</label>
              <Button type="button" variant="outline" size="sm" onClick={() => setAddPanelOpen(true)} className="h-8">
                <Plus className="h-3.5 w-3 mr-1" />
                Ajouter
              </Button>
            </div>
            <ul
              className={cn(
                "space-y-3",
                showAllPanels && panelRefs.length > PREVIEW_COUNT && "max-h-[min(50vh,360px)] overflow-y-auto overscroll-contain pr-1"
              )}
            >
              {visiblePanels.map((ref) => (
                <li
                  key={ref.id}
                  className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => handlePanelVisible(ref, true)}
                >
                  <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-muted">
                    {ref.imageUrl ? (
                      <Image
                        src={ref.imageUrl}
                        alt={ref.name}
                        width={64}
                        height={64}
                        className="w-full h-full object-cover aspect-square"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">—</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="font-semibold text-sm text-foreground truncate">{ref.name}</div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">€{ref.costEur}</span>
                      <span className="text-muted-foreground/40 text-xs">|</span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Zap className="h-3.5 w-3.5 text-muted-foreground/80" />
                        {ref.powerW}W
                      </span>
                      {ref.warrantyYears != null && (
                        <>
                          <span className="text-muted-foreground/40 text-xs">|</span>
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <FileCheck className="h-3.5 w-3.5 text-muted-foreground/80" />
                            {ref.warrantyYears}y
                          </span>
                        </>
                      )}
                      {ref.countryCode && (
                        <>
                          <span className="text-muted-foreground/40 text-xs">|</span>
                          <span className="inline-flex shrink-0" title={ref.countryOfOrigin}>
                            <img
                              src={getCountryFlagUrl(ref.countryCode)}
                              alt=""
                              className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50"
                              width={12}
                              height={12}
                            />
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={ref.visible === true || ref.id === defaultPanelId}
                      onCheckedChange={(checked) => handlePanelVisible(ref, checked)}
                      size="sm"
                    />
                  </div>
                </li>
              ))}
            </ul>
            {panelRefs.length > PREVIEW_COUNT && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-full gap-1 text-muted-foreground"
                onClick={() => setShowAllPanels((v) => !v)}
              >
                {showAllPanels ? (
                  <>
                    Voir moins
                    <ChevronUp className="size-4" />
                  </>
                ) : (
                  <>
                    Voir plus ({panelRefs.length - PREVIEW_COUNT})
                    <ChevronDown className="size-4" />
                  </>
                )}
              </Button>
            )}
          </TabsContent>
          <TabsContent value="inverters" className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Références d&apos;onduleur</label>
              <Button type="button" variant="outline" size="sm" onClick={() => setAddInverterOpen(true)} className="h-8">
                <Plus className="h-3.5 w-3 mr-1" />
                Ajouter
              </Button>
            </div>
            <ul
              className={cn(
                "space-y-3",
                showAllInverters && inverterRefs.length > PREVIEW_COUNT && "max-h-[min(50vh,360px)] overflow-y-auto overscroll-contain pr-1"
              )}
            >
              {visibleInverters.map((ref) => (
                <li
                  key={ref.id}
                  className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => handleInverterVisible(ref, true)}
                >
                  <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-muted">
                    {ref.imageUrl ? (
                      <Image
                        src={ref.imageUrl}
                        alt={ref.name}
                        width={64}
                        height={64}
                        className="w-full h-full object-cover aspect-square"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">—</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="font-semibold text-sm text-foreground truncate">{ref.name}</div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">€{ref.costEur}</span>
                      <span className="text-muted-foreground/40 text-xs">|</span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Zap className="h-3.5 w-3.5 text-muted-foreground/80" />
                        {ref.powerW}W
                      </span>
                      {ref.warrantyYears != null && (
                        <>
                          <span className="text-muted-foreground/40 text-xs">|</span>
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <FileCheck className="h-3.5 w-3.5 text-muted-foreground/80" />
                            {ref.warrantyYears}y
                          </span>
                        </>
                      )}
                      {ref.countryCode && (
                        <>
                          <span className="text-muted-foreground/40 text-xs">|</span>
                          <span className="inline-flex shrink-0" title={ref.countryOfOrigin}>
                            <img
                              src={getCountryFlagUrl(ref.countryCode)}
                              alt=""
                              className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50"
                              width={12}
                              height={12}
                            />
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={ref.visible === true}
                      onCheckedChange={(checked) => handleInverterVisible(ref, checked)}
                      size="sm"
                    />
                  </div>
                </li>
              ))}
            </ul>
            {inverterRefs.length > PREVIEW_COUNT && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-full gap-1 text-muted-foreground"
                onClick={() => setShowAllInverters((v) => !v)}
              >
                {showAllInverters ? (
                  <>
                    Voir moins
                    <ChevronUp className="size-4" />
                  </>
                ) : (
                  <>
                    Voir plus ({inverterRefs.length - PREVIEW_COUNT})
                    <ChevronDown className="size-4" />
                  </>
                )}
              </Button>
            )}
          </TabsContent>
          <TabsContent value="batteries" className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Références de batterie</label>
              <Button type="button" variant="outline" size="sm" onClick={() => setAddBatteryOpen(true)} className="h-8">
                <Plus className="h-3.5 w-3 mr-1" />
                Ajouter
              </Button>
            </div>
            <ul
              className={cn(
                "space-y-3",
                showAllBatteries && batteryRefs.length > PREVIEW_COUNT && "max-h-[min(50vh,360px)] overflow-y-auto overscroll-contain pr-1"
              )}
            >
              {visibleBatteries.map((ref) => (
                <li
                  key={ref.id}
                  className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => handleBatteryVisible(ref, true)}
                >
                  <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-muted">
                    {ref.imageUrl ? (
                      <Image
                        src={ref.imageUrl}
                        alt={ref.name}
                        width={64}
                        height={64}
                        className="w-full h-full object-cover aspect-square"
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        <Battery className="h-6 w-6" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="font-semibold text-sm text-foreground truncate">{ref.name}</div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">€{ref.costEur}</span>
                      <span className="text-muted-foreground/40 text-xs">|</span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Battery className="h-3.5 w-3.5 text-muted-foreground/80" />
                        {ref.capacityKwh} kWh
                      </span>
                      {ref.warrantyYears != null && (
                        <>
                          <span className="text-muted-foreground/40 text-xs">|</span>
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <FileCheck className="h-3.5 w-3.5 text-muted-foreground/80" />
                            {ref.warrantyYears}y
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={ref.visible === true}
                      onCheckedChange={(checked) => handleBatteryVisible(ref, checked)}
                      size="sm"
                    />
                  </div>
                </li>
              ))}
            </ul>
            {batteryRefs.length > PREVIEW_COUNT && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-full gap-1 text-muted-foreground"
                onClick={() => setShowAllBatteries((v) => !v)}
              >
                {showAllBatteries ? (
                  <>
                    Voir moins
                    <ChevronUp className="size-4" />
                  </>
                ) : (
                  <>
                    Voir plus ({batteryRefs.length - PREVIEW_COUNT})
                    <ChevronDown className="size-4" />
                  </>
                )}
              </Button>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={addPanelOpen} onOpenChange={setAddPanelOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ajouter un panneau</DialogTitle>
          </DialogHeader>
          <PanelReferenceForm
            userId={userId}
            allReferences={panelRefs}
            onSave={handlePanelSave}
            onCancel={() => setAddPanelOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={addInverterOpen} onOpenChange={setAddInverterOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ajouter un onduleur</DialogTitle>
          </DialogHeader>
          <InverterReferenceForm
            userId={userId}
            allReferences={inverterRefs}
            onSave={handleInverterSave}
            onCancel={() => setAddInverterOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={addBatteryOpen} onOpenChange={setAddBatteryOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ajouter une batterie</DialogTitle>
          </DialogHeader>
          <BatteryReferenceForm
            userId={userId}
            allReferences={batteryRefs}
            onSave={handleBatterySave}
            onCancel={() => setAddBatteryOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </form>
  );
}
