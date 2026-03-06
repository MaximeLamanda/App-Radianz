"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MapPin, Settings, LogOut, Palette } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { SettingsPopup } from "@/components/solar-scout/SettingsPopup";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const menuItems = [
    {
      title: "Home",
      url: "/",
      icon: Home,
    },
    {
      title: "Solar Scout",
      url: "/solar-scout",
      icon: MapPin,
    },
    {
      title: "Design",
      url: "/design",
      icon: Palette,
    },
  ];

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a
                href="/"
                className="flex items-center gap-2 p-0! min-w-0 pl-8 group-data-[collapsible=icon]:pl-0 bg-[length:32px_32px] bg-left bg-no-repeat group-data-[collapsible=icon]:bg-center"
                style={{ backgroundImage: "url('/logo-radianz.png')" }}
                aria-label="Radianz"
              >
                <div className="grid flex-1 text-left text-sm leading-tight min-w-0 group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-medium">Radianz</span>
                  <span className="truncate text-xs text-muted-foreground">Plateforme solaire</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.url;
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.url}>
                        <Icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setSettingsOpen(true)}
                  tooltip="Paramètres"
                >
                  <Settings />
                  <span>Paramètres</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {user && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => signOut(auth)}
                    tooltip="Déconnexion"
                  >
                    <LogOut />
                    <span>Déconnexion</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SettingsPopup open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Sidebar>
  );
}
