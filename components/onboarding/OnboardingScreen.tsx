"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressIndicator } from "./ProgressIndicator";

interface OnboardingScreenProps {
  step: number;
  total: number;
  title: string;
  text?: string;
  children?: React.ReactNode;
  onNext: () => void;
  onBack?: () => void;
  nextLabel?: string;
  /** ID du formulaire à soumettre via le bouton Suivant (si fourni, le bouton est type="submit") */
  formId?: string;
  isSubmitting?: boolean;
}

export function OnboardingScreen({
  step,
  total,
  title,
  text,
  children,
  onNext,
  onBack,
  nextLabel,
  formId,
  isSubmitting = false,
}: OnboardingScreenProps) {
  const isLast = step === total;
  const showBack = step > 1 && onBack;
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center">
      <div className="flex w-full max-w-md flex-col justify-center space-y-6 px-4 py-8 lg:px-8">
        <ProgressIndicator current={step} total={total} />
        {title && <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">{title}</h1>}
        {text && <p className="text-muted-foreground">{text}</p>}
        {children}
        <div className="flex flex-wrap items-center gap-3">
          {showBack && (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onBack}
              className="h-11 w-11 shrink-0 rounded-xl bg-muted text-foreground hover:bg-muted/80"
              aria-label="Retour"
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <Button
            type={formId ? "submit" : "button"}
            form={formId}
            onClick={formId ? undefined : onNext}
            disabled={isSubmitting}
            className="w-fit min-w-[140px] gap-2"
          >
            {nextLabel ?? (isLast ? "Accéder à Radianz" : "Suivant")}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
