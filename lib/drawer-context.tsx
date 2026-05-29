"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

export type DiscoveryDrawerMainTab = "batiments" | "solaire" | "terrain" | "lectures";

interface DrawerContextType {
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  drawerContent: React.ReactNode | null;
  setDrawerContent: (content: React.ReactNode | null) => void;
  /** Onglet actif du drawer Découverte — survit au remount via `setDrawerContent`. */
  discoveryDrawerTab: DiscoveryDrawerMainTab;
  setDiscoveryDrawerTab: (tab: DiscoveryDrawerMainTab) => void;
}

const DrawerContext = createContext<DrawerContextType | undefined>(undefined);

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerContent, setDrawerContent] = useState<React.ReactNode | null>(null);
  const [discoveryDrawerTab, setDiscoveryDrawerTab] =
    useState<DiscoveryDrawerMainTab>("batiments");

  const value = useMemo(
    () => ({
      isDrawerOpen,
      setIsDrawerOpen,
      drawerContent,
      setDrawerContent,
      discoveryDrawerTab,
      setDiscoveryDrawerTab,
    }),
    [isDrawerOpen, drawerContent, discoveryDrawerTab]
  );

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

export function useDrawer() {
  const context = useContext(DrawerContext);
  if (!context) {
    throw new Error("useDrawer must be used within DrawerProvider");
  }
  return context;
}
