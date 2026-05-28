"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import { Plus, X, Zap, FileCheck, ArrowLeft, User, Building2, Camera, Loader2, Sparkles, ListPlus } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePanelReferences, useInverterReferences, useBatteryReferences } from "@/lib/swr-hooks";
import { getCountryFlagUrl } from "@/lib/solar-settings";
import {
  savePanelReferenceToFirebase,
  deletePanelReferenceFromFirebase,
} from "@/lib/firestore-panel-references";
import {
  saveInverterReferenceToFirebase,
  deleteInverterReferenceFromFirebase,
} from "@/lib/firestore-inverter-references";
import {
  saveBatteryReferenceToFirebase,
  deleteBatteryReferenceFromFirebase,
} from "@/lib/firestore-battery-references";
import {
  getPanelReferences,
  savePanelReferences,
  getInverterReferences,
  saveInverterReferences,
  getSolarEquipmentSettings,
  saveSolarEquipmentSettings,
} from "@/lib/solar-settings";
import { getCommercialReferent, saveCommercialReferent } from "@/lib/commercial-mock";
import { useAuth } from "@/lib/auth-context";
import { storage } from "@/lib/firebase";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { getUserProfile, setUserProfile } from "@/lib/firestore-user-profile";
import { getQuotaDisplay } from "@/lib/usage-quotas";
import { Badge } from "@/components/ui/badge";
import { PanelReferenceForm, InverterReferenceForm, BatteryReferenceForm } from "./Sidebar";
import { InverterCatalogPickerDialog } from "./InverterCatalogPickerDialog";
import type { PanelReference, InverterReference, BatteryReference, CommercialReferent } from "@/types";

interface SettingsDrawerProps {
  onClose: () => void;
}

export function SettingsDrawer({ onClose }: SettingsDrawerProps) {
  const { user } = useAuth();
  const userId = user?.uid ?? null;
  const { data: panelsData, mutate: mutatePanels } = usePanelReferences(userId);
  const { data: invertersData, mutate: mutateInverters } = useInverterReferences(userId);
  const { data: batteriesData, mutate: mutateBatteries } = useBatteryReferences(userId);
  const panelReferences = panelsData ?? [];
  const inverterReferences = invertersData ?? [];
  const batteryReferences = batteriesData ?? [];

  const [quotaDisplay, setQuotaDisplay] = useState<ReturnType<typeof getQuotaDisplay> | null>(null);
  const [showAddPanelRef, setShowAddPanelRef] = useState(false);
  const [editingRef, setEditingRef] = useState<PanelReference | null>(null);
  const [showAddInverterRef, setShowAddInverterRef] = useState(false);
  const [showInverterCatalogPicker, setShowInverterCatalogPicker] = useState(false);
  const [editingInverterRef, setEditingInverterRef] = useState<InverterReference | null>(null);
  const [showAddBatteryRef, setShowAddBatteryRef] = useState(false);
  const [editingBatteryRef, setEditingBatteryRef] = useState<BatteryReference | null>(null);
  const [mainTab, setMainTab] = useState<"materiel" | "compte">("materiel");
  const [materielTab, setMaterielTab] = useState<"panels" | "inverters" | "batteries">("panels");
  const [accountInfo, setAccountInfo] = useState<CommercialReferent>(() => getCommercialReferent());
  const [usableRoofRatio, setUsableRoofRatio] = useState<number>(() => getSolarEquipmentSettings().usableRoofRatio ?? 0.75);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Charger les infos compte et paramètres au montage
  useEffect(() => {
    setUsableRoofRatio(getSolarEquipmentSettings().usableRoofRatio ?? 0.75);
  }, []);

  // Charger profil, quotas et synchro company/logo (UserProfile = source de vérité pour onboarding)
  useEffect(() => {
    if (!user?.uid) {
      setQuotaDisplay(null);
      setAccountInfo(getCommercialReferent());
      return;
    }
    getUserProfile(user.uid).then((profile) => {
      setQuotaDisplay(getQuotaDisplay(profile));
      const fromStorage = getCommercialReferent();
      const merged: CommercialReferent = {
        ...fromStorage,
        company: profile?.companyName?.trim() || fromStorage.company || "",
        logoUrl: profile?.companyLogoUrl?.trim() || fromStorage.logoUrl || "",
        calendlyUrl: profile?.calendlyUrl?.trim() || fromStorage.calendlyUrl || "",
      };
      setAccountInfo(merged);
    });
  }, [user?.uid]);

  const handleAccountChange = (field: keyof CommercialReferent, value: string | undefined) => {
    const next = { ...accountInfo, [field]: value ?? "" };
    setAccountInfo(next);
    saveCommercialReferent(next);
    if (user?.uid && (field === "company" || field === "logoUrl" || field === "calendlyUrl")) {
      setUserProfile(user.uid, {
        companyName: field === "company" ? (value?.trim() || undefined) : undefined,
        companyLogoUrl: field === "logoUrl" ? (value?.trim() || undefined) : undefined,
        calendlyUrl: field === "calendlyUrl" ? (value?.trim() || undefined) : undefined,
      }).catch((e) => console.warn("Synchro UserProfile:", e));
    }
  };

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/") || !user?.uid) return;
    setIsUploadingLogo(true);
    try {
      const path = `users/${user.uid}/company_logo_${Date.now()}.jpg`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file);
      const logoUrl = await getDownloadURL(ref);
      handleAccountChange("logoUrl", logoUrl);
    } catch (err) {
      console.warn("Upload logo:", err);
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleLogoDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/") || !user?.uid) return;
    setIsUploadingLogo(true);
    try {
      const path = `users/${user.uid}/company_logo_${Date.now()}.jpg`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file);
      const logoUrl = await getDownloadURL(ref);
      handleAccountChange("logoUrl", logoUrl);
    } catch (err) {
      console.warn("Upload logo:", err);
    } finally {
      setIsUploadingLogo(false);
    }
  };

  return (
    <>
    <div className="h-full w-full bg-gray-50 border-l shadow-xl flex flex-col rounded-2xl overflow-hidden">
      <div className="border-b p-4 bg-white">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            {showAddPanelRef || editingRef
              ? (editingRef ? "Modifier le panneau" : "Ajouter une référence")
              : showAddInverterRef || editingInverterRef
              ? (editingInverterRef ? "Modifier l'onduleur" : "Ajouter une référence")
              : showAddBatteryRef || editingBatteryRef
              ? (editingBatteryRef ? "Modifier la batterie" : "Ajouter une référence")
              : "Personnalisation"}
          </h2>
          {(showAddPanelRef || editingRef || showAddInverterRef || editingInverterRef || showAddBatteryRef || editingBatteryRef) ? (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border border-gray-300"
              onClick={() => {
                setShowAddPanelRef(false);
                setEditingRef(null);
                setShowAddInverterRef(false);
                setEditingInverterRef(null);
                setShowAddBatteryRef(false);
                setEditingBatteryRef(null);
              }}
            >
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border border-gray-300"
              onClick={onClose}
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
        </div>
        {!(showAddPanelRef || editingRef || showAddInverterRef || editingInverterRef || showAddBatteryRef || editingBatteryRef) && (
          <p className="text-sm text-muted-foreground mt-1">
            Matériel et informations de compte pour les liens prospect
          </p>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Formulaire d'ajout/modification panneau */}
        {(showAddPanelRef || editingRef) ? (
          <PanelReferenceForm
            key={editingRef?.id ?? "add"}
            initialRef={editingRef ?? undefined}
            allReferences={panelReferences}
            userId={userId}
            onDelete={(id) => {
              const next = panelReferences.filter((r) => r.id !== id);
              if (next.length === 0) return;
              if (!userId) return;
              savePanelReferences(next);
              deletePanelReferenceFromFirebase(id, userId)
                .then(() => mutatePanels())
                .catch((e) => console.error("Firebase delete panel ref:", e));
              setShowAddPanelRef(false);
              setEditingRef(null);
            }}
            onSave={(ref) => {
              let updatedRefs: PanelReference[];
              if (editingRef) {
                if (ref.recommended) {
                  updatedRefs = panelReferences.map((r) => 
                    r.id === ref.id ? ref : { ...r, recommended: false }
                  );
                } else {
                  updatedRefs = panelReferences.map((r) => (r.id === ref.id ? ref : r));
                }
              } else {
                // Panneaux : un seul "visible" (utilisé dans les simulations). On met le nouveau panneau visible par défaut.
                const nextRef: PanelReference = { ...ref, visible: true };
                updatedRefs = panelReferences.map((r) => ({
                  ...r,
                  visible: false,
                  ...(nextRef.recommended ? { recommended: false } : {}),
                }));
                updatedRefs = [...updatedRefs, nextRef];
              }
              
              savePanelReferences(updatedRefs);
              if (userId) {
                Promise.all(updatedRefs.map((r) => savePanelReferenceToFirebase(r, userId)))
                  .then(() => mutatePanels())
                  .catch((e) => console.error("Firebase save panel refs:", e));
              }
              setShowAddPanelRef(false);
              setEditingRef(null);
            }}
            onCancel={() => {
              setShowAddPanelRef(false);
              setEditingRef(null);
            }}
          />
        ) : (showAddInverterRef || editingInverterRef) ? (
          <InverterReferenceForm
            key={editingInverterRef?.id ?? "add"}
            initialRef={editingInverterRef ?? undefined}
            allReferences={inverterReferences}
            userId={userId}
            onDelete={(id) => {
              const next = inverterReferences.filter((r) => r.id !== id);
              if (next.length === 0) return;
              if (!userId) return;
              saveInverterReferences(next);
              deleteInverterReferenceFromFirebase(id, userId)
                .then(() => mutateInverters())
                .catch((e) => console.error("Firebase delete inverter ref:", e));
              setShowAddInverterRef(false);
              setEditingInverterRef(null);
            }}
            onSave={async (ref) => {
              const toSave: InverterReference = editingInverterRef
                ? ({ ...inverterReferences.find((r) => r.id === ref.id), ...ref } as InverterReference)
                : { ...ref, visible: true };
              if (userId) {
                await saveInverterReferenceToFirebase(toSave, userId);
                if (ref.recommended) {
                  const prev = inverterReferences.find((r) => r.id !== ref.id && r.recommended);
                  if (prev) await saveInverterReferenceToFirebase({ ...prev, recommended: false }, userId);
                }
                mutateInverters();
              }
              setShowAddInverterRef(false);
              setEditingInverterRef(null);
            }}
            onCancel={() => {
              setShowAddInverterRef(false);
              setEditingInverterRef(null);
            }}
          />
        ) : (showAddBatteryRef || editingBatteryRef) ? (
          <BatteryReferenceForm
            key={editingBatteryRef?.id ?? "add"}
            initialRef={editingBatteryRef ?? undefined}
            allReferences={batteryReferences}
            userId={userId}
            onDelete={(id) => {
              const next = batteryReferences.filter((r) => r.id !== id);
              if (next.length === 0) return;
              if (!userId) return;
              deleteBatteryReferenceFromFirebase(id, userId)
                .then(() => mutateBatteries())
                .catch((e) => console.error("Firebase delete battery ref:", e));
              setShowAddBatteryRef(false);
              setEditingBatteryRef(null);
            }}
            onSave={async (ref) => {
              const toSave: BatteryReference = editingBatteryRef
                ? ({ ...batteryReferences.find((r) => r.id === ref.id), ...ref } as BatteryReference)
                : { ...ref, visible: true };
              if (userId) {
                await saveBatteryReferenceToFirebase(toSave, userId);
                if (ref.recommended) {
                  const prev = batteryReferences.find((r) => r.id !== ref.id && r.recommended);
                  if (prev) await saveBatteryReferenceToFirebase({ ...prev, recommended: false }, userId);
                }
                mutateBatteries();
              }
              setShowAddBatteryRef(false);
              setEditingBatteryRef(null);
            }}
            onCancel={() => {
              setShowAddBatteryRef(false);
              setEditingBatteryRef(null);
            }}
          />
        ) : (
          <>
            {/* Onglets principaux : Matériel | Informations de compte */}
            <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "materiel" | "compte")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="materiel">Matériel</TabsTrigger>
                <TabsTrigger value="compte">Informations de compte</TabsTrigger>
              </TabsList>

              {/* Contenu Matériel : Panneaux / Onduleurs */}
              <TabsContent value="materiel" className="mt-4">
            {!user ? (
              <div className="rounded-xl border border-border bg-amber-50 p-4 text-sm text-amber-800">
                Connectez-vous pour gérer votre matériel (panneaux, onduleurs).
              </div>
            ) : (
            <Tabs value={materielTab} onValueChange={(v) => setMaterielTab(v as "panels" | "inverters" | "batteries")}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="panels">Panneaux</TabsTrigger>
                <TabsTrigger value="inverters">Onduleurs</TabsTrigger>
                <TabsTrigger value="batteries">Batteries</TabsTrigger>
              </TabsList>

              {/* Paramètre taux surface couverte */}
              <div className="rounded-xl border border-border bg-white p-4 shadow-xs space-y-2 mb-4">
                <Label className="text-sm font-medium">Surface couverte par les panneaux</Label>
                <p className="text-xs text-muted-foreground">
                  Part du toit utilisée pour les panneaux (obstacles, zones de circulation, etc.).
                </p>
                <Select
                  value={String(Math.round(usableRoofRatio * 100))}
                  onValueChange={(v) => {
                    const ratio = parseInt(v, 10) / 100;
                    setUsableRoofRatio(ratio);
                    saveSolarEquipmentSettings({ ...getSolarEquipmentSettings(), usableRoofRatio: ratio });
                  }}
                >
                  <SelectTrigger className="w-full max-w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[50, 60, 70, 75, 80, 90, 100].map((pct) => (
                      <SelectItem key={pct} value={String(pct)}>
                        {pct} %
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Onglet Panneaux */}
              <TabsContent value="panels" className="space-y-3 mt-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Références de panneau</label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddPanelRef(true)}
                    className="h-8"
                  >
                    <Plus className="h-3.5 w-3 mr-1" />
                    Ajouter
                  </Button>
                </div>
                <ul className="space-y-3">
                  {panelReferences.map((ref) => (
                    <li
                      key={ref.id}
                      className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => setEditingRef(ref)}
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
                              <span className="inline-flex items-center shrink-0" title={ref.countryOfOrigin}>
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
                          checked={
                            (panelReferences.find((p) => p.visible === true)?.id ??
                              panelReferences.find((p) => p.recommended === true)?.id ??
                              panelReferences[0]?.id) === ref.id
                          }
                          onCheckedChange={(checked) => {
                            let updatedRefs: PanelReference[];
                            if (!checked) return; // un seul panneau "visible" doit rester sélectionné
                            updatedRefs = panelReferences.map((r) =>
                              r.id === ref.id ? { ...r, visible: true } : { ...r, visible: false }
                            );
                            
                            savePanelReferences(updatedRefs);
                            if (userId) {
                              Promise.all(updatedRefs.map((r) => savePanelReferenceToFirebase(r, userId)))
                                .then(() => mutatePanels())
                                .catch((e) => console.error("Firebase save panel refs:", e));
                            }
                          }}
                          size="sm"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </TabsContent>

              {/* Onglet Onduleurs */}
              <TabsContent value="inverters" className="space-y-3 mt-4">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium shrink-0">Références d&apos;onduleur</label>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowInverterCatalogPicker(true)}
                      className="h-8"
                      disabled={!userId}
                    >
                      <ListPlus className="h-3.5 w-3 mr-1" />
                      Ajouter de la liste
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowAddInverterRef(true)}
                      className="h-8"
                    >
                      <Plus className="h-3.5 w-3 mr-1" />
                      Ajouter
                    </Button>
                  </div>
                </div>
                <ul className="space-y-3">
                  {inverterReferences.map((ref) => (
                    <li
                      key={ref.id}
                      className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => setEditingInverterRef(ref)}
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
                              <span className="inline-flex items-center shrink-0" title={ref.countryOfOrigin}>
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
                          onCheckedChange={(checked) => {
                            const visibleCount = inverterReferences.filter((r) => r.visible === true).length;
                            if (!checked && visibleCount === 1 && ref.visible === true) {
                              console.log("[SettingsDrawer] inverter visible: blocage (revert_on)", { refId: ref.id, refName: ref.name });
                              return;
                            }
                            if (!userId) {
                              console.warn("[SettingsDrawer] inverter visible: pas de userId, skip save");
                              return;
                            }
                            const updatedRef = { ...ref, visible: checked };
                            const nextList = inverterReferences.map((r) => (r.id === ref.id ? updatedRef : r));
                            mutateInverters(nextList, { revalidate: false });
                            saveInverterReferenceToFirebase(updatedRef, userId)
                              .catch((e) => {
                                console.error("[SettingsDrawer] Firebase save inverter ref:", e);
                                mutateInverters();
                              });
                          }}
                          size="sm"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </TabsContent>

              {/* Onglet Batteries */}
              <TabsContent value="batteries" className="space-y-3 mt-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Références de batterie</label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddBatteryRef(true)}
                    className="h-8"
                  >
                    <Plus className="h-3.5 w-3 mr-1" />
                    Ajouter
                  </Button>
                </div>
                <ul className="space-y-3">
                  {batteryReferences.map((ref) => (
                    <li
                      key={ref.id}
                      className="rounded-xl border border-border bg-white p-3 shadow-xs flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => setEditingBatteryRef(ref)}
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
                          {ref.countryCode && (
                            <>
                              <span className="text-muted-foreground/40 text-xs">|</span>
                              <span className="inline-flex items-center shrink-0" title={ref.countryOfOrigin}>
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
                          onCheckedChange={(checked) => {
                            const visibleCount = batteryReferences.filter((r) => r.visible === true).length;
                            if (!checked && visibleCount === 1 && ref.visible === true) {
                              console.log("[SettingsDrawer] battery visible: blocage (revert_on)", { refId: ref.id, refName: ref.name });
                              return;
                            }
                            if (!userId) {
                              console.warn("[SettingsDrawer] battery visible: pas de userId, skip save");
                              return;
                            }
                            const updatedRef = { ...ref, visible: checked };
                            const nextList = batteryReferences.map((r) => (r.id === ref.id ? updatedRef : r));
                            mutateBatteries(nextList, { revalidate: false });
                            saveBatteryReferenceToFirebase(updatedRef, userId)
                              .catch((e) => {
                                console.error("[SettingsDrawer] Firebase save battery ref:", e);
                                mutateBatteries();
                              });
                          }}
                          size="sm"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </TabsContent>
            </Tabs>
            )}
              </TabsContent>

              {/* Contenu Informations de compte */}
              <TabsContent value="compte" className="mt-4 space-y-4">
                <div className="rounded-xl border border-border bg-white p-4 shadow-xs space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <User className="h-4 w-4 text-muted-foreground" />
                    Informations du référent commercial
                  </div>
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="account-name">Nom</Label>
                      <Input
                        id="account-name"
                        value={accountInfo.name}
                        onChange={(e) => handleAccountChange("name", e.target.value)}
                        placeholder="Jean Dupont"
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="account-email">Email</Label>
                      <Input
                        id="account-email"
                        type="email"
                        value={accountInfo.email}
                        onChange={(e) => handleAccountChange("email", e.target.value)}
                        placeholder="jean@exemple.fr"
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="account-phone">Téléphone</Label>
                      <Input
                        id="account-phone"
                        value={accountInfo.phone ?? ""}
                        onChange={(e) => handleAccountChange("phone", e.target.value || undefined)}
                        placeholder="+33 6 12 34 56 78"
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="account-calendly">Calendly</Label>
                      <Input
                        id="account-calendly"
                        value={accountInfo.calendlyUrl ?? ""}
                        onChange={(e) => handleAccountChange("calendlyUrl", e.target.value || undefined)}
                        placeholder="https://calendly.com/..."
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="account-company" className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        Nom de l&apos;entreprise
                      </Label>
                      <Input
                        id="account-company"
                        value={accountInfo.company ?? ""}
                        onChange={(e) => handleAccountChange("company", e.target.value || undefined)}
                        placeholder="Solar Pro France"
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">Logo</Label>
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        disabled={!user?.uid || isUploadingLogo}
                        className="h-14 w-14 rounded-lg overflow-hidden bg-muted shrink-0 flex items-center justify-center border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/80 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleLogoDrop}
                        title="Cliquez ou glissez une image pour changer le logo"
                      >
                        {isUploadingLogo ? (
                          <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                        ) : accountInfo.logoUrl ? (
                          <img
                            src={accountInfo.logoUrl}
                            alt="Logo"
                            className="h-full w-full object-contain"
                            referrerPolicy="no-referrer"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-0.5 text-muted-foreground">
                            <Camera className="h-6 w-6" />
                            <span className="text-[9px]">Logo</span>
                          </div>
                        )}
                      </button>
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleLogoChange}
                      />
                    </div>
                  </div>
                </div>

                {/* Statut profil */}
                {user && (
                  <div className="rounded-xl border border-border bg-white p-4 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Profil</span>
                      {quotaDisplay && (
                        <Badge variant={quotaDisplay.status === "admin" ? "solid" : "outline"}>
                          {quotaDisplay.status === "admin" && "Admin"}
                          {quotaDisplay.status === "premium" && "Premium"}
                          {quotaDisplay.status === "starter" && "Starter"}
                          {quotaDisplay.status === "demo" && "Demo"}
                        </Badge>
                      )}
                    </div>
                    {quotaDisplay && (
                      <div className="flex items-center justify-between py-2 pt-3 border-t border-dashed">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">Crédits BDNB</span>
                        </div>
                        <span className="text-sm font-medium tabular-nums">
                          {quotaDisplay.bdnb.current}
                          {quotaDisplay.bdnb.limit != null
                            ? ` / ${quotaDisplay.bdnb.limit}`
                            : " ∞"}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <div className="pt-4 border-t mt-4">
              <p className="text-xs text-muted-foreground">
                Les paramètres sont sauvegardés automatiquement et utilisés pour les calculs de potentiel solaire.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
    {userId ? (
      <InverterCatalogPickerDialog
        open={showInverterCatalogPicker}
        onOpenChange={setShowInverterCatalogPicker}
        userId={userId}
        userReferences={inverterReferences}
        onUserReferencesChange={() => mutateInverters()}
      />
    ) : null}
  </>
  );
}
