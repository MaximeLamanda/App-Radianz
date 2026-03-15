"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { updateProfile } from "firebase/auth";
import { storage } from "@/lib/firebase";
import type { UserProfile } from "@/lib/firestore-user-profile";
import { ImagePlus, Loader2 } from "lucide-react";
import type { User } from "firebase/auth";

export interface OnboardingStep1LiveData {
  firstName: string;
  lastName: string;
  phone: string;
  profilePhotoUrl: string;
  companyLogoUrl: string;
  companyName: string;
}

interface OnboardingStep1FormProps {
  formId: string;
  userId: string;
  user: User | null;
  initialValues?: Partial<UserProfile> | null;
  onSubmit: (data: Partial<UserProfile>) => void;
  onChange?: (data: OnboardingStep1LiveData) => void;
  isSubmitting?: boolean;
}

export function OnboardingStep1Form({
  formId,
  userId,
  user,
  initialValues,
  onSubmit,
  onChange,
  isSubmitting = false,
}: OnboardingStep1FormProps) {
  const [firstName, setFirstName] = useState(initialValues?.firstName ?? "");
  const [lastName, setLastName] = useState(initialValues?.lastName ?? "");
  const [phone, setPhone] = useState(initialValues?.phone ?? "");
  const [companyName, setCompanyName] = useState(initialValues?.companyName ?? "");
  const [companyLogoUrl, setCompanyLogoUrl] = useState(initialValues?.companyLogoUrl ?? "");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(user?.photoURL ?? "");
  const [logoUploading, setLogoUploading] = useState(false);
  const [profilePhotoUploading, setProfilePhotoUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);

  const uploadProfilePhoto = async (file: File) => {
    if (!file.type.startsWith("image/") || !user) return;
    setProfilePhotoUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `user_photos/${userId}/avatar.${ext}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setProfilePhotoUrl(url);
      await updateProfile(user, { photoURL: url });
    } finally {
      setProfilePhotoUploading(false);
    }
  };

  useEffect(() => {
    onChange?.({
      firstName,
      lastName,
      phone,
      profilePhotoUrl,
      companyLogoUrl,
      companyName,
    });
  }, [firstName, lastName, phone, profilePhotoUrl, companyLogoUrl, companyName, onChange]);

  const uploadLogo = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setLogoUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `users/${userId}/company-logo.${ext}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setCompanyLogoUrl(url);
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      phone: phone.trim() || undefined,
      companyName: companyName.trim() || undefined,
      companyLogoUrl: companyLogoUrl || undefined,
    });
  };

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label>Photo de profil</Label>
        <div className="flex items-center gap-4">
          <input
            ref={profilePhotoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadProfilePhoto(file);
              e.target.value = "";
            }}
          />
          {profilePhotoUrl ? (
            <div className="relative">
              <img
                src={profilePhotoUrl}
                alt="Photo de profil"
                className="h-20 w-20 rounded-full border object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute -right-1 -top-1 h-6 w-6 rounded-full"
                onClick={() => profilePhotoInputRef.current?.click()}
                disabled={profilePhotoUploading}
                aria-label="Modifier la photo de profil"
              >
                {profilePhotoUploading ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <ImagePlus className="size-3" />
                )}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => profilePhotoInputRef.current?.click()}
              disabled={profilePhotoUploading}
            >
              {profilePhotoUploading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <ImagePlus className="mr-2 size-4" />
              )}
              Ajouter une photo
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">Prénom</Label>
          <Input
            id="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Jean"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Nom</Label>
          <Input
            id="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Dupont"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Téléphone</Label>
        <Input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+33 6 12 34 56 78"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="companyName">Entreprise</Label>
          <Input
            id="companyName"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Mon entreprise solaire"
          />
        </div>
        <div className="space-y-2">
          <Label>Logo entreprise</Label>
          <div className="flex items-center gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadLogo(file);
              e.target.value = "";
            }}
          />
          {companyLogoUrl ? (
            <div className="relative">
              <img
                src={companyLogoUrl}
                alt="Logo"
                className="h-16 w-16 rounded-lg border object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute -right-2 -top-2 h-6 w-6"
                onClick={() => fileInputRef.current?.click()}
                disabled={logoUploading}
                aria-label="Modifier le logo"
              >
                {logoUploading ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <ImagePlus className="size-3" />
                )}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={logoUploading}
            >
              {logoUploading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <ImagePlus className="mr-2 size-4" />
              )}
              Ajouter un logo
            </Button>
          )}
        </div>
        </div>
      </div>
    </form>
  );
}
