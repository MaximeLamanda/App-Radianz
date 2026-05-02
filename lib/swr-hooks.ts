"use client";

import useSWR, { type KeyedMutator } from "swr";
import { fetchWithAuth } from "@/lib/api-client";
import {
  getPanelReferencesFromFirebase,
  initializePanelReferencesInFirebase,
} from "@/lib/firestore-panel-references";
import {
  getInverterReferencesFromFirebase,
  initializeInverterReferencesInFirebase,
} from "@/lib/firestore-inverter-references";
import {
  getBatteryReferencesFromFirebase,
  initializeBatteryReferencesInFirebase,
} from "@/lib/firestore-battery-references";
import {
  getPanelReferences,
  getInverterReferences,
  DEFAULT_BATTERY_REFERENCES,
} from "@/lib/solar-settings";
import { getProspectsForPipeline } from "@/lib/firestore";
import { getProspectByShareToken } from "@/lib/firestore";
import { getUserProfile } from "@/lib/firestore-user-profile";
import type { UserProfile } from "@/lib/firestore-user-profile";
import type {
  PanelReference,
  InverterReference,
  BatteryReference,
  Prospect,
  Lead,
} from "@/types";

const SWR_OPTIONS_IMMUTABLE = {
  revalidateIfStale: false,
  dedupingInterval: 5 * 60 * 1000, // 5 minutes
  revalidateOnFocus: false,
};

const SWR_OPTIONS_PIPELINE = {
  dedupingInterval: 2000,
  revalidateOnFocus: false,
};

async function fetchPanelReferences(userId: string): Promise<PanelReference[]> {
  try {
    let refs = await getPanelReferencesFromFirebase(userId);
    if (refs.length === 0) {
      await initializePanelReferencesInFirebase(userId);
      refs = await getPanelReferencesFromFirebase(userId);
    }
    if (refs.length > 0) return refs;
  } catch {
    // Fallback sur localStorage
  }
  return getPanelReferences();
}

async function fetchInverterReferences(userId: string): Promise<InverterReference[]> {
  try {
    let refs = await getInverterReferencesFromFirebase(userId);
    if (refs.length === 0) {
      await initializeInverterReferencesInFirebase(userId);
      refs = await getInverterReferencesFromFirebase(userId);
    }
    if (refs.length > 0) return refs;
  } catch {
    // Fallback sur localStorage
  }
  return getInverterReferences();
}

async function fetchBatteryReferences(userId: string): Promise<BatteryReference[]> {
  try {
    let refs = await getBatteryReferencesFromFirebase(userId);
    if (refs.length === 0) {
      await initializeBatteryReferencesInFirebase(userId);
      refs = await getBatteryReferencesFromFirebase(userId);
    }
    if (refs.length > 0) return refs;
  } catch {
    // Fallback sur références par défaut
  }
  return DEFAULT_BATTERY_REFERENCES;
}

async function fetchLeads(): Promise<Lead[]> {
  const res = await fetchWithAuth("/api/leads?codeInsee=33318");
  if (!res.ok) {
    throw new Error(`Erreur API leads (${res.status})`);
  }
  const data = (await res.json()) as { leads?: Lead[] };
  return (data.leads ?? []).map((lead) => ({
    ...lead,
    createdAt: new Date(lead.createdAt),
  }));
}

export function usePanelReferences(userId: string | null): {
  data: PanelReference[] | undefined;
  error: Error | undefined;
  isLoading: boolean;
  mutate: KeyedMutator<PanelReference[]>;
} {
  const { data, error, isLoading, mutate } = useSWR(
    userId ? ["panel-references", userId] : null,
    () => fetchPanelReferences(userId!),
    SWR_OPTIONS_IMMUTABLE
  );
  return { data, error, isLoading, mutate };
}

/** Alias pour charger les refs d'un utilisateur donné (ex. propriétaire du prospect sur la page partagée) */
export const usePanelReferencesForUser = usePanelReferences;

export function useInverterReferences(userId: string | null): {
  data: InverterReference[] | undefined;
  error: Error | undefined;
  isLoading: boolean;
  mutate: KeyedMutator<InverterReference[]>;
} {
  const { data, error, isLoading, mutate } = useSWR(
    userId ? ["inverter-references", userId] : null,
    () => fetchInverterReferences(userId!),
    SWR_OPTIONS_IMMUTABLE
  );
  return { data, error, isLoading, mutate };
}

/** Alias pour charger les refs d'un utilisateur donné (ex. propriétaire du prospect sur la page partagée) */
export const useInverterReferencesForUser = useInverterReferences;

export function useBatteryReferences(userId: string | null): {
  data: BatteryReference[] | undefined;
  error: Error | undefined;
  isLoading: boolean;
  mutate: KeyedMutator<BatteryReference[]>;
} {
  const { data, error, isLoading, mutate } = useSWR(
    userId ? ["battery-references", userId] : null,
    () => fetchBatteryReferences(userId!),
    SWR_OPTIONS_IMMUTABLE
  );
  return { data, error, isLoading, mutate };
}

/** Alias pour charger les refs batterie d'un utilisateur donné */
export const useBatteryReferencesForUser = useBatteryReferences;

export function useUserProfile(userId: string | null): {
  data: UserProfile | null | undefined;
  error: Error | undefined;
  isLoading: boolean;
  mutate: KeyedMutator<UserProfile | null>;
} {
  const { data, error, isLoading, mutate } = useSWR(
    userId ? ["user-profile", userId] : null,
    () => getUserProfile(userId!),
    { dedupingInterval: 5000, revalidateOnFocus: false }
  );
  return { data: data ?? null, error, isLoading, mutate };
}

export function useProspectsForPipeline(userId: string | null): {
  data: Prospect[] | undefined;
  error: Error | undefined;
  isLoading: boolean;
  mutate: KeyedMutator<Prospect[]>;
} {
  const { data, error, isLoading, mutate } = useSWR(
    userId ? ["pipeline-prospects", userId] : null,
    () => getProspectsForPipeline(userId!),
    SWR_OPTIONS_PIPELINE
  );
  return { data, error, isLoading, mutate };
}

export function useLeads(): {
  data: Lead[] | undefined;
  error: Error | undefined;
  isLoading: boolean;
  mutate: KeyedMutator<Lead[]>;
} {
  const { data, error, isLoading, mutate } = useSWR(
    "leads",
    fetchLeads,
    SWR_OPTIONS_PIPELINE
  );
  return { data, error, isLoading, mutate };
}

export function useProspectByShareToken(shareToken: string | null): {
  data: Prospect | null | undefined;
  error: Error | undefined;
  isLoading: boolean;
  mutate: KeyedMutator<Prospect | null>;
} {
  const { data, error, isLoading, mutate } = useSWR(
    shareToken ? ["prospect-share", shareToken] : null,
    () => getProspectByShareToken(shareToken!),
    SWR_OPTIONS_PIPELINE
  );
  return { data, error, isLoading, mutate };
}

/** Bâtiment BDNB pour affichage des tuiles sur la carte */
export interface BdnbBatimentTile {
  id: string;
  anneeConstruction: number | null;
  surfaceM2: number | null;
  polygonSurfaces: Array<{
    polygon: Array<{ lat: number; lng: number }>;
    areaM2: number;
    orientation: number | null;
  }>;
  totalAreaM2: number;
}

export interface MapBounds {
  ne: { lat: number; lng: number };
  sw: { lat: number; lng: number };
}

const SWR_OPTIONS_BDNB = {
  revalidateIfStale: false,
  dedupingInterval: 5 * 60 * 1000, // 5 min
  revalidateOnFocus: false,
};

/** Options OSM : keepPreviousData évite le flash (polygones qui disparaissent) pendant le fetch. */
const SWR_OPTIONS_OSM = {
  ...SWR_OPTIONS_BDNB,
  keepPreviousData: true,
};

const BDNB_TILE_SIZE = 0.005; // ~500 m en France
const BDNB_TILE_BUFFER = 0.0002; // ~20 m : marge pour inclure bâtiments sur les bords
const MAX_BDNB_TILES = 48; // Augmenté de 32 → 48 pour afficher plus de bâtiments bleus dans la vue

/** Retourne les indices (i,j) des tuiles qui couvrent la bbox. Limité à 32 tuiles. */
function getTileIndicesForBounds(bounds: MapBounds): Array<{ i: number; j: number }> {
  const { sw, ne } = bounds;
  const iMin = Math.floor(sw.lat / BDNB_TILE_SIZE);
  const iMax = Math.floor(ne.lat / BDNB_TILE_SIZE);
  const jMin = Math.floor(sw.lng / BDNB_TILE_SIZE);
  const jMax = Math.floor(ne.lng / BDNB_TILE_SIZE);

  const tiles: Array<{ i: number; j: number }> = [];
  for (let i = iMin; i <= iMax && tiles.length < MAX_BDNB_TILES; i++) {
    for (let j = jMin; j <= jMax && tiles.length < MAX_BDNB_TILES; j++) {
      tiles.push({ i, j });
    }
  }
  const totalPossible = (iMax - iMin + 1) * (jMax - jMin + 1);
  if (tiles.length < totalPossible) {
    console.log("[BDNB] Limite tuiles atteinte:", {
      demandees: tiles.length,
      totalVue: totalPossible,
      manquantes: totalPossible - tiles.length,
    });
  }
  return tiles;
}

async function fetchBdnbTile(i: number, j: number): Promise<BdnbBatimentTile[]> {
  const swLat = i * BDNB_TILE_SIZE - BDNB_TILE_BUFFER;
  const swLng = j * BDNB_TILE_SIZE - BDNB_TILE_BUFFER;
  const neLat = (i + 1) * BDNB_TILE_SIZE + BDNB_TILE_BUFFER;
  const neLng = (j + 1) * BDNB_TILE_SIZE + BDNB_TILE_BUFFER;
  const params = new URLSearchParams({
    swLat: String(swLat),
    swLng: String(swLng),
    neLat: String(neLat),
    neLng: String(neLng),
  });
  const res = await fetchWithAuth(`/api/bdnb?${params.toString()}`);
  if (res.status === 403) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message ?? `BDNB quota atteint`);
  }
  if (!res.ok) throw new Error(`BDNB tile ${res.status}`);
  const data = await res.json();
  return data.batiments ?? [];
}

function createBdnbFetcher() {
  return async (k: [string, number, number]) => {
    return fetchBdnbTile(k[1], k[2]);
  };
}

/** Bâtiment OSM pour affichage sur la carte (compatible polygone BDNB) */
export interface OsmBuildingDisplay {
  id: string;
  polygonSurfaces: Array<{
    polygon: Array<{ lat: number; lng: number }>;
    areaM2: number;
    orientation: number | null;
  }>;
}

/** Quantification 2 décimales (~1,1 km) : une requête par zone, cache efficace, pas de refetch à chaque pan */
const quantizeOsm = (n: number) => Math.round(n * 1e2) / 1e2;

async function fetchOsmBuildings(bounds: MapBounds): Promise<OsmBuildingDisplay[]> {
  const params = new URLSearchParams({
    swLat: String(bounds.sw.lat),
    swLng: String(bounds.sw.lng),
    neLat: String(bounds.ne.lat),
    neLng: String(bounds.ne.lng),
  });
  const res = await fetchWithAuth(`/api/osm-buildings?${params.toString()}`);
  if (res.status === 403) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.message ?? `OSM quota atteint`);
  }
  if (!res.ok) throw new Error(`OSM Overpass ${res.status}`);
  const data = await res.json();
  return data.buildings ?? [];
}

function areBoundsValid(b: MapBounds): boolean {
  const { sw, ne } = b;
  return (
    typeof sw?.lat === "number" &&
    typeof sw?.lng === "number" &&
    typeof ne?.lat === "number" &&
    typeof ne?.lng === "number" &&
    Number.isFinite(sw.lat) &&
    Number.isFinite(sw.lng) &&
    Number.isFinite(ne.lat) &&
    Number.isFinite(ne.lng)
  );
}

/** Bâtiments OSM via Overpass : une requête par viewport + keepPreviousData */
export function useOsmBuildings(bounds: MapBounds | null): {
  data: OsmBuildingDisplay[] | undefined;
  error: Error | undefined;
  isLoading: boolean;
  mutate: KeyedMutator<OsmBuildingDisplay[]>;
} {
  const safeBounds = bounds && areBoundsValid(bounds) ? bounds : null;
  const key = safeBounds
    ? (["osm-buildings", quantizeOsm(safeBounds.sw.lat), quantizeOsm(safeBounds.sw.lng), quantizeOsm(safeBounds.ne.lat), quantizeOsm(safeBounds.ne.lng)] as const)
    : null;
  const { data, error, isLoading, mutate } = useSWR(
    key,
    () => fetchOsmBuildings(safeBounds!),
    SWR_OPTIONS_OSM
  );
  return {
    data: safeBounds ? data : undefined,
    error,
    isLoading: !!isLoading,
    mutate,
  };
}

/** Bâtiments BDNB par grille de tuiles (cache par tuile, pas de refetch pour les tuiles déjà chargées) */
export function useBdnbTiles(bounds: MapBounds | null, userId: string | null = null): {
  data: BdnbBatimentTile[] | undefined;
  error: Error | undefined;
  isLoading: boolean;
  mutate: KeyedMutator<BdnbBatimentTile[]>;
} {
  const tileIndices = bounds ? getTileIndicesForBounds(bounds) : [];
  const keys: ([string, number, number] | null)[] = Array.from({ length: MAX_BDNB_TILES }, (_, n) =>
    tileIndices[n] ? (["bdnb-tile", tileIndices[n]!.i, tileIndices[n]!.j] as [string, number, number]) : null
  );

  const fetcher = createBdnbFetcher();

  const r0 = useSWR(keys[0], fetcher, SWR_OPTIONS_BDNB);
  const r1 = useSWR(keys[1], fetcher, SWR_OPTIONS_BDNB);
  const r2 = useSWR(keys[2], fetcher, SWR_OPTIONS_BDNB);
  const r3 = useSWR(keys[3], fetcher, SWR_OPTIONS_BDNB);
  const r4 = useSWR(keys[4], fetcher, SWR_OPTIONS_BDNB);
  const r5 = useSWR(keys[5], fetcher, SWR_OPTIONS_BDNB);
  const r6 = useSWR(keys[6], fetcher, SWR_OPTIONS_BDNB);
  const r7 = useSWR(keys[7], fetcher, SWR_OPTIONS_BDNB);
  const r8 = useSWR(keys[8], fetcher, SWR_OPTIONS_BDNB);
  const r9 = useSWR(keys[9], fetcher, SWR_OPTIONS_BDNB);
  const r10 = useSWR(keys[10], fetcher, SWR_OPTIONS_BDNB);
  const r11 = useSWR(keys[11], fetcher, SWR_OPTIONS_BDNB);
  const r12 = useSWR(keys[12], fetcher, SWR_OPTIONS_BDNB);
  const r13 = useSWR(keys[13], fetcher, SWR_OPTIONS_BDNB);
  const r14 = useSWR(keys[14], fetcher, SWR_OPTIONS_BDNB);
  const r15 = useSWR(keys[15], fetcher, SWR_OPTIONS_BDNB);
  const r16 = useSWR(keys[16], fetcher, SWR_OPTIONS_BDNB);
  const r17 = useSWR(keys[17], fetcher, SWR_OPTIONS_BDNB);
  const r18 = useSWR(keys[18], fetcher, SWR_OPTIONS_BDNB);
  const r19 = useSWR(keys[19], fetcher, SWR_OPTIONS_BDNB);
  const r20 = useSWR(keys[20], fetcher, SWR_OPTIONS_BDNB);
  const r21 = useSWR(keys[21], fetcher, SWR_OPTIONS_BDNB);
  const r22 = useSWR(keys[22], fetcher, SWR_OPTIONS_BDNB);
  const r23 = useSWR(keys[23], fetcher, SWR_OPTIONS_BDNB);
  const r24 = useSWR(keys[24], fetcher, SWR_OPTIONS_BDNB);
  const r25 = useSWR(keys[25], fetcher, SWR_OPTIONS_BDNB);
  const r26 = useSWR(keys[26], fetcher, SWR_OPTIONS_BDNB);
  const r27 = useSWR(keys[27], fetcher, SWR_OPTIONS_BDNB);
  const r28 = useSWR(keys[28], fetcher, SWR_OPTIONS_BDNB);
  const r29 = useSWR(keys[29], fetcher, SWR_OPTIONS_BDNB);
  const r30 = useSWR(keys[30], fetcher, SWR_OPTIONS_BDNB);
  const r31 = useSWR(keys[31], fetcher, SWR_OPTIONS_BDNB);
  const r32 = useSWR(keys[32], fetcher, SWR_OPTIONS_BDNB);
  const r33 = useSWR(keys[33], fetcher, SWR_OPTIONS_BDNB);
  const r34 = useSWR(keys[34], fetcher, SWR_OPTIONS_BDNB);
  const r35 = useSWR(keys[35], fetcher, SWR_OPTIONS_BDNB);
  const r36 = useSWR(keys[36], fetcher, SWR_OPTIONS_BDNB);
  const r37 = useSWR(keys[37], fetcher, SWR_OPTIONS_BDNB);
  const r38 = useSWR(keys[38], fetcher, SWR_OPTIONS_BDNB);
  const r39 = useSWR(keys[39], fetcher, SWR_OPTIONS_BDNB);
  const r40 = useSWR(keys[40], fetcher, SWR_OPTIONS_BDNB);
  const r41 = useSWR(keys[41], fetcher, SWR_OPTIONS_BDNB);
  const r42 = useSWR(keys[42], fetcher, SWR_OPTIONS_BDNB);
  const r43 = useSWR(keys[43], fetcher, SWR_OPTIONS_BDNB);
  const r44 = useSWR(keys[44], fetcher, SWR_OPTIONS_BDNB);
  const r45 = useSWR(keys[45], fetcher, SWR_OPTIONS_BDNB);
  const r46 = useSWR(keys[46], fetcher, SWR_OPTIONS_BDNB);
  const r47 = useSWR(keys[47], fetcher, SWR_OPTIONS_BDNB);

  const results = [r0, r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14, r15, r16, r17, r18, r19, r20, r21, r22, r23, r24, r25, r26, r27, r28, r29, r30, r31, r32, r33, r34, r35, r36, r37, r38, r39, r40, r41, r42, r43, r44, r45, r46, r47];
  const seen = new Map<string, BdnbBatimentTile>();
  for (const { data } of results) {
    if (data) for (const b of data) seen.set(b.id, b);
  }
  const merged = Array.from(seen.values());
  const tuilesAvecDonnees = results.filter((r) => r.data && r.data.length > 0).length;
  if (bounds && tileIndices.length > 0) {
    console.log("[BDNB] Stats:", {
      tuiles: tileIndices.length,
      tuilesAvecDonnees,
      totalBatiments: merged.length,
    });
  }
  const isLoading = results.some((r) => r.isLoading);
  const firstError = results.find((r) => r.error)?.error;

  const mutateAll: KeyedMutator<BdnbBatimentTile[]> = async () => {
    await Promise.all(results.map((r) => r.mutate()));
    return merged;
  };

  return {
    data: bounds ? merged : undefined,
    error: firstError,
    isLoading,
    mutate: mutateAll,
  };
}
