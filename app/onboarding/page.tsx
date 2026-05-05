"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { useUserProfile } from "@/lib/swr-hooks";
import { setUserProfile } from "@/lib/firestore-user-profile";
import { OnboardingScreen } from "@/components/onboarding/OnboardingScreen";
import { OnboardingWelcomeStep } from "@/components/onboarding/OnboardingWelcomeStep";
import { OnboardingStep1Form } from "@/components/onboarding/OnboardingStep1Form";
import { OnboardingStep2Form } from "@/components/onboarding/OnboardingStep2Form";
import { OnboardingStep3Form } from "@/components/onboarding/OnboardingStep3Form";
import type { UserProfile } from "@/lib/firestore-user-profile";

const STEPS = [
  {
    title: "Bienvenue sur Radianz",
    text: "Quelques étapes pour aligner les simulations avec votre activité — puis vous accédez à la carte et aux analyses.",
  },
  {
    title: "En quelques mots",
    text: "",
  },
  {
    title: "Taille et zone d'activité",
    text: "",
  },
  {
    title: "Matériel pour la simulation",
    text: "",
  },
  {
    title: "Prêt à démarrer l'analyse",
    text: "Recherchez des bâtiments par type (entrepôts, supermarchés, etc.) et analysez leur potentiel solaire sur la carte satellite.",
  },
];

const TOTAL_STEPS = 5;

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { data: profile, isLoading: profileLoading } = useUserProfile(user?.uid ?? null);
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Partial<UserProfile>>({});
  const [liveStep2GeoZones, setLiveStep2GeoZones] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    // TODO: réactiver après modif design — if (profile?.onboardingCompleted) router.replace("/");
  }, [authLoading, user, router]);

  const handleSaveAndFinish = async () => {
    if (!user) return;
    setIsSubmitting(true);
    try {
      await setUserProfile(user.uid, {
        ...formData,
        onboardingCompleted: true,
      });
      router.replace("/");
      router.refresh();
    } catch (err) {
      console.error("Erreur lors de la sauvegarde:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS) setStep(step + 1);
    else handleSaveAndFinish();
  };

  const step1InitialValues = useMemo(() => {
    const fromProfile = profile ?? {};
    const merged: Partial<UserProfile> = { ...fromProfile };
    if (user?.displayName && !merged.firstName && !merged.lastName) {
      const parts = user.displayName.trim().split(/\s+/);
      merged.firstName = parts[0] ?? "";
      merged.lastName = parts.slice(1).join(" ") ?? "";
    }
    return merged;
  }, [user?.displayName, profile]);

  if (authLoading || (user && profileLoading && profile === undefined)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-4 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Image
            src="/logo-radianz.svg"
            alt="Radianz"
            width={120}
            height={40}
            className="h-8 w-auto object-contain"
          />
        </div>
      </header>

      <main className="mx-auto max-w-6xl">
        {step === 1 ? (
          <OnboardingScreen
            key={1}
            step={1}
            total={TOTAL_STEPS}
            title={STEPS[0].title}
            text={STEPS[0].text}
            onNext={() => setStep(2)}
            contentMinHeightClassName="min-h-[600px]"
          >
            <OnboardingWelcomeStep />
          </OnboardingScreen>
        ) : step === 2 ? (
          <OnboardingScreen
            key={2}
            step={2}
            total={TOTAL_STEPS}
            title={STEPS[1].title}
            text={STEPS[1].text}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
            formId="onboarding-step-1"
            isSubmitting={isSubmitting}
          >
            <OnboardingStep1Form
              formId="onboarding-step-1"
              userId={user.uid}
              user={user}
              initialValues={step1InitialValues}
              onSubmit={async (data) => {
                const next = { ...formData, ...data };
                setFormData(next);
                setIsSubmitting(true);
                try {
                  await setUserProfile(user.uid, next);
                  setStep(3);
                } catch (err) {
                  console.error("Erreur lors de la sauvegarde:", err);
                } finally {
                  setIsSubmitting(false);
                }
              }}
              isSubmitting={isSubmitting}
            />
          </OnboardingScreen>
        ) : step === 3 ? (
          <OnboardingScreen
            key={3}
            step={3}
            total={TOTAL_STEPS}
            title={STEPS[2].title}
            text={STEPS[2].text}
            onNext={() => setStep(4)}
            onBack={() => setStep(2)}
            formId="onboarding-step-2"
            isSubmitting={isSubmitting}
            contentMinHeightClassName="min-h-[min(90vh,960px)]"
          >
            <OnboardingStep2Form
              formId="onboarding-step-2"
              userId={user.uid}
              initialValues={{ ...profile, ...formData }}
              onGeoZonesChange={setLiveStep2GeoZones}
              onSubmit={async (data) => {
                const next = { ...formData, ...data };
                setFormData(next);
                setIsSubmitting(true);
                try {
                  await setUserProfile(user.uid, next);
                  setStep(4);
                } catch (err) {
                  console.error("Erreur lors de la sauvegarde:", err);
                } finally {
                  setIsSubmitting(false);
                }
              }}
              isSubmitting={isSubmitting}
            />
          </OnboardingScreen>
        ) : step === 4 ? (
          <OnboardingScreen
            key={4}
            step={4}
            total={TOTAL_STEPS}
            title={STEPS[3].title}
            text={STEPS[3].text}
            onNext={() => setStep(5)}
            onBack={() => setStep(3)}
            formId="onboarding-step-3"
            isSubmitting={isSubmitting}
            contentMinHeightClassName="min-h-[640px]"
          >
            <OnboardingStep3Form
              formId="onboarding-step-3"
              userId={user.uid}
              initialValues={{ ...profile, ...formData }}
              onSubmit={async (data) => {
                const next = { ...formData, ...data };
                setFormData(next);
                setIsSubmitting(true);
                try {
                  await setUserProfile(user.uid, next);
                  setStep(5);
                } catch (err) {
                  console.error("Erreur lors de la sauvegarde:", err);
                } finally {
                  setIsSubmitting(false);
                }
              }}
              isSubmitting={isSubmitting}
            />
          </OnboardingScreen>
        ) : (
          <OnboardingScreen
            key={5}
            step={5}
            total={TOTAL_STEPS}
            title={STEPS[4].title}
            text={STEPS[4].text}
            onNext={handleNext}
            onBack={() => setStep(4)}
            nextLabel="Accéder à Radianz"
          />
        )}
      </main>
    </div>
  );
}
