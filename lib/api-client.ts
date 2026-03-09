"use client";

import { auth } from "./firebase";

/**
 * Effectue un fetch avec le token Firebase dans l'en-tête Authorization.
 * Requis pour les routes API qui vérifient les quotas (BDNB, OSM).
 */
export async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
  let token: string | null = null;
  if (typeof window !== "undefined" && auth.currentUser) {
    token = await auth.currentUser.getIdToken();
  }
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}
