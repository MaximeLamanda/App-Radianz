import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider } from "@/lib/auth-context";
import { DrawerProvider } from "@/lib/drawer-context";
import { DrawerWrapper } from "@/components/drawer-wrapper";
import { DesignThemeProvider } from "@/components/design-theme-provider";
import { Toaster } from "@/components/ui/sonner";


export const metadata: Metadata = {
  title: "Radianz - Plateforme de gestion de leads solaires",
  description: "Plateforme de capture et gestion de leads pour installations solaires",
  icons: {
    icon: "/logo-radianz.png",
    apple: "/logo-radianz.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="bg-transparent h-screen overflow-hidden" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased bg-transparent h-screen overflow-hidden`} suppressHydrationWarning>
        <AuthProvider>
        <DesignThemeProvider>
        <DrawerProvider>
          <SidebarProvider 
            defaultOpen={false}
            style={
              {
                "--sidebar-width": "19rem",
              } as React.CSSProperties
            }
          >
            <AppSidebar />
            <DrawerWrapper>{children}</DrawerWrapper>
          </SidebarProvider>
        </DrawerProvider>
        </DesignThemeProvider>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
