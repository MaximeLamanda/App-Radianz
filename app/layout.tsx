import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SWRConfig } from "swr";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ConditionalAppSidebar } from "@/components/conditional-app-sidebar";
import { AuthProvider } from "@/lib/auth-context";
import { DrawerProvider } from "@/lib/drawer-context";
import { DrawerWrapper } from "@/components/drawer-wrapper";
import { DesignThemeProvider } from "@/components/design-theme-provider";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Radianz - Plateforme de gestion de leads solaires",
  description: "Plateforme de capture et gestion de leads pour installations solaires",
  icons: {
    icon: "/logo-radianz.svg",
    apple: "/logo-radianz.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="bg-transparent h-svh overflow-hidden" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased bg-transparent h-svh overflow-hidden`}
        suppressHydrationWarning
      >
        <AuthProvider>
          <SWRConfig value={{ dedupingInterval: 2000, revalidateOnFocus: false }}>
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
                  <ConditionalAppSidebar />
                  <DrawerWrapper>{children}</DrawerWrapper>
                </SidebarProvider>
              </DrawerProvider>
            </DesignThemeProvider>
          </SWRConfig>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
