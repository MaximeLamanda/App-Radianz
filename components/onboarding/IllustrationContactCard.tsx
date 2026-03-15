"use client";

import { User, Phone, Mail, Building2 } from "lucide-react";

interface IllustrationContactCardProps {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  photoUrl?: string;
  companyLogoUrl?: string;
  companyName?: string;
}

export function IllustrationContactCard({
  firstName = "",
  lastName = "",
  phone = "",
  email = "",
  photoUrl,
  companyLogoUrl,
  companyName = "",
}: IllustrationContactCardProps = {}) {
  const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || "Votre nom";
  const displayEmail = email.trim() || "email@exemple.fr";
  const displayPhone = phone.trim() || "—";
  const displayCompanyName = companyName.trim() || "Mon entreprise";

  return (
    <div className="min-h-[280px] overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 lg:min-h-[360px]">
      {/* Bordure type portail partageable */}
      <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-red-400" />
          <span className="size-2 rounded-full bg-amber-400" />
          <span className="size-2 rounded-full bg-emerald-400" />
        </div>
      </div>
      {/* Contenu : aperçu de la page prospect (données en direct du formulaire) */}
      <div className="space-y-4 p-6">
        <div className="relative flex flex-col items-center rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="flex w-full items-center justify-between">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Votre référent
            </p>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Disponible
            </span>
          </div>
          {/* Photo centrée en haut */}
          <div className="relative mt-3 size-24 shrink-0 overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-600">
            {photoUrl ? (
              <img src={photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <User className="size-8 text-zinc-400" />
              </div>
            )}
          </div>
          {/* Texte en dessous */}
          <div className="mt-3 w-full self-stretch flex flex-col gap-1.5 text-center">
            <p className="font-mono text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
              {displayName}
            </p>
            <div className="flex items-center justify-center gap-2">
              <div className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-200 bg-white dark:border-zinc-600 dark:bg-zinc-800">
                {companyLogoUrl ? (
                  <img src={companyLogoUrl} alt="" className="h-full w-full object-contain p-0.5" />
                ) : (
                  <Building2 className="size-3 text-zinc-400" />
                )}
              </div>
              <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400 truncate">
                {displayCompanyName}
              </p>
            </div>
            <div className="mt-2 flex gap-2">
              <div className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-zinc-200 py-1.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                <Phone className="size-3 shrink-0" />
                <span className="font-mono truncate">{displayPhone}</span>
              </div>
              <a
                href={displayEmail && displayEmail !== "email@exemple.fr" ? `mailto:${displayEmail}` : "#"}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-zinc-900 py-1.5 text-[11px] font-medium text-white hover:bg-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              >
                <Mail className="size-3 shrink-0" />
                Email
              </a>
            </div>
          </div>
        </div>
        {/* Légende visuelle : cette card apparaît sur le portail partageable */}
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800/30">
          <div
            className="size-2 rounded-full shrink-0"
            style={{ backgroundColor: "#E4FE55" }}
          />
          <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
            Vos infos seront visibles sur le portail partageable envoyé à vos
            clients
          </p>
        </div>
      </div>
    </div>
  );
}
