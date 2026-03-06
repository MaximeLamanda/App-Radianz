"use client";

import { useEffect } from "react";
import {
  getStoredDesignTokens,
  applyDesignTokensToDocument,
  removeDesignTokensFromDocument,
} from "@/lib/design-tokens";

/**
 * Applique les tokens de design sauvegardés (page /design) sur tout le site.
 * À placer dans le layout racine.
 */
export function DesignThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const tokens = getStoredDesignTokens();
    if (tokens) {
      applyDesignTokensToDocument(tokens);
      return () => removeDesignTokensFromDocument();
    }
  }, []);

  return <>{children}</>;
}
