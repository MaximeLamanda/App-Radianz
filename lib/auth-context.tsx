"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "./firebase";
import { claimUnclaimedProspects } from "./firestore";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  claimedCount: number | null;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  claimedCount: null,
});

const CLAIM_DONE_KEY = "app.radianz-claim-done";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimedCount, setClaimedCount] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u ?? null);
      if (u) {
        try {
          const alreadyClaimed = typeof window !== "undefined" && sessionStorage.getItem(CLAIM_DONE_KEY) === "true";
          if (!alreadyClaimed) {
            const count = await claimUnclaimedProspects(u.uid);
            setClaimedCount(count);
            if (typeof window !== "undefined" && count > 0) {
              sessionStorage.setItem(CLAIM_DONE_KEY, "true");
            }
          }
        } catch (err) {
          console.error("Erreur claim prospects:", err);
        }
      } else {
        setClaimedCount(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, claimedCount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
