"use client";

import { Suspense, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { MapComponent } from "@/components/solar-scout/MapComponent";
import { Sidebar } from "@/components/solar-scout/Sidebar";
import { ProspectDrawer } from "@/components/solar-scout/ProspectDrawer";
import { GoogleMapsLoader } from "@/components/solar-scout/GoogleMapsLoader";
import { MapErrorBoundary } from "@/components/solar-scout/MapErrorBoundary";
import { surfaceToKwp } from "@/lib/surface-to-kwp";
import { loadProspectSurfaces, saveProspectSurfaces, deleteProspectSurfaces } from "@/lib/prospect-storage";
import { loadMapPosition, saveMapPosition, getDefaultMapPosition } from "@/lib/map-position-storage";
import { getProspectById, updateProspectInPipeline } from "@/lib/firestore";
import { useDrawer } from "@/lib/drawer-context";
import { useAuth } from "@/lib/auth-context";
import { useUserProfile, type MapBounds } from "@/lib/swr-hooks";
import { fetchWithAuth } from "@/lib/api-client";
import { logPolygonDrawer } from "@/lib/debug-polygon-drawer";
import { toast } from "sonner";
import type { Prospect, AddressCoordinates } from "@/types";
import {
  findMatchingV5LinkedParcelleRowsTransitive,
  parseMatchingV5GeoJsonFeatureCollection,
  type ScoutMatchingV5Row,
} from "@/lib/scout-matching-v5-map";

const MATCHING_V5_DEFAULT_CODE_INSEE =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_SCOUT_MATCHING_V5_CODE_INSEE?.trim()) ||
  "33318";

function calculateQualityScore(area: number, placeType: string): number {
  let score = 0;
  if (area > 1000) score += 40;
  else if (area > 500) score += 35;
  else if (area > 200) score += 30;
  else if (area > 100) score += 20;
  else if (area > 0) score += 10;
  const energyIntensiveTypes = ["warehouse", "supermarket", "industrial"];
  if (energyIntensiveTypes.includes(placeType)) {
    score += 30;
  } else if (placeType === "retail" || placeType === "office") {
    score += 20;
  } else {
    score += 10;
  }
  return Math.min(100, score);
}

function SolarScoutContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const discoveryParam = searchParams.get("discovery");
  const discoverySource: "static" | "postgres" = useMemo(() => {
    if (discoveryParam === "db" || discoveryParam === "postgres") return "postgres";
    if (discoveryParam === "static" || discoveryParam === "geojson") return "static";
    return process.env.NEXT_PUBLIC_SCOUT_MATCHING_V5_SOURCE === "postgres" ? "postgres" : "static";
  }, [discoveryParam]);
  const { user, loading: authLoading } = useAuth();
  const { data: userProfile, isLoading: profileLoading } = useUserProfile(user?.uid ?? null);
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const pendingBdnbSurfacesRef = useRef<import("@/types").RoofSurface[] | null>(null);
  const { isDrawerOpen, setIsDrawerOpen, setDrawerContent } = useDrawer();
  const [getMapBoundsFunc, setGetMapBoundsFunc] = useState<
    (() => { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null) | null
  >(null);
  const [matchingV5Rows, setMatchingV5Rows] = useState<ScoutMatchingV5Row[]>([]);
  const [isMatchingV5Loading, setIsMatchingV5Loading] = useState(false);
  const [matchingV5Error, setMatchingV5Error] = useState<string | null>(null);
  const [matchingV5BuildingsError, setMatchingV5BuildingsError] = useState<string | null>(null);
  const [matchingV5SelectedId, setMatchingV5SelectedId] = useState<string | null>(null);
  const [matchingV5FetchKey, setMatchingV5FetchKey] = useState(0);
  const [matchingV5BuildingFeatures, setMatchingV5BuildingFeatures] = useState<GeoJSON.Feature[]>([]);
  const [matchingV5SharedParcelFeatures, setMatchingV5SharedParcelFeatures] = useState<GeoJSON.Feature[]>([]);
  const [matchingV5ViewBounds, setMatchingV5ViewBounds] = useState<MapBounds | null>(null);

  const matchingV5BoundsKey = useMemo(
    () =>
      matchingV5ViewBounds
        ? `${matchingV5ViewBounds.sw.lat},${matchingV5ViewBounds.sw.lng},${matchingV5ViewBounds.ne.lat},${matchingV5ViewBounds.ne.lng}`
        : "",
    [matchingV5ViewBounds]
  );

  useEffect(() => {
    if (discoverySource !== "static") return;
    let cancelled = false;
    setIsMatchingV5Loading(true);
    setMatchingV5Error(null);
    void (async () => {
      try {
        const res = await fetch("/geo/matching-v5-33318.geojson", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setMatchingV5Error(
              res.status === 404
                ? "Fichier absent. Exécutez : npm run pipeline:matching-v5:run"
                : `HTTP ${res.status}`
            );
            setMatchingV5Rows([]);
          }
          return;
        }
        const json: unknown = await res.json();
        if (cancelled) return;
        const { rows, error } = parseMatchingV5GeoJsonFeatureCollection(json);
        if (error) setMatchingV5Error(error);
        else setMatchingV5Error(null);
        setMatchingV5Rows(rows);
      } catch (e) {
        if (!cancelled) {
          setMatchingV5Error(e instanceof Error ? e.message : "Erreur chargement de la couche");
          setMatchingV5Rows([]);
        }
      } finally {
        if (!cancelled) setIsMatchingV5Loading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchingV5FetchKey, discoverySource]);

  useEffect(() => {
    if (discoverySource !== "postgres") return;
    let cancelled = false;
    setIsMatchingV5Loading(true);
    setMatchingV5Error(null);
    void (async () => {
      try {
        const params = new URLSearchParams({
          code_insee: MATCHING_V5_DEFAULT_CODE_INSEE,
          limit: "3000",
        });
        if (matchingV5ViewBounds) {
          params.set("minLat", String(matchingV5ViewBounds.sw.lat));
          params.set("maxLat", String(matchingV5ViewBounds.ne.lat));
          params.set("minLng", String(matchingV5ViewBounds.sw.lng));
          params.set("maxLng", String(matchingV5ViewBounds.ne.lng));
        }
        const res = await fetchWithAuth(`/api/matching-v5/features?${params.toString()}`);
        if (!res.ok) {
          if (!cancelled) {
            setMatchingV5Error(
              res.status === 500
                ? "Erreur serveur lors du chargement discovery (Postgres)."
                : `HTTP ${res.status}`
            );
            setMatchingV5Rows([]);
          }
          return;
        }
        const json: unknown = await res.json();
        if (cancelled) return;
        const { rows, error } = parseMatchingV5GeoJsonFeatureCollection(json);
        if (error) setMatchingV5Error(error);
        else setMatchingV5Error(null);
        setMatchingV5Rows(rows);
      } catch (e) {
        if (!cancelled) {
          setMatchingV5Error(e instanceof Error ? e.message : "Erreur chargement discovery (Postgres)");
          setMatchingV5Rows([]);
        }
      } finally {
        if (!cancelled) setIsMatchingV5Loading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchingV5FetchKey, discoverySource, matchingV5BoundsKey]);

  useEffect(() => {
    if (!matchingV5SelectedId) return;
    if (!matchingV5Rows.some((r) => r.id === matchingV5SelectedId)) {
      setMatchingV5SelectedId(null);
    }
  }, [matchingV5Rows, matchingV5SelectedId]);

  const matchingV5SelectedGroupRows = useMemo(() => {
    if (!matchingV5SelectedId) return [];
    const anchor = matchingV5Rows.find((r) => r.id === matchingV5SelectedId) ?? null;
    if (!anchor) return [];
    return findMatchingV5LinkedParcelleRowsTransitive(anchor, matchingV5Rows);
  }, [matchingV5SelectedId, matchingV5Rows]);

  useEffect(() => {
    if (!matchingV5SelectedId) {
      setMatchingV5BuildingsError(null);
      setMatchingV5BuildingFeatures([]);
      setMatchingV5SharedParcelFeatures([]);
      return;
    }
    const selected = matchingV5Rows.find((r) => r.id === matchingV5SelectedId) ?? null;
    if (!selected || selected.grain !== "parcelle") {
      setMatchingV5BuildingsError(null);
      setMatchingV5BuildingFeatures([]);
      setMatchingV5SharedParcelFeatures([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const linked = findMatchingV5LinkedParcelleRowsTransitive(selected, matchingV5Rows);
      const ids: string[] = [];
      const idSeen = new Set<string>();
      for (const row of linked) {
        if (row.grain !== "parcelle") continue;
        const raw = row.buildingsJson?.trim() || "";
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as Array<{
            batiment_construction_id?: string;
            batiment_groupe_id?: string;
          }>;
          for (const it of parsed) {
            const id = (it?.batiment_construction_id || it?.batiment_groupe_id || "").trim();
            if (id && !idSeen.has(id)) {
              idSeen.add(id);
              ids.push(id);
            }
          }
        } catch {
          // ignore
        }
      }
      if (!cancelled) {
        setMatchingV5SharedParcelFeatures(
          linked.length > 1
            ? linked.map(
                (row) =>
                  ({
                    type: "Feature",
                    id: row.id,
                    properties: {
                      scout_v5_id: row.id,
                      section: row.section,
                      numero_norm: row.numeroNorm,
                    },
                    geometry: row.geometry,
                  }) as GeoJSON.Feature
              )
            : []
        );
      }
      if (ids.length === 0) {
        if (!cancelled) setMatchingV5BuildingsError("Aucun identifiant bâtiment dans buildings_json.");
        if (!cancelled) setMatchingV5BuildingFeatures([]);
        return;
      }
      try {
        const qs = new URLSearchParams({ ids: ids.slice(0, 200).join(",") });
        const res = await fetchWithAuth(`/api/matching-v5/buildings?${qs.toString()}`);
        if (!res.ok) {
          if (!cancelled) setMatchingV5BuildingsError(`Erreur API buildings (${res.status}).`);
          if (!cancelled) setMatchingV5BuildingFeatures([]);
          return;
        }
        const json = (await res.json()) as { features?: GeoJSON.Feature[] };
        const feats = (json.features ?? []).filter(
          (f): f is GeoJSON.Feature =>
            f.type === "Feature" &&
            !!f.geometry &&
            (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
        );
        if (!cancelled) {
          if (feats.length === 0) {
            setMatchingV5BuildingsError("API buildings OK mais aucun polygone retourné.");
          } else {
            setMatchingV5BuildingsError(null);
          }
          setMatchingV5BuildingFeatures(feats);
        }
      } catch {
        if (!cancelled) {
          setMatchingV5BuildingsError("Erreur réseau lors du chargement des bâtiments.");
          setMatchingV5BuildingFeatures([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchingV5SelectedId, matchingV5Rows]);

  const handleDrawerOpenChange = useCallback(
    (open: boolean) => {
      setIsDrawerOpen(open);
      if (!open && searchParams.get("prospectId")) {
        router.replace(pathname ?? "/solar-scout");
      }
    },
    [pathname, router, searchParams, setIsDrawerOpen]
  );

  const savedPosition = typeof window !== "undefined" ? loadMapPosition() : null;
  const defaultPosition = savedPosition || getDefaultMapPosition();
  const [centerCoordinates, setCenterCoordinates] = useState<AddressCoordinates | null>(
    savedPosition ? savedPosition.center : null
  );
  const [getMapCenterFunc, setGetMapCenterFunc] = useState<(() => AddressCoordinates | null) | null>(null);
  const [isBdnbEnrichingForProspect, setIsBdnbEnrichingForProspect] = useState(false);

  const handleGetMapCenter = useCallback((func: (() => AddressCoordinates | null) | null) => {
    if (func && typeof func === "function") {
      setGetMapCenterFunc(() => func);
    } else if (func !== null) {
      console.error("[Page] handleGetMapCenter: valeur non fonction", func, typeof func);
    }
  }, []);

  const handleGetMapBounds = useCallback(
    (
      func: (() => { ne: { lat: number; lng: number }; sw: { lat: number; lng: number } } | null) | null
    ) => {
      if (func && typeof func === "function") {
        setGetMapBoundsFunc(() => func);
      }
    },
    []
  );

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (authLoading || !user) return;
    if (profileLoading) return;
    if (userProfile?.status !== "admin") {
      router.replace("/");
      toast.info("Solar Scout est réservé aux administrateurs.");
    }
  }, [authLoading, user, profileLoading, userProfile?.status, router]);

  useEffect(() => {
    if (centerCoordinates) {
      saveMapPosition(centerCoordinates);
    }
  }, [centerCoordinates]);

  const handleAddToPipeline = useCallback(() => {
    setProspect(null);
    setIsDrawerOpen(false);
  }, [setIsDrawerOpen]);

  useEffect(() => {
    if (prospect) {
      logPolygonDrawer("page:drawer-effect", {
        prospectId: prospect.id,
        placeId: prospect.placeId,
        addressPreview: prospect.address?.slice(0, 40),
        roofSurfacesCount: prospect.roofSurfaces?.length ?? 0,
        roofSurfaceArea: prospect.roofSurface?.area,
        firstSurfaceId: prospect.roofSurfaces?.[0]?.id ?? "(roofSurface only)",
      });
      setIsDrawerOpen(true);
      setDrawerContent(
        <ProspectDrawer
          prospect={prospect}
          bdnbLoading={isBdnbEnrichingForProspect}
          isOpen={true}
          onOpenChange={handleDrawerOpenChange}
          onAddToPipeline={handleAddToPipeline}
          onProspectUpdate={(updatedProspect) => {
            setProspect((prev) => {
              if (!updatedProspect) return prev;
              if (!prev) return updatedProspect as Prospect;
              const merged: Prospect = {
                ...prev,
                ...updatedProspect,
                roofSurfaces: updatedProspect.roofSurfaces ?? prev.roofSurfaces,
                roofSurface: updatedProspect.roofSurface ?? prev.roofSurface,
              };
              logPolygonDrawer("page:drawer-onProspectUpdate", {
                source: "ProspectDrawer",
                prevSurfaces: prev.roofSurfaces?.length ?? 0,
                updatedHasRoofSurfaces: updatedProspect.roofSurfaces != null,
                updatedSurfacesLen: updatedProspect.roofSurfaces?.length,
                mergedSurfaces: merged.roofSurfaces?.length ?? 0,
                keysPatch: Object.keys(updatedProspect),
              });
              return merged;
            });
          }}
          voirHref={(_id) => "/discovery"}
        />
      );
    } else {
      setIsDrawerOpen(false);
      setDrawerContent(null);
    }
  }, [
    prospect,
    isBdnbEnrichingForProspect,
    setIsDrawerOpen,
    setDrawerContent,
    handleAddToPipeline,
    handleDrawerOpenChange,
  ]);

  useEffect(() => {
    const prospectId = searchParams.get("prospectId");
    if (!prospectId) return;
    const loadProspect = async () => {
      const p = await getProspectById(prospectId);
      if (p && p.coordinates) {
        setProspect(p);
        setCenterCoordinates(p.coordinates);
      }
    };
    void loadProspect();
  }, [searchParams]);

  if (authLoading || !user) {
    return (
      <div className="flex h-full min-h-[70vh] w-full items-center justify-center bg-muted/30 text-muted-foreground">
        Chargement...
      </div>
    );
  }

  if (profileLoading || userProfile?.status !== "admin") {
    return (
      <div className="flex h-full min-h-[70vh] w-full items-center justify-center bg-muted/30 text-muted-foreground">
        Chargement...
      </div>
    );
  }

  return (
    <div className="flex-1 w-full relative overflow-hidden flex rounded-xl min-h-0 h-full min-h-[70vh]">
      <div className="h-full flex-1 min-w-0 relative min-h-[70vh]">
        <MapErrorBoundary>
          <GoogleMapsLoader>
            <MapComponent
              onProspectUpdate={(updatedProspect) => {
                pendingBdnbSurfacesRef.current = null;
                setProspect((prev) => {
                  if (!updatedProspect) return prev;
                  if (!prev) return updatedProspect as Prospect;
                  const merged: Prospect = {
                    ...prev,
                    ...updatedProspect,
                    roofSurfaces: updatedProspect.roofSurfaces ?? prev.roofSurfaces,
                    roofSurface: updatedProspect.roofSurface ?? prev.roofSurface,
                  };
                  logPolygonDrawer("page:map-onProspectUpdate", {
                    prevSurfaces: prev.roofSurfaces?.length ?? 0,
                    updatedHasRoofSurfaces: updatedProspect.roofSurfaces != null,
                    updatedSurfacesLen: updatedProspect.roofSurfaces?.length,
                    mergedSurfaces: merged.roofSurfaces?.length ?? 0,
                    keysPatch: Object.keys(updatedProspect),
                  });
                  return merged;
                });
              }}
              centerCoordinates={centerCoordinates}
              currentProspect={prospect}
              onOsmEnrichmentChange={setIsBdnbEnrichingForProspect}
              onGetMapCenter={handleGetMapCenter}
              onBdnbInfo={(info) => {
                setProspect((prev) => {
                  if (!prev) return prev;
                  return { ...prev, anneeConstruction: info.anneeConstruction };
                });
              }}
              onGetMapBounds={handleGetMapBounds}
              onViewBoundsChange={
                discoverySource === "postgres" ? (b) => setMatchingV5ViewBounds(b) : undefined
              }
              matchingV5Rows={matchingV5Rows}
              showMatchingV5Layer={true}
              selectedMatchingV5Id={matchingV5SelectedId}
              selectedMatchingV5GroupIds={matchingV5SelectedGroupRows.map((r) => r.id)}
              onMatchingV5Select={(row) => setMatchingV5SelectedId(row.id)}
              matchingV5BuildingFeatures={matchingV5BuildingFeatures}
              matchingV5SharedParcelFeatures={matchingV5SharedParcelFeatures}
              onBdnbSurface={(bdnbSurfaces) => {
                logPolygonDrawer("page:onBdnbSurface", {
                  bdnbCount: bdnbSurfaces?.length ?? 0,
                });
                pendingBdnbSurfacesRef.current =
                  bdnbSurfaces && bdnbSurfaces.length > 0 ? bdnbSurfaces : null;
                setProspect((prev) => {
                  if (!prev) return prev;
                  const manualSurfaces = (prev.roofSurfaces ?? []).filter(
                    (s) => !s.id?.startsWith("bdnb-") && !s.id?.startsWith("osm-")
                  );
                  if (!bdnbSurfaces || bdnbSurfaces.length === 0) {
                    if (manualSurfaces.length > 0) {
                      const totalArea = manualSurfaces.reduce((sum, s) => sum + s.area, 0);
                      return {
                        ...prev,
                        roofSurfaces: manualSurfaces,
                        roofSurface: manualSurfaces.at(-1) ?? { area: 0, polygon: [] },
                        qualityScore: calculateQualityScore(totalArea, prev.placeType),
                        solarPotential: {
                          ...prev.solarPotential,
                          maxArrayPanelsCount: prev.solarPotential?.maxArrayPanelsCount ?? 0,
                          maxArrayAreaMeters2: prev.solarPotential?.maxArrayAreaMeters2 ?? totalArea,
                          maxSunshineHoursPerYear: prev.solarPotential?.maxSunshineHoursPerYear ?? 0,
                          maxKwhPerYear: prev.solarPotential?.maxKwhPerYear ?? 0,
                          estimatedKwp: surfaceToKwp(totalArea),
                          pvgisDataFetched: false,
                        },
                      };
                    }
                    const existingCount =
                      (prev.roofSurfaces ?? []).length || (prev.roofSurface?.area > 0 ? 1 : 0);
                    if (existingCount > 0) {
                      return prev;
                    }
                    return {
                      ...prev,
                      roofSurfaces: [],
                      roofSurface: { area: 0, polygon: [] },
                      qualityScore: calculateQualityScore(0, prev.placeType),
                      solarPotential: {
                        ...prev.solarPotential,
                        maxArrayPanelsCount: prev.solarPotential?.maxArrayPanelsCount ?? 0,
                        maxArrayAreaMeters2: 0,
                        maxSunshineHoursPerYear: prev.solarPotential?.maxSunshineHoursPerYear ?? 0,
                        maxKwhPerYear: 0,
                        monthlyProduction: undefined,
                        estimatedKwp: surfaceToKwp(0),
                        pvgisDataFetched: false,
                      },
                    };
                  }
                  const updatedSurfaces = [...bdnbSurfaces, ...manualSurfaces];
                  const totalArea = updatedSurfaces.reduce((sum, s) => sum + s.area, 0);
                  return {
                    ...prev,
                    roofSurfaces: updatedSurfaces,
                    roofSurface: bdnbSurfaces[0],
                    qualityScore: calculateQualityScore(totalArea, prev.placeType),
                    solarPotential: {
                      ...prev.solarPotential,
                      maxArrayPanelsCount: prev.solarPotential?.maxArrayPanelsCount ?? 0,
                      maxArrayAreaMeters2: prev.solarPotential?.maxArrayAreaMeters2 ?? totalArea,
                      maxSunshineHoursPerYear: prev.solarPotential?.maxSunshineHoursPerYear ?? 0,
                      maxKwhPerYear: prev.solarPotential?.maxKwhPerYear ?? 0,
                      estimatedKwp: surfaceToKwp(totalArea),
                      pvgisDataFetched: false,
                    },
                  };
                });
              }}
            />
          </GoogleMapsLoader>
        </MapErrorBoundary>
      </div>

      <div className="absolute top-6 left-6 z-50">
        <Sidebar
          onProspectUpdate={(updatedProspect) => {
            setProspect((prev) => {
              if (!updatedProspect) return prev;
              if (!prev) return updatedProspect as Prospect;
              const merged: Prospect = {
                ...prev,
                ...updatedProspect,
                roofSurfaces: updatedProspect.roofSurfaces ?? prev.roofSurfaces,
                roofSurface: updatedProspect.roofSurface ?? prev.roofSurface,
              };
              return merged;
            });
          }}
          onRefreshDiscovery={() => {
            setMatchingV5FetchKey((k) => k + 1);
          }}
          discoveryState={{
            loading: isMatchingV5Loading,
            count: matchingV5Rows.length,
            error: [matchingV5Error, matchingV5BuildingsError].filter(Boolean).join(" | ") || null,
            rows: matchingV5Rows,
            selectedId: matchingV5SelectedId,
            selectedGroupRows: matchingV5SelectedGroupRows,
            onSelectRow: (id) => setMatchingV5SelectedId(id),
          }}
        />
      </div>
    </div>
  );
}

export default function SolarScoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-full items-center justify-center bg-background">Chargement...</div>
      }
    >
      <SolarScoutContent />
    </Suspense>
  );
}
