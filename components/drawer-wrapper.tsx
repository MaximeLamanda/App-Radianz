"use client";

import { ReactNode } from "react";
import { SidebarInset } from "@/components/ui/sidebar";
import { useDrawer } from "@/lib/drawer-context";

export function DrawerWrapper({ children }: { children: ReactNode }) {
  const { isDrawerOpen, drawerContent } = useDrawer();
  
  return (
    <>
      <SidebarInset>
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
          {children}
        </div>
      </SidebarInset>
      
      {/* Drawer fixe qui se translate depuis la droite (comme la sidebar) */}
      {drawerContent && (
        <div
          className={`fixed inset-y-0 z-10 h-svh w-[440px] transition-[right] duration-300 ease-in-out flex items-stretch ${
            isDrawerOpen ? 'right-0' : 'right-[calc(440px*-1)]'
          }`}
        >
          <div className="flex-1 min-w-0 mr-5 my-5 flex">
            {drawerContent}
          </div>
        </div>
      )}
    </>
  );
}
