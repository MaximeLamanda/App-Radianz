"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

interface DrawerContextType {
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  drawerContent: React.ReactNode | null;
  setDrawerContent: (content: React.ReactNode | null) => void;
}

const DrawerContext = createContext<DrawerContextType | undefined>(undefined);

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerContent, setDrawerContent] = useState<React.ReactNode | null>(null);

  const value = useMemo(
    () => ({
      isDrawerOpen,
      setIsDrawerOpen,
      drawerContent,
      setDrawerContent,
    }),
    [isDrawerOpen, drawerContent]
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
