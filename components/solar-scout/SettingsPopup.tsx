"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, X, Zap, FileCheck, ArrowLeft, User, Settings, Sun, Building2, LogOut, Loader2, Camera } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCountryFlagUrl } from "@/lib/solar-settings";
import {
  getPanelReferencesFromFirebase,
  savePanelReferenceToFirebase,
  deletePanelReferenceFromFirebase,
  initializePanelReferencesInFirebase,
} from "@/lib/firestore-panel-references";
import {
  getInverterReferencesFromFirebase,
  saveInverterReferenceToFirebase,
  deleteInverterReferenceFromFirebase,
  initializeInverterReferencesInFirebase,
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
import { getUserProfile, setUserProfile, type UserProfile } from "@/lib/firestore-user-profile";
import { PanelReferenceForm, InverterReferenceForm } from "./Sidebar";
import { useAuth } from "@/lib/auth-context";
import { signOut, updateProfile } from "firebase/auth";
import { auth, storage } from "@/lib/firebase";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import type { PanelReference, InverterReference, CommercialReferent } from "@/types";

type MenuItem = "compte" | "parametres";

interface SettingsPopupProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPopup({ open, onClose }: SettingsPopupProps) {
  const { user } = useAuth();
  const [activeMenu, setActiveMenu] = useState<MenuItem>("compte");
  const [panelReferences, setPanelReferences] = useState<PanelReference[]>([]);
  const [showAddPanelRef, setShowAddPanelRef] = useState(false);
  const [editingRef, setEditingRef] = useState<PanelReference | null>(null);
  const [inverterReferences, setInverterReferences] = useState<InverterReference[]>([]);
  const [showAddInverterRef, setShowAddInverterRef] = useState(false);
  const [editingInverterRef, setEditingInverterRef] = useState<InverterReference | null>(null);
  const [materielTab, setMaterielTab] = useState<"panels" | "inverters">("panels");
  const [usableRoofRatio, setUsableRoofRatio] = useState<number>(() => getSolarEquipmentSettings().usableRoofRatio ?? 0.75);
  const [accountInfo, setAccountInfo] = useState<CommercialReferent>(() => getCommercialReferent());
  const [editingProfile, setEditingProfile] = useState(false);
  const [userProfile, setUserProfileState] = useState<UserProfile | null>(null);
  const [profileForm, setProfileForm] = useState({ firstName: "", lastName: "", phone: "" });
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);

  // Charger le profil utilisateur (Firestore) à l'ouverture du popup / menu Compte
  useEffect(() => {
    if (!open || !user?.uid) return;
    getUserProfile(user.uid)
      .then((p) => {
        setUserProfileState(p ?? null);
        if (p && editingProfile) {
          setProfileForm({
            firstName: p.firstName ?? "",
            lastName: p.lastName ?? "",
            phone: p.phone ?? "",
          });
        }
      })
      .catch(() => setUserProfileState(null));
  }, [open, user?.uid]);

  // Initialiser le formulaire quand on ouvre l'édition (depuis Auth + Firestore)
  useEffect(() => {
    if (!editingProfile || !user) return;
    const parts = (user.displayName ?? "").trim().split(/\s+/).filter(Boolean);
    const firstName = userProfile?.firstName ?? (parts[0] ?? "");
    const lastName = userProfile?.lastName ?? (parts.slice(1).join(" ") ?? "");
    setProfileForm({
      firstName,
      lastName,
      phone: user.phoneNumber ?? userProfile?.phone ?? "",
    });
  }, [editingProfile, user?.uid, user?.displayName, user?.phoneNumber, userProfile?.firstName, userProfile?.lastName, userProfile?.phone]);

  // Charger les références de panneaux
  useEffect(() => {
    let cancelled = false;
    getPanelReferencesFromFirebase()
      .then(async (fromFirebase) => {
        if (cancelled) return;
        if (fromFirebase.length > 0) {
          setPanelReferences(fromFirebase);
          savePanelReferences(fromFirebase);
        } else {
          await initializePanelReferencesInFirebase().catch(() => {});
          if (cancelled) return;
          const afterInit = await getPanelReferencesFromFirebase();
          if (afterInit.length > 0) {
            setPanelReferences(afterInit);
            savePanelReferences(afterInit);
          } else {
            const fromLocal = getPanelReferences();
            if (fromLocal.length > 0) setPanelReferences(fromLocal);
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        const fromLocal = getPanelReferences();
        if (fromLocal.length > 0) setPanelReferences(fromLocal);
      });
    return () => { cancelled = true; };
  }, []);

  // Charger les références d'onduleur
  useEffect(() => {
    let cancelled = false;
    getInverterReferencesFromFirebase()
      .then(async (fromFirebase) => {
        if (cancelled) return;
        if (fromFirebase.length > 0) {
          setInverterReferences(fromFirebase);
          saveInverterReferences(fromFirebase);
        } else {
          await initializeInverterReferencesInFirebase().catch(() => {});
          if (cancelled) return;
          const afterInit = await getInverterReferencesFromFirebase();
          if (afterInit.length > 0) {
            setInverterReferences(afterInit);
            saveInverterReferences(afterInit);
          } else {
            const fromLocal = getInverterReferences();
            if (fromLocal.length > 0) setInverterReferences(fromLocal);
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        const fromLocal = getInverterReferences();
        if (fromLocal.length > 0) setInverterReferences(fromLocal);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setAccountInfo(getCommercialReferent());
  }, [open]);

  useEffect(() => {
    if (open) setUsableRoofRatio(getSolarEquipmentSettings().usableRoofRatio ?? 0.75);
  }, [open]);

  const handleAccountChange = (field: keyof CommercialReferent, value: string | undefined) => {
    const next = { ...accountInfo, [field]: value ?? "" };
    setAccountInfo(next);
    saveCommercialReferent(next);
  };

  const handleProfilePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setProfilePhotoFile(file);
      const url = URL.createObjectURL(file);
      setProfilePhotoPreview(url);
    }
    e.target.value = "";
  };

  const handleProfilePhotoDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setProfilePhotoFile(file);
      const url = URL.createObjectURL(file);
      setProfilePhotoPreview(url);
    }
  };

  const isStoragePermissionError = (e: unknown): boolean => {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes("storage/unauthorized") || msg.includes("permission") || msg.includes("PERMISSION_DENIED");
  };

  const saveProfile = async () => {
    if (!user) return;
    setProfileError(null);
    setIsSavingProfile(true);
    try {
      let photoURL: string | undefined = user.photoURL ?? undefined;
      if (profilePhotoFile) {
        setIsUploadingPhoto(true);
        try {
          const path = `user_photos/${user.uid}/avatar_${Date.now()}.jpg`;
          const ref = storageRef(storage, path);
          await uploadBytes(ref, profilePhotoFile);
          photoURL = await getDownloadURL(ref);
        } catch (storageErr) {
          if (isStoragePermissionError(storageErr)) {
            setProfileError("Photo non enregistrée : déployer les règles Storage (firebase deploy --only storage:rules). Nom et téléphone seront enregistrés.");
          } else {
            throw storageErr;
          }
        } finally {
          setIsUploadingPhoto(false);
        }
      }
      const displayName = [profileForm.firstName, profileForm.lastName].filter(Boolean).join(" ").trim() || undefined;
      await updateProfile(user, { displayName: displayName ?? undefined, photoURL });
      await setUserProfile(user.uid, {
        firstName: profileForm.firstName.trim() || undefined,
        lastName: profileForm.lastName.trim() || undefined,
        phone: profileForm.phone.trim() || undefined,
      });
      setUserProfileState((prev) => ({ ...prev, firstName: profileForm.firstName.trim() || undefined, lastName: profileForm.lastName.trim() || undefined, phone: profileForm.phone.trim() || undefined }));
      if (profilePhotoPreview) URL.revokeObjectURL(profilePhotoPreview);
      setProfilePhotoFile(null);
      setProfilePhotoPreview(null);
      setEditingProfile(false);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Erreur lors de l’enregistrement");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const displayName = user?.displayName
    ?? (userProfile?.firstName || userProfile?.lastName ? [userProfile.firstName, userProfile.lastName].filter(Boolean).join(" ") : null)
    ?? user?.email?.split("@")[0]
    ?? "Utilisateur";
  const displayEmail = user?.email ?? "";
  const displayPhone = user?.phoneNumber ?? userProfile?.phone ?? "";

  const menuItems: { id: MenuItem; label: string; icon: typeof User }[] = [
    { id: "compte", label: "Compte", icon: User },
    { id: "parametres", label: "Paramètres", icon: Settings },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-4xl w-[95vw] h-[85vh] min-h-[400px] p-0 gap-0 overflow-hidden flex flex-col sm:rounded-xl [&>button]:hidden"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Paramètres et compte</DialogTitle>
        <div className="flex flex-1 min-h-0 overflow-hidden shrink">
          {/* Menu latéral gauche */}
          <nav className="w-56 shrink-0 border-r bg-muted/30 flex flex-col">
            <div className="p-4 border-b flex items-center gap-2">
              <Image
                src="/logo-radianz.png"
                alt="Radianz"
                width={32}
                height={32}
                className="object-contain shrink-0"
              />
              <span className="font-semibold text-sm">Radianz</span>
            </div>
            <div className="flex-1 py-2 space-y-0.5">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeMenu === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveMenu(item.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-background text-foreground border-l-2 border-primary"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Zone de contenu droite */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
              <h2 className="text-lg font-semibold">
                {activeMenu === "compte"
                  ? "Compte"
                  : showAddPanelRef || editingRef
                  ? editingRef
                    ? "Modifier le panneau"
                    : "Ajouter une référence"
                  : showAddInverterRef || editingInverterRef
                  ? editingInverterRef
                    ? "Modifier l&apos;onduleur"
                    : "Ajouter une référence"
                  : "Paramètres"}
              </h2>
              {(showAddPanelRef || editingRef || showAddInverterRef || editingInverterRef) ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {
                    setShowAddPanelRef(false);
                    setEditingRef(null);
                    setShowAddInverterRef(false);
                    setEditingInverterRef(null);
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-6">
              {/* Contenu Compte - informations depuis Firebase Auth + Firestore */}
              {activeMenu === "compte" && (
                <div className="space-y-6">
                  {editingProfile ? (
                    /* Formulaire de modification du profil */
                    <div className="space-y-4 max-w-md">
                      <div className="flex items-start gap-4">
                        <div
                          className="h-20 w-20 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0 border-2 border-dashed border-muted-foreground/30 cursor-pointer hover:border-primary/50 transition-colors"
                          onClick={() => profilePhotoInputRef.current?.click()}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={handleProfilePhotoDrop}
                        >
                          {profilePhotoPreview ? (
                            <img src={profilePhotoPreview} alt="" className="h-full w-full object-cover" />
                          ) : user?.photoURL ? (
                            <img src={user.photoURL} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="flex flex-col items-center gap-1 text-muted-foreground">
                              <Camera className="h-8 w-8" />
                              <span className="text-[10px]">Photo</span>
                            </div>
                          )}
                        </div>
                        <input
                          ref={profilePhotoInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleProfilePhotoChange}
                        />
                        <div className="flex-1 min-w-0 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label htmlFor="profile-firstName">Prénom</Label>
                              <Input
                                id="profile-firstName"
                                value={profileForm.firstName}
                                onChange={(e) => setProfileForm((f) => ({ ...f, firstName: e.target.value }))}
                                placeholder="Prénom"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="profile-lastName">Nom</Label>
                              <Input
                                id="profile-lastName"
                                value={profileForm.lastName}
                                onChange={(e) => setProfileForm((f) => ({ ...f, lastName: e.target.value }))}
                                placeholder="Nom"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="profile-phone">Numéro de téléphone</Label>
                            <Input
                              id="profile-phone"
                              type="tel"
                              value={profileForm.phone}
                              onChange={(e) => setProfileForm((f) => ({ ...f, phone: e.target.value }))}
                              placeholder="+33 6 12 34 56 78"
                            />
                          </div>
                        </div>
                      </div>
                      {profileError && (
                        <p className="text-sm text-destructive">{profileError}</p>
                      )}
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={saveProfile}
                          disabled={isSavingProfile || isUploadingPhoto}
                          className="gap-1.5"
                        >
                          {(isSavingProfile || isUploadingPhoto) && <Loader2 className="h-4 w-4 animate-spin" />}
                          {isSavingProfile ? "Enregistrement..." : isUploadingPhoto ? "Téléversement..." : "Enregistrer"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditingProfile(false);
                            setProfilePhotoFile(null);
                            if (profilePhotoPreview) URL.revokeObjectURL(profilePhotoPreview);
                            setProfilePhotoPreview(null);
                            setProfileError(null);
                          }}
                          disabled={isSavingProfile}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start gap-4">
                        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                          {user?.photoURL ? (
                            <img
                              src={user.photoURL}
                              alt=""
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <User className="h-8 w-8 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-base">{displayName}</p>
                          <p className="text-sm text-muted-foreground">{displayEmail || (user ? "—" : "Non connecté")}</p>
                          {displayPhone ? (
                            <p className="text-sm text-muted-foreground">{displayPhone}</p>
                          ) : null}
                          <div className="flex items-center gap-2 mt-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1.5"
                              onClick={() => setEditingProfile(true)}
                            >
                              <User className="h-3.5 w-3.5" />
                              Modifier
                            </Button>
                            {user && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
                                onClick={() => signOut(auth)}
                              >
                                <LogOut className="h-3.5 w-3.5" />
                                Déconnexion
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border p-4 space-y-2">
                        <p className="text-lg font-semibold">Gratuit</p>
                      </div>
                    </>
                  )}

                  {!editingProfile && (
                    <div className="rounded-xl border bg-card p-4 space-y-4">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        Entreprise
                      </div>
                      <div className="flex flex-wrap items-start gap-4">
                        {accountInfo.logoUrl ? (
                          <div className="h-14 w-14 rounded-lg overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                            <img
                              src={accountInfo.logoUrl}
                              alt="Logo"
                              className="h-full w-full object-contain"
                              referrerPolicy="no-referrer"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          </div>
                        ) : (
                          <div className="h-14 w-14 rounded-lg bg-muted shrink-0 flex items-center justify-center">
                            <Building2 className="h-7 w-7 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0 space-y-3">
                          <div className="space-y-2">
                            <Label htmlFor="popup-account-company">Nom de l&apos;entreprise</Label>
                            <Input
                              id="popup-account-company"
                              value={accountInfo.company ?? ""}
                              onChange={(e) => handleAccountChange("company", e.target.value || undefined)}
                              placeholder="Solar Pro France"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="popup-account-logo">URL du logo</Label>
                            <Input
                              id="popup-account-logo"
                              value={accountInfo.logoUrl ?? ""}
                              onChange={(e) => handleAccountChange("logoUrl", e.target.value || undefined)}
                              placeholder="https://..."
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Contenu Paramètres (Matériel) */}
              {activeMenu === "parametres" && (
                <>
                  {(showAddPanelRef || editingRef) ? (
                    <PanelReferenceForm
                      key={editingRef?.id ?? "add"}
                      initialRef={editingRef ?? undefined}
                      allReferences={panelReferences}
                      onDelete={(id) => {
                        const next = panelReferences.filter((r) => r.id !== id);
                        if (next.length === 0) return;
                        setPanelReferences(next);
                        savePanelReferences(next);
                        deletePanelReferenceFromFirebase(id).catch(() => {});
                        setShowAddPanelRef(false);
                        setEditingRef(null);
                      }}
                      onSave={(ref) => {
                        let updatedRefs: PanelReference[];
                        if (editingRef) {
                          updatedRefs = ref.recommended
                            ? panelReferences.map((r) => (r.id === ref.id ? ref : { ...r, recommended: false }))
                            : panelReferences.map((r) => (r.id === ref.id ? ref : r));
                        } else {
                          updatedRefs = ref.recommended
                            ? [...panelReferences.map((r) => ({ ...r, recommended: false })), ref]
                            : [...panelReferences, ref];
                        }
                        setPanelReferences(updatedRefs);
                        savePanelReferences(updatedRefs);
                        Promise.all(updatedRefs.map((r) => savePanelReferenceToFirebase(r))).catch(() => {});
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
                        setInverterReferences(next);
                        saveInverterReferences(next);
                        deleteInverterReferenceFromFirebase(id).catch(() => {});
                        setShowAddInverterRef(false);
                        setEditingInverterRef(null);
                      }}
                      onSave={(ref) => {
                        let updatedRefs: InverterReference[];
                        if (editingInverterRef) {
                          updatedRefs = ref.recommended
                            ? inverterReferences.map((r) => (r.id === ref.id ? ref : { ...r, recommended: false }))
                            : inverterReferences.map((r) => (r.id === ref.id ? ref : r));
                        } else {
                          updatedRefs = ref.recommended
                            ? [...inverterReferences.map((r) => ({ ...r, recommended: false })), ref]
                            : [...inverterReferences, ref];
                        }
                        setInverterReferences(updatedRefs);
                        saveInverterReferences(updatedRefs);
                        Promise.all(updatedRefs.map((r) => saveInverterReferenceToFirebase(r))).catch(() => {});
                        setShowAddInverterRef(false);
                        setEditingInverterRef(null);
                      }}
                      onCancel={() => {
                        setShowAddInverterRef(false);
                        setEditingInverterRef(null);
                      }}
                    />
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-xl border bg-card p-4 space-y-2">
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
                      <Tabs value={materielTab} onValueChange={(v) => setMaterielTab(v as "panels" | "inverters")}>
                        <TabsList className="grid w-full max-w-md grid-cols-2">
                          <TabsTrigger value="panels">Panneaux</TabsTrigger>
                          <TabsTrigger value="inverters">Onduleurs</TabsTrigger>
                        </TabsList>

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
                                className="rounded-xl border bg-card p-3 flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                                onClick={() => setEditingRef(ref)}
                              >
                                <div className="shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-muted">
                                  {ref.imageUrl ? (
                                    <Image
                                      src={ref.imageUrl}
                                      alt={ref.name}
                                      width={56}
                                      height={56}
                                      className="w-full h-full object-cover"
                                      unoptimized
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">—</div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{ref.name}</div>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-muted-foreground">
                                    <span>€{ref.costEur}</span>
                                    <span>|</span>
                                    <span className="flex items-center gap-0.5">
                                      <Zap className="h-3 w-3" /> {ref.powerW}W
                                    </span>
                                    {ref.warrantyYears != null && (
                                      <>
                                        <span>|</span>
                                        <span className="flex items-center gap-0.5">
                                          <FileCheck className="h-3 w-3" /> {ref.warrantyYears}y
                                        </span>
                                      </>
                                    )}
                                    {ref.countryCode && (
                                      <>
                                        <span>|</span>
                                        <img
                                          src={getCountryFlagUrl(ref.countryCode)}
                                          alt=""
                                          className="w-3 h-3 rounded-full object-cover"
                                        />
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div onClick={(e) => e.stopPropagation()}>
                                  <Switch
                                    checked={ref.recommended ?? false}
                                    onCheckedChange={(checked) => {
                                      const updatedRefs = panelReferences.map((r) =>
                                        r.id === ref.id ? { ...r, recommended: checked } : { ...r, recommended: checked ? false : r.recommended }
                                      );
                                      setPanelReferences(updatedRefs);
                                      savePanelReferences(updatedRefs);
                                      Promise.all(updatedRefs.map((r) => savePanelReferenceToFirebase(r))).catch(() => {});
                                    }}
                                    className="h-4 w-8"
                                  />
                                </div>
                              </li>
                            ))}
                          </ul>
                        </TabsContent>

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
                                className="rounded-xl border bg-card p-3 flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                                onClick={() => setEditingInverterRef(ref)}
                              >
                                <div className="shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-muted">
                                  {ref.imageUrl ? (
                                    <Image
                                      src={ref.imageUrl}
                                      alt={ref.name}
                                      width={56}
                                      height={56}
                                      className="w-full h-full object-cover"
                                      unoptimized
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">—</div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{ref.name}</div>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-muted-foreground">
                                    <span>€{ref.costEur}</span>
                                    <span>|</span>
                                    <span className="flex items-center gap-0.5">
                                      <Zap className="h-3 w-3" /> {ref.powerW}W
                                    </span>
                                    {ref.warrantyYears != null && (
                                      <>
                                        <span>|</span>
                                        <span className="flex items-center gap-0.5">
                                          <FileCheck className="h-3 w-3" /> {ref.warrantyYears}y
                                        </span>
                                      </>
                                    )}
                                    {ref.countryCode && (
                                      <>
                                        <span>|</span>
                                        <img
                                          src={getCountryFlagUrl(ref.countryCode)}
                                          alt=""
                                          className="w-3 h-3 rounded-full object-cover"
                                        />
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div onClick={(e) => e.stopPropagation()}>
                                  <Switch
                                    checked={ref.recommended ?? false}
                                    onCheckedChange={(checked) => {
                                      const updatedRefs = inverterReferences.map((r) =>
                                        r.id === ref.id ? { ...r, recommended: checked } : { ...r, recommended: checked ? false : r.recommended }
                                      );
                                      setInverterReferences(updatedRefs);
                                      saveInverterReferences(updatedRefs);
                                      Promise.all(updatedRefs.map((r) => saveInverterReferenceToFirebase(r))).catch(() => {});
                                    }}
                                    className="h-4 w-8"
                                  />
                                </div>
                              </li>
                            ))}
                          </ul>
                        </TabsContent>
                      </Tabs>

                      <p className="text-xs text-muted-foreground pt-2">
                        Les paramètres sont sauvegardés automatiquement et utilisés pour les calculs de potentiel solaire.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
