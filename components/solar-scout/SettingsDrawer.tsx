"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import { Plus, X, Zap, FileCheck, ArrowLeft, User, Building2, MapPin } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePanelReferences, useInverterReferences } from "@/lib/swr-hooks";
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
  getPanelReferences,
  savePanelReferences,
  getInverterReferences,
  saveInverterReferences,
  getSolarEquipmentSettings,
  saveSolarEquipmentSettings,
} from "@/lib/solar-settings";
import { getCommercialReferent, saveCommercialReferent } from "@/lib/commercial-mock";
import { useAuth } from "@/lib/auth-context";
import { getUserProfile } from "@/lib/firestore-user-profile";
import { getQuotaDisplay } from "@/lib/usage-quotas";
import { Badge } from "@/components/ui/badge";
import { PanelReferenceForm, InverterReferenceForm } from "./Sidebar";
import type { PanelReference, InverterReference, CommercialReferent } from "@/types";

interface SettingsDrawerProps {
  onClose: () => void;
}

export function SettingsDrawer({ onClose }: SettingsDrawerProps) {
  const { user } = useAuth();
  const { data: panelsData, mutate: mutatePanels } = usePanelReferences();
  const { data: invertersData, mutate: mutateInverters } = useInverterReferences();
  const panelReferences = panelsData ?? [];
  const inverterReferences = invertersData ?? [];

  const [quotaDisplay, setQuotaDisplay] = useState<ReturnType<typeof getQuotaDisplay> | null>(null);
  const [showAddPanelRef, setShowAddPanelRef] = useState(false);
  const [editingRef, setEditingRef] = useState<PanelReference | null>(null);
  const [showAddInverterRef, setShowAddInverterRef] = useState(false);
  const [editingInverterRef, setEditingInverterRef] = useState<InverterReference | null>(null);
  const [mainTab, setMainTab] = useState<"materiel" | "compte">("materiel");
  const [materielTab, setMaterielTab] = useState<"panels" | "inverters">("panels");
  const [accountInfo, setAccountInfo] = useState<CommercialReferent>(() => getCommercialReferent());
  const [usableRoofRatio, setUsableRoofRatio] = useState<number>(() => getSolarEquipmentSettings().usableRoofRatio ?? 0.75);

  // Charger les infos compte et paramètres au montage
  useEffect(() => {
    setAccountInfo(getCommercialReferent());
    setUsableRoofRatio(getSolarEquipmentSettings().usableRoofRatio ?? 0.75);
  }, []);

  // Charger profil et quotas quand l'utilisateur est connecté
  useEffect(() => {
    if (!user?.uid) {
      setQuotaDisplay(null);
      return;
    }
    getUserProfile(user.uid).then((profile) => {
      setQuotaDisplay(getQuotaDisplay(profile));
    });
  }, [user?.uid]);

  const handleAccountChange = (field: keyof CommercialReferent, value: string | undefined) => {
    const next = { ...accountInfo, [field]: value ?? "" };
    setAccountInfo(next);
    saveCommercialReferent(next);
  };

  return (
    <div className="h-full w-full bg-gray-50 border-l shadow-xl flex flex-col rounded-2xl overflow-hidden">
      <div className="border-b p-4 bg-white">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            {showAddPanelRef || editingRef 
              ? (editingRef ? "Modifier le panneau" : "Ajouter une référence")
              : showAddInverterRef || editingInverterRef
              ? (editingInverterRef ? "Modifier l'onduleur" : "Ajouter une référence")
              : "Personnalisation"}
          </h2>
          {(showAddPanelRef || editingRef || showAddInverterRef || editingInverterRef) ? (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border border-gray-300"
              onClick={() => {
                setShowAddPanelRef(false);
                setEditingRef(null);
                setShowAddInverterRef(false);
                setEditingInverterRef(null);
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
        {!(showAddPanelRef || editingRef || showAddInverterRef || editingInverterRef) && (
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
            onDelete={(id) => {
              const next = panelReferences.filter((r) => r.id !== id);
              if (next.length === 0) return;
              savePanelReferences(next);
              deletePanelReferenceFromFirebase(id)
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
                if (ref.recommended) {
                  updatedRefs = panelReferences.map((r) => ({ ...r, recommended: false }));
                  updatedRefs = [...updatedRefs, ref];
                } else {
                  updatedRefs = [...panelReferences, ref];
                }
              }
              
              savePanelReferences(updatedRefs);
              Promise.all(updatedRefs.map((r) => savePanelReferenceToFirebase(r)))
                .then(() => mutatePanels())
                .catch((e) => console.error("Firebase save panel refs:", e));
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
            onDelete={(id) => {
              const next = inverterReferences.filter((r) => r.id !== id);
              if (next.length === 0) return;
              saveInverterReferences(next);
              deleteInverterReferenceFromFirebase(id)
                .then(() => mutateInverters())
                .catch((e) => console.error("Firebase delete inverter ref:", e));
              setShowAddInverterRef(false);
              setEditingInverterRef(null);
            }}
            onSave={(ref) => {
              let updatedRefs: InverterReference[];
              if (editingInverterRef) {
                if (ref.recommended) {
                  updatedRefs = inverterReferences.map((r) => 
                    r.id === ref.id ? ref : { ...r, recommended: false }
                  );
                } else {
                  updatedRefs = inverterReferences.map((r) => (r.id === ref.id ? ref : r));
                }
              } else {
                if (ref.recommended) {
                  updatedRefs = inverterReferences.map((r) => ({ ...r, recommended: false }));
                  updatedRefs = [...updatedRefs, ref];
                } else {
                  updatedRefs = [...inverterReferences, ref];
                }
              }
              
              saveInverterReferences(updatedRefs);
              Promise.all(updatedRefs.map((r) => saveInverterReferenceToFirebase(r)))
                .then(() => mutateInverters())
                .catch((e) => console.error("Firebase save inverter refs:", e));
              setShowAddInverterRef(false);
              setEditingInverterRef(null);
            }}
            onCancel={() => {
              setShowAddInverterRef(false);
              setEditingInverterRef(null);
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
            <Tabs value={materielTab} onValueChange={(v) => setMaterielTab(v as "panels" | "inverters")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="panels">Panneaux</TabsTrigger>
                <TabsTrigger value="inverters">Onduleurs</TabsTrigger>
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
                          checked={ref.recommended ?? false}
                          onCheckedChange={(checked) => {
                            let updatedRefs: PanelReference[];
                            if (checked) {
                              updatedRefs = panelReferences.map((r) => 
                                r.id === ref.id ? { ...r, recommended: true } : { ...r, recommended: false }
                              );
                            } else {
                              updatedRefs = panelReferences.map((r) => 
                                r.id === ref.id ? { ...r, recommended: false } : r
                              );
                            }
                            
                            savePanelReferences(updatedRefs);
                            Promise.all(updatedRefs.map((r) => savePanelReferenceToFirebase(r)))
                              .then(() => mutatePanels())
                              .catch((e) => console.error("Firebase save panel refs:", e));
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
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Références d&apos;onduleur</label>
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
                          checked={ref.recommended ?? false}
                          onCheckedChange={(checked) => {
                            let updatedRefs: InverterReference[];
                            if (checked) {
                              updatedRefs = inverterReferences.map((r) => 
                                r.id === ref.id ? { ...r, recommended: true } : { ...r, recommended: false }
                              );
                            } else {
                              updatedRefs = inverterReferences.map((r) => 
                                r.id === ref.id ? { ...r, recommended: false } : r
                              );
                            }
                            
                            saveInverterReferences(updatedRefs);
                            Promise.all(updatedRefs.map((r) => saveInverterReferenceToFirebase(r)))
                              .then(() => mutateInverters())
                              .catch((e) => console.error("Firebase save inverter refs:", e));
                          }}
                          size="sm"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </TabsContent>
            </Tabs>
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
                      <Label htmlFor="account-logo">URL du logo</Label>
                      <Input
                        id="account-logo"
                        value={accountInfo.logoUrl ?? ""}
                        onChange={(e) => handleAccountChange("logoUrl", e.target.value || undefined)}
                        placeholder="https://..."
                        className="bg-white"
                      />
                      {accountInfo.logoUrl && (
                        <div className="mt-2 flex items-center gap-2">
                          <img
                            src={accountInfo.logoUrl}
                            alt="Logo"
                            className="h-12 w-auto object-contain rounded border"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Statut et quotas API */}
                {user && (
                  <div className="rounded-xl border border-border bg-white p-4 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Profil et quotas</span>
                      {quotaDisplay && (
                        <Badge variant={quotaDisplay.status === "admin" ? "default" : "outline"}>
                          {quotaDisplay.status === "admin" && "Admin"}
                          {quotaDisplay.status === "premium" && "Premium"}
                          {quotaDisplay.status === "starter" && "Starter"}
                          {quotaDisplay.status === "demo" && "Demo"}
                        </Badge>
                      )}
                    </div>
                    {quotaDisplay ? (
                      <div className="space-y-3 text-sm">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">BDNB :</span>
                          <span>
                            {quotaDisplay.bdnb.current}
                            {quotaDisplay.bdnb.limit != null
                              ? ` / ${quotaDisplay.bdnb.limit}`
                              : " (illimité)"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">OSM :</span>
                          <span>
                            {quotaDisplay.osm.current}
                            {quotaDisplay.osm.limit != null
                              ? ` / ${quotaDisplay.osm.limit}`
                              : " (illimité)"}
                          </span>
                        </div>
                        {quotaDisplay.bdnb.resetAt && (
                          <p className="text-xs text-muted-foreground">
                            Reset : {new Date(quotaDisplay.bdnb.resetAt).toLocaleDateString("fr-FR")}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Chargement…</p>
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
  );
}
