"use client";

import { usePathname, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProspectByShareToken, useUserProfile } from "@/lib/swr-hooks";
import { AppSidebar } from "@/components/app-sidebar";

export function ConditionalAppSidebar() {
  const pathname = usePathname();
  const params = useParams();
  const { user } = useAuth();
  const { data: profile } = useUserProfile(user?.uid ?? null);

  const isSharePage = pathname?.startsWith("/p/");
  const shareToken = isSharePage ? (params?.shareToken as string) ?? null : null;
  const { data: prospect } = useProspectByShareToken(shareToken);

  const isOwner = Boolean(user && prospect?.userId === user.uid);

  // Masquer la sidebar si non connecté
  if (!user) return null;

  // Masquer la sidebar si onboarding non terminé
  if (!profile?.onboardingCompleted) return null;

  // Sur la page partagée, masquer pour les visiteurs (non propriétaires)
  if (isSharePage && !isOwner) return null;

  return <AppSidebar />;
}
