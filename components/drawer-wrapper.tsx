"use client";

import { ReactNode } from "react";
import { SidebarInset } from "@/components/ui/sidebar";
import { useDrawer } from "@/lib/drawer-context";

export function DrawerWrapper({ children }: { children: ReactNode }) {
  const { isDrawerOpen, drawerContent } = useDrawer();
  
  return (
    <>
      <SidebarInset className="min-w-0 min-h-0 flex-1 flex flex-col overflow-hidden">
        {/* flex-col + min-h-0 : les pages « carte pleine » (flex-1 sur l’enfant) peuvent occuper la hauteur utile */}
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
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
          <div className="flex-1 min-w-0 mr-5 my-5 flex overflow-hidden rounded-2xl bg-white">
            {drawerContent}
          </div>
        </div>
      )}
    </>
  );
}
