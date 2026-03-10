"use client";

import { usePathname, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProspectByShareToken } from "@/lib/swr-hooks";
import { AppSidebar } from "@/components/app-sidebar";

export function ConditionalAppSidebar() {
  const pathname = usePathname();
  const params = useParams();
  const { user } = useAuth();

  const isSharePage = pathname?.startsWith("/p/");
  const shareToken = isSharePage ? (params?.shareToken as string) ?? null : null;
  const { data: prospect } = useProspectByShareToken(shareToken);

  const isOwner = Boolean(user && prospect?.userId === user.uid);

  if (isSharePage && !isOwner) {
    return null;
  }

  return <AppSidebar />;
}
