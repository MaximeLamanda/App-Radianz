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
import { Plus, Zap, FileCheck, Battery } from "lucide-react";
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

  const { data: panelRefs = [], mutate: mutatePanels } = usePanelReferences(userId);
  const { data: inverterRefs = [], mutate: mutateInverters } = useInverterReferences(userId);
  const { data: batteryRefs = [], mutate: mutateBatteries } = useBatteryReferences(userId);

  useEffect(() => {
    if (panelRefs.length > 0 && !defaultPanelRefId) {
      const rec = panelRefs.find((r) => r.recommended) ?? panelRefs[0];
      if (rec) setDefaultPanelRefId(rec.id);
    }
  }, [panelRefs, defaultPanelRefId]);

  useEffect(() => {
    if (inverterRefs.length > 0 && !defaultInverterRefId) {
      const rec = inverterRefs.find((r) => r.recommended) ?? inverterRefs[0];
      if (rec) setDefaultInverterRefId(rec.id);
    }
  }, [inverterRefs, defaultInverterRefId]);

  useEffect(() => {
    if (batteryRefs.length > 0 && !defaultBatteryRefId) {
      const rec = batteryRefs.find((r) => r.recommended) ?? batteryRefs[0];
      if (rec) setDefaultBatteryRefId(rec.id);
    }
  }, [batteryRefs, defaultBatteryRefId]);

  const handlePanelRecommended = async (ref: PanelReference, checked: boolean) => {
    const normalized = checked
      ? panelRefs.map((r) => (r.id === ref.id ? { ...r, recommended: true } : { ...r, recommended: false }))
      : panelRefs.map((r) => (r.id === ref.id ? { ...r, recommended: false } : r));
    await Promise.all(normalized.map((r) => savePanelReferenceToFirebase(r, userId)));
    mutatePanels();
    if (checked) setDefaultPanelRefId(ref.id);
  };

  const handleInverterRecommended = async (ref: InverterReference, checked: boolean) => {
    const normalized = checked
      ? inverterRefs.map((r) =>
          r.id === ref.id ? { ...r, recommended: true } : { ...r, recommended: false }
        )
      : inverterRefs.map((r) =>
          r.id === ref.id ? { ...r, recommended: false } : r
        );
    await Promise.all(normalized.map((r) => saveInverterReferenceToFirebase(r, userId)));
    mutateInverters();
    if (checked) setDefaultInverterRefId(ref.id);
  };

  const handlePanelSave = async (ref: PanelReference) => {
    await savePanelReferenceToFirebase(ref, userId);
    mutatePanels();
    if (panelRefs.length === 0) setDefaultPanelRefId(ref.id);
    setAddPanelOpen(false);
  };

  const handleInverterSave = async (ref: InverterReference) => {
    await saveInverterReferenceToFirebase(ref, userId);
    mutateInverters();
    if (inverterRefs.length === 0) setDefaultInverterRefId(ref.id);
    setAddInverterOpen(false);
  };

  const handleBatteryRecommended = async (ref: BatteryReference, checked: boolean) => {
    const normalized = checked
      ? batteryRefs.map((r) => (r.id === ref.id ? { ...r, recommended: true } : { ...r, recommended: false }))
      : batteryRefs.map((r) => (r.id === ref.id ? { ...r, recommended: false } : r));
    await Promise.all(normalized.map((r) => saveBatteryReferenceToFirebase(r, userId)));
    mutateBatteries();
    if (checked) setDefaultBatteryRefId(ref.id);
  };

  const handleBatterySave = async (ref: BatteryReference) => {
    await saveBatteryReferenceToFirebase(ref, userId);
    mutateBatteries();
    if (batteryRefs.length === 0) setDefaultBatteryRefId(ref.id);
    setAddBatteryOpen(false);
  };

  const defaultPanelId =
    defaultPanelRefId || panelRefs.find((r) => r.recommended)?.id || panelRefs[0]?.id || "";
  const defaultInverterId =
    defaultInverterRefId || inverterRefs.find((r) => r.recommended)?.id || inverterRefs[0]?.id || "";
  const defaultBatteryId =
    defaultBatteryRefId || batteryRefs.find((r) => r.recommended)?.id || batteryRefs[0]?.id || "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      defaultPanelRefId: defaultPanelId || undefined,
      defaultInverterRefId: defaultInverterId || undefined,
      defaultBatteryRefId: defaultBatteryId || undefined,
    });
  };

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
          <TabsContent value="panels" className="space-y-3 mt-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Références de panneau</label>
              <Button type="button" variant="outline" size="sm" onClick={() => setAddPanelOpen(true)} className="h-8">
                <Plus className="h-3.5 w-3 mr-1" />
                Ajouter
              </Button>
            </div>
            <ul className="space-y-3">
              {panelRefs.map((ref) => (
                <li
                  key={ref.id}
                  className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => handlePanelRecommended(ref, true)}
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
                      checked={(ref.recommended ?? false) || ref.id === defaultPanelId}
                      onCheckedChange={(checked) => handlePanelRecommended(ref, checked)}
                      size="sm"
                    />
                  </div>
                </li>
              ))}
            </ul>
          </TabsContent>
          <TabsContent value="inverters" className="space-y-3 mt-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Références d&apos;onduleur</label>
              <Button type="button" variant="outline" size="sm" onClick={() => setAddInverterOpen(true)} className="h-8">
                <Plus className="h-3.5 w-3 mr-1" />
                Ajouter
              </Button>
            </div>
            <ul className="space-y-3">
              {inverterRefs.map((ref) => (
                <li
                  key={ref.id}
                  className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => handleInverterRecommended(ref, true)}
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
                      checked={(ref.recommended ?? false) || ref.id === defaultInverterId}
                      onCheckedChange={(checked) => handleInverterRecommended(ref, checked)}
                      size="sm"
                    />
                  </div>
                </li>
              ))}
            </ul>
          </TabsContent>
          <TabsContent value="batteries" className="space-y-3 mt-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Références de batterie</label>
              <Button type="button" variant="outline" size="sm" onClick={() => setAddBatteryOpen(true)} className="h-8">
                <Plus className="h-3.5 w-3 mr-1" />
                Ajouter
              </Button>
            </div>
            <ul className="space-y-3">
              {batteryRefs.map((ref) => (
                <li
                  key={ref.id}
                  className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => handleBatteryRecommended(ref, true)}
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
                      checked={(ref.recommended ?? false) || ref.id === defaultBatteryId}
                      onCheckedChange={(checked) => handleBatteryRecommended(ref, checked)}
                      size="sm"
                    />
                  </div>
                </li>
              ))}
            </ul>
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
