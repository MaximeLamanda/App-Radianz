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
import { Plus, X, Zap, FileCheck, ArrowLeft, User, Settings, Sun, Building2, LogOut, Loader2, Camera, Sparkles, Battery } from "lucide-react";
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
import { getUserProfile, setUserProfile, type UserProfile } from "@/lib/firestore-user-profile";
import { PanelReferenceForm, InverterReferenceForm, BatteryReferenceForm } from "./Sidebar";
import { useAuth } from "@/lib/auth-context";
import { signOut, updateProfile } from "firebase/auth";
import { auth, storage } from "@/lib/firebase";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import type { PanelReference, InverterReference, BatteryReference, CommercialReferent } from "@/types";
import { Badge } from "@/components/ui/badge";
type MenuItem = "compte" | "parametres";

interface SettingsPopupProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPopup({ open, onClose }: SettingsPopupProps) {
  const { user } = useAuth();
  const userId = user?.uid ?? null;
  const { data: panelsData, mutate: mutatePanels } = usePanelReferences(userId);
  const { data: invertersData, mutate: mutateInverters } = useInverterReferences(userId);
  const { data: batteriesData, mutate: mutateBatteries } = useBatteryReferences(userId);
  const panelReferences = panelsData ?? [];
  const inverterReferences = invertersData ?? [];
  const batteryReferences = batteriesData ?? [];

  const [activeMenu, setActiveMenu] = useState<MenuItem>("compte");
  const [showAddPanelRef, setShowAddPanelRef] = useState(false);
  const [editingRef, setEditingRef] = useState<PanelReference | null>(null);
  const [showAddInverterRef, setShowAddInverterRef] = useState(false);
  const [editingInverterRef, setEditingInverterRef] = useState<InverterReference | null>(null);
  const [showAddBatteryRef, setShowAddBatteryRef] = useState(false);
  const [editingBatteryRef, setEditingBatteryRef] = useState<BatteryReference | null>(null);
  const [materielTab, setMaterielTab] = useState<"panels" | "inverters" | "batteries">("panels");
  const [usableRoofRatio, setUsableRoofRatio] = useState<number>(() => getSolarEquipmentSettings().usableRoofRatio ?? 0.75);
  const [accountInfo, setAccountInfo] = useState<CommercialReferent>(() => getCommercialReferent());
  const [editingProfile, setEditingProfile] = useState(false);
  const [userProfile, setUserProfileState] = useState<UserProfile | null>(null);
  const [profileForm, setProfileForm] = useState({ firstName: "", lastName: "", phone: "" });
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Charger le profil utilisateur (Firestore) à l'ouverture du popup / menu Compte
  // et synchro company/logo avec accountInfo (UserProfile = source de vérité pour onboarding)
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
        const fromStorage = getCommercialReferent();
        const merged: CommercialReferent = {
          ...fromStorage,
          company: p?.companyName?.trim() || fromStorage.company || "",
          logoUrl: p?.companyLogoUrl?.trim() || fromStorage.logoUrl || "",
        };
        setAccountInfo(merged);
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

  useEffect(() => {
    if (!open || !user?.uid) setAccountInfo(getCommercialReferent());
  }, [open, user?.uid]);

  useEffect(() => {
    if (open) setUsableRoofRatio(getSolarEquipmentSettings().usableRoofRatio ?? 0.75);
  }, [open]);

  const handleAccountChange = (field: keyof CommercialReferent, value: string | undefined) => {
    const next = { ...accountInfo, [field]: value ?? "" };
    setAccountInfo(next);
    saveCommercialReferent(next);
    if (user?.uid && (field === "company" || field === "logoUrl")) {
      setUserProfile(user.uid, {
        ...(field === "company" && { companyName: value?.trim() || undefined }),
        ...(field === "logoUrl" && { companyLogoUrl: value?.trim() || undefined }),
      }).catch((e) => console.warn("Synchro UserProfile:", e));
    }
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

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/") || !user?.uid) return;
    const preview = URL.createObjectURL(file);
    setLogoPreview(preview);
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
      URL.revokeObjectURL(preview);
      setIsUploadingLogo(false);
      setLogoPreview(null);
    }
  };

  const handleLogoDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/") || !user?.uid) return;
    const preview = URL.createObjectURL(file);
    setLogoPreview(preview);
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
      URL.revokeObjectURL(preview);
      setIsUploadingLogo(false);
      setLogoPreview(null);
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
                        <div className="flex items-center justify-between">
                          <p className="text-lg font-semibold">
                            {userProfile?.status === "admin" ? "Admin" : userProfile?.status === "premium" ? "Premium" : userProfile?.status === "demo" ? "Demo" : userProfile?.status === "starter" ? "Starter" : "Gratuit"}
                          </p>
                          <Button variant="secondary" size="sm" className="rounded-full font-medium">
                            Mise à niveau
                          </Button>
                        </div>
                        {user && userProfile && (
                          <div className="flex items-center justify-between py-2 pt-3 border-t border-dashed mt-3">
                            <div className="flex items-center gap-1.5">
                              <Sparkles className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">Crédits</span>
                            </div>
                            <span className="text-sm font-medium tabular-nums">
                              {userProfile.bdnbRequestCount ?? 0}
                              {userProfile.status === "admin"
                                ? " ∞"
                                : userProfile.status === "premium"
                                  ? " / 5000"
                                  : userProfile.status === "starter" || !userProfile.status
                                    ? " / 500"
                                    : userProfile.status === "demo"
                                      ? " / 10"
                                      : ""}
                            </span>
                          </div>
                        )}
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
                          ) : logoPreview ? (
                            <img src={logoPreview} alt="" className="h-full w-full object-contain" />
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
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="space-y-2">
                            <Label htmlFor="popup-account-company">Nom de l&apos;entreprise</Label>
                            <Input
                              id="popup-account-company"
                              value={accountInfo.company ?? ""}
                              onChange={(e) => handleAccountChange("company", e.target.value || undefined)}
                              placeholder="Solar Pro France"
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
                  {(showAddPanelRef || editingRef) && user ? (
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
                        deletePanelReferenceFromFirebase(id, userId).then(() => mutatePanels()).catch(() => {});
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
                          // Panneaux : un seul "visible". Nouveau panneau = visible par défaut.
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
                            .catch(() => {});
                        }
                        setShowAddPanelRef(false);
                        setEditingRef(null);
                      }}
                      onCancel={() => {
                        setShowAddPanelRef(false);
                        setEditingRef(null);
                      }}
                    />
                  ) : (showAddInverterRef || editingInverterRef) && user ? (
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
                        deleteInverterReferenceFromFirebase(id, userId).then(() => mutateInverters()).catch(() => {});
                        setShowAddInverterRef(false);
                        setEditingInverterRef(null);
                      }}
                      onSave={async (ref) => {
                        const toSave: InverterReference = editingInverterRef
                          ? { ...inverterReferences.find((r) => r.id === ref.id), ...ref } as InverterReference
                          : { ...ref, visible: ref.visible !== false };
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
                  ) : (showAddBatteryRef || editingBatteryRef) && user ? (
                    <BatteryReferenceForm
                      key={editingBatteryRef?.id ?? "add"}
                      initialRef={editingBatteryRef ?? undefined}
                      allReferences={batteryReferences}
                      userId={userId}
                      onDelete={(id) => {
                        const next = batteryReferences.filter((r) => r.id !== id);
                        if (next.length === 0) return;
                        if (!userId) return;
                        deleteBatteryReferenceFromFirebase(id, userId).then(() => mutateBatteries()).catch(() => {});
                        setShowAddBatteryRef(false);
                        setEditingBatteryRef(null);
                      }}
                      onSave={async (ref) => {
                        const toSave: BatteryReference = editingBatteryRef
                          ? { ...batteryReferences.find((r) => r.id === ref.id), ...ref } as BatteryReference
                          : { ...ref, visible: ref.visible !== false };
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
                  ) : !user ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      Connectez-vous pour gérer votre matériel (panneaux, onduleurs, batteries).
                    </div>
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
                      <Tabs value={materielTab} onValueChange={(v) => setMaterielTab(v as "panels" | "inverters" | "batteries")}>
                        <TabsList className="grid w-full max-w-md grid-cols-3">
                          <TabsTrigger value="panels">Panneaux</TabsTrigger>
                          <TabsTrigger value="inverters">Onduleurs</TabsTrigger>
                          <TabsTrigger value="batteries">Batteries</TabsTrigger>
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
                                    checked={
                                      (panelReferences.find((p) => p.visible === true)?.id ??
                                        panelReferences.find((p) => p.recommended === true)?.id ??
                                        panelReferences[0]?.id) === ref.id
                                    }
                                    onCheckedChange={(checked) => {
                                      if (!checked) return; // un seul panneau "visible" doit rester sélectionné
                                      const updatedRefs = panelReferences.map((r) =>
                                        r.id === ref.id ? { ...r, visible: true } : { ...r, visible: false }
                                      );
                                      savePanelReferences(updatedRefs);
                                      if (userId) {
                                        Promise.all(updatedRefs.map((r) => savePanelReferenceToFirebase(r, userId)))
                                          .then(() => mutatePanels())
                                          .catch(() => {});
                                      }
                                    }}
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
                                    checked={ref.visible === true}
                                    onCheckedChange={async (checked) => {
                                      const visibleCount = inverterReferences.filter((r) => r.visible === true).length;
                                      if (!checked && visibleCount === 1 && ref.visible === true) return; // garder au moins un visible
                                      if (!userId) return;
                                      const updatedRef = { ...ref, visible: checked };
                                      const nextList = inverterReferences.map((r) => (r.id === ref.id ? updatedRef : r));
                                      mutateInverters(nextList, { revalidate: false });
                                      try {
                                        await saveInverterReferenceToFirebase(updatedRef, userId);
                                      } catch (e) {
                                        mutateInverters();
                                      }
                                    }}
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
                          <p className="text-xs text-muted-foreground">
                            Les batteries par défaut sont chargées depuis Firestore. Utilisées dans les calculs d&apos;injection et tirage batterie.
                          </p>
                          <ul className="space-y-3">
                            {batteryReferences.map((ref) => (
                              <li
                                key={ref.id}
                                className="rounded-xl border bg-card p-3 flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
                                onClick={() => setEditingBatteryRef(ref)}
                              >
                                <div className="shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
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
                                    <Battery className="h-6 w-6 text-muted-foreground" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{ref.name}</div>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-muted-foreground">
                                    <span>€{ref.costEur}</span>
                                    <span>|</span>
                                    <span>{ref.capacityKwh} kWh</span>
                                    <span>|</span>
                                    <span>{ref.powerChargeKw} / {ref.powerDischargeKw} kW</span>
                                    <span>|</span>
                                    <span>{ref.roundTripEfficiencyPercent} %</span>
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
                                    checked={ref.visible === true}
                                    onCheckedChange={async (checked) => {
                                      const visibleCount = batteryReferences.filter((r) => r.visible === true).length;
                                      if (!checked && visibleCount === 1 && ref.visible === true) return; // garder au moins un visible
                                      if (!userId) return;
                                      const updatedRef = { ...ref, visible: checked };
                                      const nextList = batteryReferences.map((r) => (r.id === ref.id ? updatedRef : r));
                                      mutateBatteries(nextList, { revalidate: false });
                                      try {
                                        await saveBatteryReferenceToFirebase(updatedRef, userId);
                                      } catch (e) {
                                        mutateBatteries();
                                      }
                                    }}
                                    size="sm"
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
