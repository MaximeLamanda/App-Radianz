"use client";

import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { GoogleMapsLoader } from "@/components/solar-scout/GoogleMapsLoader";
import {
  buildParcelUnionGeometry,
  fetchNearbyRankedInParcel,
  waitForGoogleMapsReady,
} from "@/lib/discovery-google-nearby-live";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { radianzMonoLabelClass } from "@/lib/radianz-card-primitives";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  X,
  Loader2,
  AlertCircle,
  Zap,
  FileCheck,
  Link2,
  Eye,
  Map as MapIcon,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { PieChart, Pie, Cell } from "recharts";
import { addProspectToPipeline, createLeadFromProspect, updateProspectInPipeline, updateProspect } from "@/lib/firestore";
import {
  computeDiscoveryDrawerFinancialSummary,
  type DiscoveryDrawerFinancialInputs,
  type DiscoveryDrawerFinancialSummary,
} from "@/lib/discovery-drawer-financial-summary";
import { buildDiscoveryFocusHref } from "@/lib/discovery-focus-href";
import {
  DISCOVERY_PVGIS_ROOF_SLOPE_DEG,
  pvgisAzimuthFromFootprintGeometry,
} from "@/lib/footprint-orientation-pvgis";
import {
  discoveryCentroidFromV5,
  footprintSumTotalFromV5,
  getParcelleClusterForV5,
  matchingV5RowsToProspectDraft,
} from "@/lib/matching-v5-to-prospect";
import { logPolygonDrawer } from "@/lib/debug-polygon-drawer";

/** Activer les logs détaillés d'autoconsommation. Désactivé par défaut. */
const DEBUG_AUTOCONSO = false;
import { translatePlaceType } from "@/lib/place-types-translation";
import { ProspectEnergyChartsPanel } from "./ProspectEnergyChartsPanel";
import { RadianzBillReductionCard, type RadianzBillReductionSegment } from "./RadianzBillReductionCard";
import { RadianzCo2AvoidanceRadial } from "./RadianzCo2AvoidanceRadial";
import type { MonthlyProductionChartDatum, DailyProductionChartDatum } from "./MonthlyProductionChart";
import { BatterySelectCard } from "./BatterySelectCard";
import { EquipmentSelectCard, EquipmentThumbnail } from "./EquipmentSelectCard";
import { surfaceToKwp, getUsableRoofAreaM2 } from "@/lib/surface-to-kwp";
import {
  buildTypicalConsumptionDayForMonth,
  getEnergyConsumption,
  getEnergyConsumptionForMonth,
  type MonthIndex,
} from "@/lib/building-energy-consumption";
import {
  buildTypicalDayForMonth,
  getProductionFromPerKwp,
  getProductionPerKwpFromSolarPotential,
  getPVGISData,
  validateCoordinates,
  type PVGISData,
} from "@/lib/pvgis";
import { runProductionSimulation, runSimulationOneDayForChart, scaleBatteryForCount } from "@/lib/battery-simulation";
import { computeRecommendedBatteryTargetKwh } from "@/lib/recommended-battery-sizing";
import { pickRecommendedBatteryComposition } from "@/lib/recommended-battery-composition";
import { usePanelReferences, useInverterReferences, useBatteryReferences } from "@/lib/swr-hooks";
import {
  getPanelReferences,
  getCountryFlagUrl,
  getRecommendedPanelReferenceSync,
  getRecommendedInverterReferenceSync,
  getSolarEquipmentSettings,
  calculatePanelCount,
  calculateInverterCount,
  estimateInstallationPriceEur,
  estimateTotalPriceRangeEur,
  estimateAnnualSavingsEur,
  estimateAnnualSavingsEurWithBattery,
  estimateEnergyBillEur,
  getBreakEvenYears,
  DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH,
  DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH,
} from "@/lib/solar-settings";
import {
  fetchCompanyEnrichment,
  buildApiGouvSearchUrl,
  type EnrichmentResult,
} from "@/lib/recherche-entreprises";
import { getCommercialReferent, buildCommercialReferentFromUser } from "@/lib/commercial-mock";
import { useAuth } from "@/lib/auth-context";
import { getUserProfile } from "@/lib/firestore-user-profile";
import { getPlaceDetailsNew } from "@/lib/places-new-api";
import type { ScoredCandidate } from "@/lib/find-local-siren";
import { fetchWithAuth } from "@/lib/api-client";
import {
  centroidWeightedFromParcelleRowGeometries,
  collectSirensFromMatchingV5Row,
  collectSirensFromMatchingV5Rows,
  formatDiscoveryDrawerHeroAddress,
  mergeOsmPoisFromParcelleRows,
  parseGoogleNearbyRankedJson,
  parseMatchingV5BuildingsJson,
  parsePasserelleAddressesJson,
  parseSiretsMatchJson,
  type V5GoogleNearbyRankedEntry,
  type ScoutMatchingV5Row,
  type V5BuildingsJsonEntry,
  type V5OsmPoiEntry,
  type V5PasserellePpmEntry,
} from "@/lib/scout-matching-v5-map";
import { DiscoverySolaireProjectCards } from "@/components/discovery/DiscoverySolaireProjectCards";
import { labelTrancheEffectifs } from "@/lib/sirene-tranche-effectifs";
import { centroidFromGeoJsonPolygonLike } from "@/lib/matching-v5-google-poi-fallback";
import { polygonAreaM2ApproxWgs84 } from "@/lib/geojson-polygon-area-m2";
import type { Prospect, SolarPotential, PanelReference, InverterReference, BatteryReference, CommercialReferent } from "@/types";

/** Config des lignes données prospect : liste fixe, une entrée par ligne (skeleton / valeur / "No data"). */
function websiteHref(raw: string): string {
  const t = raw.trim();
  if (!t) return "#";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

/** Bloc OSM (Découverte) : réutilisé dans l’onglet Entreprises, avant les établissements SIRET. */
type DiscoveryDrawerMergedPoiEntry = {
  key: string;
  source: "osm" | "google";
  name: string;
  typeLabel: string;
  phone: string;
  website: string;
  externalUrl: string;
};

function googlePlaceHref(placeId: string): string {
  const id = placeId.trim();
  if (!id) return "";
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(id)}`;
}

function googlePoiTypeLabel(types: V5GoogleNearbyRankedEntry["types"]): string {
  const first = Array.isArray(types) && types.length > 0 ? String(types[0] || "").trim() : "";
  if (!first) return "—";
  return first
    .replace(/_/g, " ")
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ""))
    .join(" ");
}

function DiscoveryDrawerMergedPoiBlock({
  pois,
  showTitle = true,
  onNearbySearch,
  nearbySearchPending = false,
}: {
  pois: DiscoveryDrawerMergedPoiEntry[];
  showTitle?: boolean;
  /** Si défini et liste vide : bouton pour lancer une recherche Google Nearby (client). */
  onNearbySearch?: () => void | Promise<void>;
  nearbySearchPending?: boolean;
}) {
  return (
    <div className="space-y-3">
      {showTitle ? <p className="drawer-discovery-subpanel-title">Lieux à proximité</p> : null}
      {pois.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
          <p className="m-0">
            Aucun lieu avec nom n’est disponible pour ce site. Cette liste peut se compléter lors des prochaines mises à jour des données.
          </p>
          {onNearbySearch ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full text-xs font-medium"
              disabled={nearbySearchPending}
              onClick={() => void onNearbySearch()}
            >
              {nearbySearchPending ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
                  Recherche Google…
                </>
              ) : (
                "Rechercher des établissements (Google) dans la parcelle"
              )}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="drawer-discovery-table-wrap">
          <Table className="text-[11px]">
            <TableHeader>
              <TableRow className="border-0 hover:bg-transparent">
                <TableHead className="min-w-[11rem]">Nom</TableHead>
                <TableHead className="whitespace-nowrap">Source</TableHead>
                <TableHead className="min-w-[6rem]">Type</TableHead>
                <TableHead className="whitespace-nowrap">Tel</TableHead>
                <TableHead className="min-w-[4rem]">Web</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pois.map((poi) => {
                const typeLabel = (poi.typeLabel || "").trim() || "—";
                const phone = (poi.phone || "").trim() || "—";
                const websiteRaw = (poi.website || "").trim();
                const externalRaw = (poi.externalUrl || "").trim();
                const sourceBadgeLabel = poi.source === "google" ? "Google" : "OSM";
                return (
                  <TableRow key={poi.key} className="border-0">
                    <TableCell className="min-w-0 align-top">
                      <span className="line-clamp-2 break-words text-xs leading-relaxed" title={poi.name.trim()}>
                        {poi.name.trim()}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-0 align-top whitespace-nowrap font-mono">
                      {externalRaw ? (
                        <a href={externalRaw} target="_blank" rel="noopener noreferrer" title="Voir la fiche">
                          <Badge
                            variant="solid"
                            className="h-5 min-h-5 rounded-md border-0 bg-foreground px-1.5 py-0 text-[9px] font-semibold uppercase leading-none tracking-wide text-background shadow-[0_1px_0_rgb(0_0_0/0.1)] transition-[box-shadow] duration-200 hover:bg-foreground/90 hover:shadow-xs cursor-pointer"
                          >
                            {sourceBadgeLabel}
                            <ChevronRight className="h-2.5 w-2.5 opacity-90" />
                          </Badge>
                        </a>
                      ) : (
                        <Badge
                          variant="solid"
                          className="h-5 min-h-5 rounded-md border-0 bg-foreground px-1.5 py-0 text-[9px] font-semibold uppercase leading-none tracking-wide text-background shadow-[0_1px_0_rgb(0_0_0/0.1)]"
                        >
                          {sourceBadgeLabel}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="min-w-0 align-top text-muted-foreground">
                      <span
                        className="block truncate text-xs leading-relaxed"
                        title={typeLabel !== "—" ? typeLabel : undefined}
                      >
                        {typeLabel}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-0 align-top font-mono text-xs tabular-nums">
                      <span className="block max-w-[7.5rem] truncate" title={phone !== "—" ? phone : undefined}>
                        {phone}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-0 align-top text-xs">
                      {websiteRaw ? (
                        <a
                          href={websiteHref(websiteRaw)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          lien
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

const PROSPECT_DATA_ROWS: {
  label: string;
  getValue: (p: Prospect) => string | undefined;
  isBdnb: boolean;
  isPhone?: boolean;
  isWebsite?: boolean;
}[] = [
  {
    label: "Type",
    getValue: (p) => translatePlaceType(p.placeType) || p.placeType || undefined,
    isBdnb: false,
  },
  {
    label: "Surface",
    getValue: (p) => {
      const area = p.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? p.roofSurface?.area ?? 0;
      return `${area.toFixed(0)} m²`;
    },
    isBdnb: true,
  },
  { label: "SIREN", getValue: (p) => p.siren ?? undefined, isBdnb: false },
  { label: "SIRET", getValue: (p) => p.siret ?? undefined, isBdnb: false },
  { label: "Dénomination", getValue: (p) => p.companyLegalName ?? undefined, isBdnb: false },
  { label: "Adresse siège", getValue: (p) => p.companyAddress ?? undefined, isBdnb: false },
  { label: "Code NAF", getValue: (p) => p.companyNaf ?? undefined, isBdnb: false },
  {
    label: "Effectif",
    getValue: (p) => p.companyTrancheEffectif ?? undefined,
    isBdnb: false,
  },
  { label: "Gérant", getValue: (p) => p.companyManagerName ?? undefined, isBdnb: false },
  { label: "Téléphone", getValue: (p) => (p.contact?.nationalPhoneNumber ?? p.contact?.internationalPhoneNumber) ?? undefined, isBdnb: false, isPhone: true },
  {
    label: "Site web",
    getValue: (p) => p.contact?.websiteUri ?? undefined,
    isBdnb: false,
    isWebsite: true,
  },
  { label: "Année construction", getValue: (p) => (p.anneeConstruction != null ? String(p.anneeConstruction) : undefined), isBdnb: true },
];

/** Détermine le niveau de confiance basé sur le score (0-1000), calibré après pondération adresse. */
function getConfidenceLevel(score: number): "high" | "medium" | "low" {
  if (score >= 600) return "high";
  if (score >= 350) return "medium";
  return "low";
}

/** Lettre score « opérationnel » (même seuils que la confiance matching adresse). */
function operationalScoreLetterFromMatching(confidence: number): "A" | "B" | "C" {
  const level = getConfidenceLevel(Math.round(Math.max(0, confidence)));
  if (level === "high") return "A";
  if (level === "medium") return "B";
  return "C";
}

/** Retourne les propriétés du badge de confiance */
function getConfidenceBadgeProps(level: "high" | "medium" | "low") {
  switch (level) {
    case "high":
      return {
        label: "High",
        className: "bg-emerald-100 text-emerald-800 border-emerald-200",
      };
    case "medium":
      return {
        label: "Medium",
        className: "bg-amber-100 text-amber-800 border-amber-200",
      };
    case "low":
      return {
        label: "Low",
        className: "bg-red-100 text-red-800 border-red-200",
      };
  }
}

type DiscoveryApiNomEntry = { status: "loading" | "ok" | "err"; name?: string };

/** Contenu du drawer en mode découverte PostgreSQL (matching V5), même tiroir que Solar Scout. */
function ProspectDrawerDiscoverySection({
  row,
  linkedParcelleRows,
  isOpen,
  onPipelineFinanceInputsChange,
  pipelineProject,
  discoveryIncludeBattery,
  onDiscoveryIncludeBatteryChange,
  discoverySimulationSummary,
  discoveryDailySimulationBattery,
  onDiscoveryMatchingV5Persisted,
}: {
  row: ScoutMatchingV5Row;
  /** Parcelles du même groupe (transitif « partage » ou bâtiment multi-parcelles). */
  linkedParcelleRows: ScoutMatchingV5Row[];
  isOpen: boolean;
  /** Données PV + surface pour estimer prix / B-E dans le pied du drawer (pipeline). */
  onPipelineFinanceInputsChange?: (payload: DiscoveryDrawerFinancialInputs | null) => void;
  /** Résumé projet (onglet Solaire, sous le graphe) + surface pour la facture ref. */
  pipelineProject?: { summary: DiscoveryDrawerFinancialSummary; surfaceM2: number } | null;
  /** Switch batterie (aligné simulation / page partagée). */
  discoveryIncludeBattery: boolean;
  onDiscoveryIncludeBatteryChange: (checked: boolean) => void;
  /** Résumé simulation (autoconso batterie, segments facture, `batteryByMonth` pour graphes). */
  discoverySimulationSummary: DiscoveryDrawerFinancialSummary | null;
  /** Même pack batterie que le résumé, pour la vue journalière. */
  discoveryDailySimulationBattery: { ref: BatteryReference; count: number } | null;
  onDiscoveryMatchingV5Persisted?: () => void;
}) {
  const parcelleCluster = useMemo(() => {
    const filtered = linkedParcelleRows.filter((r) => r.grain === "parcelle");
    if (filtered.length > 0) return filtered;
    if (row.grain === "parcelle") return [row];
    return [];
  }, [linkedParcelleRows, row]);

  const [liveGoogleNearbyOverride, setLiveGoogleNearbyOverride] = useState<V5GoogleNearbyRankedEntry[] | null>(null);
  const [nearbyLivePending, setNearbyLivePending] = useState(false);

  const discoveryOsmPoisNamed = useMemo(
    () => mergeOsmPoisFromParcelleRows(parcelleCluster).filter((p) => p.name.trim() !== ""),
    [parcelleCluster]
  );
  const discoveryGooglePoisNamed = useMemo(() => {
    if (liveGoogleNearbyOverride !== null) {
      const outLive: V5GoogleNearbyRankedEntry[] = [];
      const seenLive = new Set<string>();
      for (const entry of liveGoogleNearbyOverride) {
        const name = String(entry.name || "").trim();
        if (!name) continue;
        const placeId = String(entry.place_id || "").trim();
        const dedupeKey = placeId ? `pid:${placeId}` : `name:${name.toLowerCase()}:${entry.rank ?? -1}`;
        if (seenLive.has(dedupeKey)) continue;
        seenLive.add(dedupeKey);
        outLive.push(entry);
      }
      return outLive;
    }
    const out: V5GoogleNearbyRankedEntry[] = [];
    const seen = new Set<string>();
    const addFromRow = (r: ScoutMatchingV5Row) => {
      const rawFromProps = r.properties?.google_nearby_ranked_json;
      if (rawFromProps == null || rawFromProps === "") return;
      if (typeof rawFromProps === "string" && !String(rawFromProps).trim()) return;
      for (const entry of parseGoogleNearbyRankedJson(rawFromProps)) {
        const name = String(entry.name || "").trim();
        if (!name) continue;
        const placeId = String(entry.place_id || "").trim();
        const dedupeKey = placeId ? `pid:${placeId}` : `name:${name.toLowerCase()}:${entry.rank ?? -1}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        out.push(entry);
      }
    };
    for (const pr of parcelleCluster) addFromRow(pr);
    if (row.grain === "building") addFromRow(row);
    if (out.length === 0 && row.grain === "parcelle" && parcelleCluster.length === 0) addFromRow(row);
    return out;
  }, [parcelleCluster, row, liveGoogleNearbyOverride]);
  const discoveryMergedPois = useMemo<DiscoveryDrawerMergedPoiEntry[]>(() => {
    const osmRows: DiscoveryDrawerMergedPoiEntry[] = discoveryOsmPoisNamed.map((poi) => ({
      key: `osm:${poi.osm_type}:${poi.osm_id}`,
      source: "osm",
      name: poi.name.trim(),
      typeLabel: (poi.poi_type_label || "").trim() || "—",
      phone: (poi.phone || "").trim(),
      website: (poi.website || "").trim(),
      externalUrl: (poi.osm_url || "").trim(),
    }));
    const googleRows: DiscoveryDrawerMergedPoiEntry[] = discoveryGooglePoisNamed.map((poi) => ({
      key: `google:${String(poi.place_id || "").trim() || poi.rank}`,
      source: "google",
      name: String(poi.name || "").trim(),
      typeLabel: googlePoiTypeLabel(poi.types),
      phone: "",
      website: "",
      externalUrl: googlePlaceHref(String(poi.place_id || "")),
    }));
    return [...osmRows, ...googleRows].sort((a, b) => {
      const byName = a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
      if (byName !== 0) return byName;
      if (a.source !== b.source) return a.source === "google" ? -1 : 1;
      return a.key.localeCompare(b.key, "fr");
    });
  }, [discoveryOsmPoisNamed, discoveryGooglePoisNamed]);

  const discoveryClusterKey = useMemo(
    () => `${row.id}|${parcelleCluster.map((p) => p.id).sort().join(",")}`,
    [row.id, parcelleCluster]
  );

  const matchingV5ApiNomFetchedRef = useRef<Set<string>>(new Set());
  const [matchingV5ApiNomBySiren, setMatchingV5ApiNomBySiren] = useState<
    Record<string, DiscoveryApiNomEntry>
  >({});
  const [discoveryMainTab, setDiscoveryMainTab] = useState("batiments");
  const [showAllEstablishments, setShowAllEstablishments] = useState(false);
  const initialDiscoveryEstablishmentsVisible = 5;

  useEffect(() => {
    matchingV5ApiNomFetchedRef.current.clear();
    setMatchingV5ApiNomBySiren({});
    setShowAllEstablishments(false);
    setLiveGoogleNearbyOverride(null);
  }, [discoveryClusterKey]);

  const handleDiscoveryLiveNearbySearch = useCallback(async () => {
    const geom = buildParcelUnionGeometry(parcelleCluster);
    if (!geom) {
      toast.error("Aucune emprise parcelle pour lancer la recherche.");
      return;
    }
    setNearbyLivePending(true);
    try {
      const ready = await waitForGoogleMapsReady({ timeoutMs: 25000 });
      if (!ready) {
        toast.error("Google Maps n’est pas prêt. Vérifiez la clé API et réessayez.");
        return;
      }
      const result = await fetchNearbyRankedInParcel({ parcelGeometry: geom });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setLiveGoogleNearbyOverride(result.entries);
      if (result.entries.length === 0) {
        toast.info("Aucun établissement Google dans l’emprise de cette parcelle.");
      }
      try {
        const persistRes = await fetchWithAuth("/api/matching-v5/features/google-nearby", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scoutV5Id: row.id,
            googleNearbyRanked: result.entries,
          }),
        });
        if (!persistRes.ok) {
          const desc =
            persistRes.status === 404
              ? "Ligne introuvable en base."
              : persistRes.status === 401
                ? "Reconnectez-vous pour enregistrer."
                : `HTTP ${persistRes.status}`;
          toast.error("Enregistrement des POI impossible.", { description: desc });
        } else {
          toast.success("POI Google enregistrés.");
          onDiscoveryMatchingV5Persisted?.();
        }
      } catch {
        toast.error("Erreur réseau lors de l’enregistrement des POI.");
      }
    } finally {
      setNearbyLivePending(false);
    }
  }, [parcelleCluster, row.id, onDiscoveryMatchingV5Persisted]);

  const sirensForApiNom = useMemo(() => {
    if (parcelleCluster.length > 0) return collectSirensFromMatchingV5Rows(parcelleCluster);
    return collectSirensFromMatchingV5Row(row);
  }, [parcelleCluster, row]);

  useEffect(() => {
    if (!isOpen) return;
    if (discoveryMainTab !== "terrain") return;
    const sirens = sirensForApiNom.slice(0, 10);
    for (const siren of sirens) {
      if (matchingV5ApiNomFetchedRef.current.has(siren)) continue;
      matchingV5ApiNomFetchedRef.current.add(siren);
      setMatchingV5ApiNomBySiren((prev) =>
        prev[siren]?.status === "ok" ? prev : { ...prev, [siren]: { status: "loading" } }
      );
      void (async () => {
        try {
          const res = await fetch(
            `/api/recherche-entreprises?q=${encodeURIComponent(siren)}&per_page=1`
          );
          if (!res.ok) {
            setMatchingV5ApiNomBySiren((prev) => ({ ...prev, [siren]: { status: "err" } }));
            return;
          }
          const data = (await res.json()) as { result?: { companyLegalName?: string | null } };
          const name = data.result?.companyLegalName?.trim() || undefined;
          setMatchingV5ApiNomBySiren((prev) => ({
            ...prev,
            [siren]: { status: "ok", name },
          }));
        } catch {
          setMatchingV5ApiNomBySiren((prev) => ({ ...prev, [siren]: { status: "err" } }));
        }
      })();
    }
  }, [isOpen, discoveryMainTab, sirensForApiNom]);

  const passerelleFlat = useMemo(() => {
    type Entry = { parcelleLabel: string; ppm: V5PasserellePpmEntry };
    const out: Entry[] = [];
    const rows =
      parcelleCluster.length > 0 ? parcelleCluster : row.grain === "parcelle" ? [row] : [];
    for (const pr of rows) {
      const label =
        pr.section && pr.numeroNorm
          ? `${pr.section} ${pr.numeroNorm} · ${pr.codeInsee || "—"}`
          : pr.id;
      for (const ppm of parsePasserelleAddressesJson(pr.passerelleAddressesJson)) {
        out.push({ parcelleLabel: label, ppm });
      }
    }
    if (out.length === 0 && row.grain === "building") {
      const label = (row.label || "").trim() || row.id;
      for (const ppm of parsePasserelleAddressesJson(row.passerelleAddressesJson)) {
        out.push({ parcelleLabel: label, ppm });
      }
    }
    return out;
  }, [parcelleCluster, row]);

  const sirets = useMemo(() => {
    const seen = new Set<string>();
    const out: ReturnType<typeof parseSiretsMatchJson> = [];
    const addFrom = (r: ScoutMatchingV5Row) => {
      for (const e of parseSiretsMatchJson(r.siretsJson)) {
        if (seen.has(e.siret)) continue;
        seen.add(e.siret);
        out.push(e);
      }
    };
    for (const pr of parcelleCluster) addFrom(pr);
    if (row.grain === "building") addFrom(row);
    if (out.length === 0 && row.grain === "parcelle" && parcelleCluster.length === 0) addFrom(row);
    return out;
  }, [parcelleCluster, row]);

  const uniqueSirenPasserelle = useMemo(
    () =>
      new Set(
        passerelleFlat.map(({ ppm }) => String(ppm.siren || "").trim()).filter(Boolean)
      ),
    [passerelleFlat]
  );
  const multiEntreprises = useMemo(() => {
    const anyShared =
      parcelleCluster.some((p) => p.statusMetier === "shared") ||
      row.statusMetier === "shared" ||
      sirets.length > 1;
    return anyShared || uniqueSirenPasserelle.size > 1;
  }, [parcelleCluster, row.statusMetier, sirets.length, uniqueSirenPasserelle.size]);

  /** Lignes `buildings_json` ; pour une ligne `building` sans JSON, une ligne synthétique à partir de la row. Tri décroissant par empreinte (sans empreinte en fin de liste). */
  const buildingDetailRows = useMemo((): V5BuildingsJsonEntry[] => {
    const byBc = new Map<string, V5BuildingsJsonEntry>();
    for (const pr of parcelleCluster.length > 0 ? parcelleCluster : []) {
      for (const b of parseMatchingV5BuildingsJson(pr.buildingsJson)) {
        if (!byBc.has(b.batimentConstructionId)) byBc.set(b.batimentConstructionId, b);
      }
    }
    let raw: V5BuildingsJsonEntry[];
    if (byBc.size > 0) {
      raw = Array.from(byBc.values());
    } else {
      const parsed = parseMatchingV5BuildingsJson(row.buildingsJson);
      if (parsed.length > 0) {
        raw = parsed;
      } else if (row.grain !== "building") {
        raw = [];
      } else {
        const bc = row.batimentConstructionId?.trim() || "";
        const bg = row.batimentGroupeId?.trim() || null;
        if (!bc && !bg) {
          raw = [];
        } else {
          const props = row.properties ?? {};
          const annRaw = props.annee_construction;
          const ann =
            typeof annRaw === "number" && Number.isFinite(annRaw)
              ? annRaw
              : (() => {
                  const n = Number(String(annRaw ?? "").trim());
                  return Number.isFinite(n) ? n : null;
                })();
          const fpRaw = props.footprint_m2;
          const fpFromProps =
            typeof fpRaw === "number" && Number.isFinite(fpRaw)
              ? fpRaw
              : (() => {
                  const n = Number(String(fpRaw ?? "").trim());
                  return Number.isFinite(n) ? n : null;
                })();
          const footprintM2 = fpFromProps ?? (row.footprintSumM2 > 0 ? row.footprintSumM2 : null);
          const ms = String(props.matching_status ?? "").trim();
          const md = String(props.matching_decision ?? "").trim();
          const mss = String(props.matching_siren_selected ?? "").trim();
          raw = [
            {
              batimentConstructionId: bc || "—",
              batimentGroupeId: bg,
              anneeConstruction: ann,
              footprintM2,
              intersectionAreaM2: null,
              matchingStatus: ms || "—",
              matchingDecision: md,
              matchingSirenSelected: mss,
            },
          ];
        }
      }
    }
    return [...raw].sort((a, b) => {
      const fa = a.footprintM2;
      const fb = b.footprintM2;
      if (fa == null && fb == null) {
        return a.batimentConstructionId.localeCompare(b.batimentConstructionId, "fr");
      }
      if (fa == null) return 1;
      if (fb == null) return -1;
      if (fb !== fa) return fb - fa;
      return a.batimentConstructionId.localeCompare(b.batimentConstructionId, "fr");
    });
  }, [row, parcelleCluster]);

  /** Uniquement les établissements issus du matching adresse (SIRET), pas la liste PPM brute. */
  const discoverySiretRows = useMemo(
    () => sirets.map((e) => ({ key: e.siret, e })),
    [sirets]
  );

  const footprintSumTotal = useMemo(() => {
    if (parcelleCluster.length > 0) {
      return parcelleCluster.reduce((s, p) => s + p.footprintSumM2, 0);
    }
    return row.footprintSumM2;
  }, [parcelleCluster, row.footprintSumM2]);

  const panelRef = typeof window !== "undefined" ? getRecommendedPanelReferenceSync() : null;
  const kwpEst = surfaceToKwp(footprintSumTotal, undefined, undefined, panelRef);
  const cartePolygonAreaM2 = useMemo(() => {
    if (parcelleCluster.length === 0) return polygonAreaM2ApproxWgs84(row.geometry);
    return parcelleCluster.reduce((sum, p) => sum + polygonAreaM2ApproxWgs84(p.geometry), 0);
  }, [parcelleCluster, row.geometry]);

  const scoreDisplay = useMemo(() => {
    if (parcelleCluster.length === 0) {
      return Math.round(Math.max(0, row.matchingConfidence));
    }
    const m = Math.max(...parcelleCluster.map((p) => p.matchingConfidence), row.matchingConfidence);
    return Math.round(Math.max(0, m));
  }, [parcelleCluster, row.matchingConfidence]);

  const centroid = useMemo(() => {
    const w = centroidWeightedFromParcelleRowGeometries(parcelleCluster);
    if (w) return w;
    return centroidFromGeoJsonPolygonLike(row.geometry);
  }, [parcelleCluster, row.geometry]);

  const discoveryFootprintAzimuth = useMemo(
    () => pvgisAzimuthFromFootprintGeometry(row.geometry),
    [row.geometry]
  );

  /** Découverte : pas de type Google lieu — profil conso « other » (kWh/m²/an typique). */
  const discoveryPlaceType = "other";
  const [discoveryChartViewMode, setDiscoveryChartViewMode] = useState<"monthly" | "daily">("monthly");
  const [discoveryChartMonthIndex, setDiscoveryChartMonthIndex] = useState(6);
  const [discoveryPvgis, setDiscoveryPvgis] = useState<PVGISData | null>(null);
  const [discoveryPvgisLoading, setDiscoveryPvgisLoading] = useState(false);
  const [discoveryPvgisError, setDiscoveryPvgisError] = useState<string | null>(null);
  /** Complète NAF / effectifs via `/api/recherche-entreprises` (api.gouv) quand absents de sirets_json. */
  const [discoveryGouvEtabBySiret, setDiscoveryGouvEtabBySiret] = useState<
    Record<
      string,
      {
        status: "loading" | "ok" | "err";
        naf?: string;
        tranche?: string;
        annee?: string;
        manager?: string;
      }
    >
  >({});

  useEffect(() => {
    setDiscoveryGouvEtabBySiret({});
  }, [discoveryClusterKey]);

  const discoverySiretRowsToEnrich = useMemo(
    () =>
      showAllEstablishments
        ? discoverySiretRows
        : discoverySiretRows.slice(0, initialDiscoveryEstablishmentsVisible),
    [showAllEstablishments, discoverySiretRows, initialDiscoveryEstablishmentsVisible]
  );

  useEffect(() => {
    if (!isOpen || discoveryMainTab !== "terrain") return;
    let cancelled = false;
    const siretsToResetOnCleanup: string[] = [];
    for (const { e } of discoverySiretRowsToEnrich) {
      const siret = e.siret?.trim();
      if (!siret || !/^\d{14}$/.test(siret)) continue;
      const needNaf = !(e.activite_principale || "").trim();
      const needTranche = !(e.tranche_effectifs || "").trim();
      if (!needNaf && !needTranche) continue;

      siretsToResetOnCleanup.push(siret);

      setDiscoveryGouvEtabBySiret((prev) => {
        const cur = prev[siret];
        if (cur?.status === "loading" || cur?.status === "ok") return prev;
        return { ...prev, [siret]: { status: "loading" } };
      });

      void (async () => {
        try {
          const res = await fetch(`/api/recherche-entreprises?q=${encodeURIComponent(siret)}&per_page=1`);
          if (cancelled) return;
          if (!res.ok) {
            setDiscoveryGouvEtabBySiret((p) => ({ ...p, [siret]: { status: "err" } }));
            return;
          }
          const data = (await res.json()) as {
            result?: {
              companyNaf?: string;
              companyTrancheEffectif?: string;
              companyAnneeTrancheEffectif?: string;
              companyManagerName?: string;
            } | null;
          };
          if (cancelled) return;
          const r = data.result;
          setDiscoveryGouvEtabBySiret((p) => ({
            ...p,
            [siret]: {
              status: "ok",
              naf: r?.companyNaf?.trim() || undefined,
              tranche: r?.companyTrancheEffectif?.trim() || undefined,
              annee: r?.companyAnneeTrancheEffectif?.trim() || undefined,
              manager: r?.companyManagerName?.trim() || undefined,
            },
          }));
        } catch {
          if (!cancelled) {
            setDiscoveryGouvEtabBySiret((p) => ({ ...p, [siret]: { status: "err" } }));
          }
        }
      })();
    }
    return () => {
      cancelled = true;
      if (siretsToResetOnCleanup.length > 0) {
        setDiscoveryGouvEtabBySiret((prev) => {
          const next = { ...prev };
          for (const st of siretsToResetOnCleanup) {
            if (next[st]?.status === "loading") delete next[st];
          }
          return next;
        });
      }
    };
  }, [isOpen, discoveryMainTab, discoverySiretRowsToEnrich]);

  useEffect(() => {
    if (!isOpen) return;
    if (!centroid || !validateCoordinates({ lat: centroid.lat, lng: centroid.lng })) {
      setDiscoveryPvgis(null);
      setDiscoveryPvgisError(null);
      setDiscoveryPvgisLoading(false);
      return;
    }
    let cancelled = false;
    setDiscoveryPvgisLoading(true);
    setDiscoveryPvgisError(null);
    const pvgisOpts =
      discoveryFootprintAzimuth != null
        ? { azimuth: discoveryFootprintAzimuth, slope: DISCOVERY_PVGIS_ROOF_SLOPE_DEG }
        : undefined;
    void getPVGISData({ lat: centroid.lat, lng: centroid.lng }, pvgisOpts)
      .then((d) => {
        if (!cancelled) setDiscoveryPvgis(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setDiscoveryPvgis(null);
          setDiscoveryPvgisError(e instanceof Error ? e.message : "Erreur PVGIS");
        }
      })
      .finally(() => {
        if (!cancelled) setDiscoveryPvgisLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, discoveryClusterKey, centroid, discoveryFootprintAzimuth]);

  useEffect(() => {
    if (!isOpen) {
      onPipelineFinanceInputsChange?.(null);
      return;
    }
    if (!discoveryPvgis || kwpEst <= 0 || footprintSumTotal <= 0) {
      onPipelineFinanceInputsChange?.(null);
      return;
    }
    onPipelineFinanceInputsChange?.({
      footprintM2: footprintSumTotal,
      kwp: kwpEst,
      annualPerKwp: discoveryPvgis.annualProduction,
      monthlyPerKwp: discoveryPvgis.monthlyProduction.map((m) => ({
        month: m.month,
        production: m.production,
      })),
    });
  }, [isOpen, discoveryPvgis, kwpEst, footprintSumTotal, onPipelineFinanceInputsChange]);

  const discoveryChartMonthlyData = useMemo(() => {
    if (!discoveryPvgis || kwpEst <= 0 || footprintSumTotal <= 0) return [];
    const perKwpMonthly = discoveryPvgis.monthlyProduction;
    const { monthlyProduction } = getProductionFromPerKwp(
      discoveryPvgis.annualProduction,
      perKwpMonthly,
      kwpEst
    );
    const surfaceM2 = footprintSumTotal;
    const byMonth = discoverySimulationSummary?.batteryByMonth;
    return monthlyProduction.map((m) => {
      const consumption = Math.round(
        getEnergyConsumptionForMonth(discoveryPlaceType, (m.month - 1) as MonthIndex) * surfaceM2
      );
      const base = { month: m.month, production: m.production, consumption };
      if (byMonth?.[m.month - 1]) {
        const b = byMonth[m.month - 1]!;
        return {
          ...base,
          selfConsumptionDirect: b.selfConsumptionDirectKwh,
          selfConsumptionViaBattery: b.selfConsumptionViaBatteryKwh,
          injectionBattery: b.injectionBatteryKwh,
          excess: b.injectionReseauKwh,
          gridDraw: b.gridDrawKwh,
        };
      }
      return base;
    });
  }, [discoveryPvgis, kwpEst, footprintSumTotal, discoverySimulationSummary?.batteryByMonth]);

  const discoveryChartDailyData = useMemo(() => {
    if (!discoveryPvgis || footprintSumTotal <= 0 || kwpEst <= 0) return undefined;
    const perKwpMonthly = discoveryPvgis.monthlyProduction;
    const prodDay = buildTypicalDayForMonth(perKwpMonthly, discoveryChartMonthIndex, kwpEst);
    const consDay = buildTypicalConsumptionDayForMonth(
      discoveryPlaceType,
      discoveryChartMonthIndex,
      footprintSumTotal
    );
    const pack =
      discoverySimulationSummary?.breakdownFromHourlySim && discoveryDailySimulationBattery
        ? discoveryDailySimulationBattery
        : null;
    const batteryForChart =
      discoveryIncludeBattery && pack ? scaleBatteryForCount(pack.ref, pack.count) : null;
    const hourly = runSimulationOneDayForChart(prodDay, consDay, batteryForChart);
    return hourly.map((h, hour) => ({
      hour,
      production: prodDay[hour] ?? 0,
      consumption: consDay[hour] ?? 0,
      selfConsumptionDirect: h.selfConsumptionDirectKwh,
      selfConsumptionViaBattery: h.selfConsumptionViaBatteryKwh,
      injectionBattery: h.injectionBatteryKwh,
      excess: h.injectionReseauKwh,
      gridDraw: h.gridDrawKwh,
    }));
  }, [
    discoveryPvgis,
    footprintSumTotal,
    kwpEst,
    discoveryChartMonthIndex,
    discoveryIncludeBattery,
    discoveryDailySimulationBattery,
    discoverySimulationSummary?.breakdownFromHourlySim,
  ]);

  const discoveryAnnualConsumptionKwh = useMemo(
    () => getEnergyConsumption(discoveryPlaceType) * footprintSumTotal,
    [footprintSumTotal]
  );

  const discoveryBillReductionCard = useMemo(() => {
    const billAnnual = estimateEnergyBillEur(discoveryAnnualConsumptionKwh);
    const pctOfRefBill = (part: number, ref: number) =>
      ref > 0 && Number.isFinite(part) ? (Math.max(0, part) / ref) * 100 : 0;
    const sim = discoverySimulationSummary;
    if (sim?.breakdownFromHourlySim) {
      const retail = DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH;
      const feedIn = DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH;
      const directEurY = Math.max(0, sim.selfConsumptionDirectKwhTotal) * retail;
      const viaBatteryEurY = Math.max(0, sim.selfConsumptionViaBatteryKwhTotal) * retail;
      const injectionEurY = Math.max(0, sim.injectionReseauKwhTotal) * feedIn;
      return {
        periodLabel: "Moyenne mensuelle",
        headlineReductionEur: Math.round(sim.annualSavings / 12),
        segments: [
          {
            id: "direct",
            label: "Autoconso directe",
            monthlyReductionEur: Math.round(directEurY / 12),
            pctOfBill: pctOfRefBill(directEurY, billAnnual),
            variant: "direct" as const,
          },
          {
            id: "battery",
            label: "Autoconso batterie",
            monthlyReductionEur: Math.round(viaBatteryEurY / 12),
            pctOfBill: pctOfRefBill(viaBatteryEurY, billAnnual),
            variant: "battery" as const,
          },
          {
            id: "injection",
            label: "Injection réseau",
            monthlyReductionEur: Math.round(injectionEurY / 12),
            pctOfBill: pctOfRefBill(injectionEurY, billAnnual),
            variant: "injection" as const,
          },
        ],
      };
    }
    const annualProductionKwh = discoveryChartMonthlyData.reduce((s, m) => s + m.production, 0);
    const annualSavings = estimateAnnualSavingsEur(annualProductionKwh, undefined, discoveryAnnualConsumptionKwh);
    const directEurY = Math.min(annualProductionKwh, discoveryAnnualConsumptionKwh) * DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH;
    const injectionEurY = Math.max(0, annualProductionKwh - discoveryAnnualConsumptionKwh) * DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH;
    return {
      periodLabel: "Moyenne mensuelle",
      headlineReductionEur: Math.round(annualSavings / 12),
      segments: [
        { id: "direct", label: "Autoconso directe", monthlyReductionEur: Math.round(directEurY / 12), pctOfBill: pctOfRefBill(directEurY, billAnnual), variant: "direct" as const },
        { id: "battery", label: "Autoconso batterie", monthlyReductionEur: 0, pctOfBill: 0, variant: "battery" as const },
        { id: "injection", label: "Injection réseau", monthlyReductionEur: Math.round(injectionEurY / 12), pctOfBill: pctOfRefBill(injectionEurY, billAnnual), variant: "injection" as const },
      ],
    };
  }, [discoveryChartMonthlyData, discoveryAnnualConsumptionKwh, discoverySimulationSummary]);

  const discoveryBatimentsCount = buildingDetailRows.length;
  const discoveryEntreprisesCount = discoverySiretRows.length;
  const discoveryDisplayedSiretRows = useMemo(
    () =>
      showAllEstablishments
        ? discoverySiretRows
        : discoverySiretRows.slice(0, initialDiscoveryEstablishmentsVisible),
    [showAllEstablishments, discoverySiretRows, initialDiscoveryEstablishmentsVisible]
  );

  /** Nom INSEE (API) si dispo, sinon dénomination JSON ; une seule ligne + `title` pour le texte complet. */
  const discoveryRaisonSocialeDisplay = (
    siren: string | undefined | null,
    denominationJson: string | undefined | null
  ) => {
    const den = (denominationJson || "").trim();
    const s = siren?.trim();
    const lineWrap =
      "block min-w-0 break-words text-xs font-medium leading-relaxed tracking-tight text-foreground";

    if (!s || !/^\d{9}$/.test(s)) {
      const t = den || "—";
      return (
        <span className={lineWrap} title={t}>
          {t}
        </span>
      );
    }
    const st = matchingV5ApiNomBySiren[s];
    if (st?.status === "loading") {
      if (den) {
        return (
          <span className={lineWrap} title={den}>
            {den}
          </span>
        );
      }
      return (
        <span className="inline-block min-w-0 max-w-full" title="Chargement du nom officiel…">
          <Skeleton className="h-4 w-full max-w-[14rem]" aria-hidden />
          <span className="sr-only">Chargement du nom officiel</span>
        </span>
      );
    }
    if (st?.status === "ok" && st.name?.trim()) {
      const t = st.name.trim();
      return (
        <span className={lineWrap} title={t}>
          {t}
        </span>
      );
    }
    const t = den || "—";
    return (
      <span className={lineWrap} title={t}>
        {t}
      </span>
    );
  };

  const discoveryValueTd = (
    value: string,
    monoOrOpts?: boolean | { mono?: boolean; singleLine?: boolean }
  ) => {
    const opts = typeof monoOrOpts === "boolean" ? { mono: monoOrOpts } : monoOrOpts ?? {};
    const mono = opts.mono ?? false;
    const singleLine = opts.singleLine ?? false;
    const v = value.trim() || "—";
    return (
      <TableCell className={cn("min-w-0 text-xs leading-relaxed", mono && "font-mono")}>
        <span
          className={cn("block min-w-0", singleLine ? "truncate whitespace-nowrap" : "break-words")}
          title={v !== "—" ? v : undefined}
        >
          {v}
        </span>
      </TableCell>
    );
  };

  const terrainDetailParcelles = useMemo(() => {
    if (parcelleCluster.length > 0) return parcelleCluster;
    if (row.grain === "parcelle") return [row];
    return [];
  }, [parcelleCluster, row]);
  const informationParcellesRows = useMemo(
    () =>
      [...terrainDetailParcelles].sort((a, b) => {
        const sectionCmp = (a.section || "").localeCompare(b.section || "");
        if (sectionCmp !== 0) return sectionCmp;
        const numeroCmp = (a.numeroNorm || "").localeCompare(b.numeroNorm || "");
        if (numeroCmp !== 0) return numeroCmp;
        return (a.label || "").localeCompare(b.label || "");
      }),
    [terrainDetailParcelles]
  );

  const opConfidenceForLetter = useMemo(() => {
    if (parcelleCluster.length === 0) return row.matchingConfidence;
    return Math.max(...parcelleCluster.map((p) => p.matchingConfidence), row.matchingConfidence);
  }, [parcelleCluster, row.matchingConfidence]);
  const opScoreLetter = operationalScoreLetterFromMatching(opConfidenceForLetter);

  const heroAddress = useMemo(
    () => formatDiscoveryDrawerHeroAddress(row, parcelleCluster),
    [row, parcelleCluster]
  );

  const discoveryRecapShowBdnb = Number.isFinite(footprintSumTotal) && footprintSumTotal > 0;
  const discoveryRecapShowParcel = Number.isFinite(cartePolygonAreaM2) && cartePolygonAreaM2 > 0;
  const discoveryRecapShowAzimuth = discoveryFootprintAzimuth != null;
  const discoveryAzimuthDisplay =
    discoveryFootprintAzimuth == null
      ? null
      : new Intl.NumberFormat("fr-FR", {
          maximumFractionDigits: 1,
          minimumFractionDigits: 0,
          signDisplay: "exceptZero",
        }).format(discoveryFootprintAzimuth) + "°";
  const discoveryParcelSurfaceTitle =
    row.grain === "parcelle"
      ? parcelleCluster.length > 1
        ? "Somme des aires des polygones parcelles (approx. géodésique locale)"
        : "Aire du polygone parcelle sur la carte (approx. géodésique locale)"
      : "Aire du polygone affiché (bâtiment) sur la carte";

  const geoPillLabel = (() => {
    const n = (row.nomIris || "").trim().replace(/\s+/g, " ");
    if (n) return n.slice(0, 26).toUpperCase();
    const ci = (row.codeInsee || "").trim();
    if (ci.length >= 2) return `DEPT. ${ci.slice(0, 2)}`;
    return "ZONE";
  })();
  const kwcRounded = `${Math.round(kwpEst)} kWc`;

  return (
    <GoogleMapsLoader blockingLoad={false}>
    <Tabs
      value={discoveryMainTab}
      onValueChange={setDiscoveryMainTab}
      variant="line"
      className="drawer-discovery"
    >
      <div className="drawer-discovery-hero">
        <h3 className="drawer-discovery-title" title={row.label}>
          {row.label}
        </h3>
        <p className="drawer-discovery-hero-address" title={heroAddress}>
          {heroAddress}
        </p>
        {discoveryRecapShowBdnb || discoveryRecapShowParcel || discoveryRecapShowAzimuth ? (
          <div className="flex w-full flex-nowrap gap-3 border-b border-border/80 pb-2.5 pt-0.5 sm:gap-4">
            {discoveryRecapShowBdnb ? (
              <div
                className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-1 text-center"
                title="Empreinte au sol des bâtiments (BDNB, Σ footprint)"
              >
                <Image
                  src="/Buildingicon.svg"
                  alt=""
                  width={28}
                  height={28}
                  className="size-7 shrink-0 object-contain"
                  aria-hidden
                />
                <span className="font-sans text-xs font-medium tabular-nums tracking-tight text-foreground">
                  {Math.round(footprintSumTotal).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} m²
                </span>
                <span className={cn(radianzMonoLabelClass, "max-w-full text-pretty text-[9px] leading-snug")}>
                  Surface building
                </span>
              </div>
            ) : null}
            {discoveryRecapShowParcel ? (
              <div
                className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-1 text-center"
                title={discoveryParcelSurfaceTitle}
              >
                <span className="flex size-7 shrink-0 items-center justify-center" aria-hidden>
                  <Image
                    src="/Topoicon.svg"
                    alt=""
                    width={28}
                    height={28}
                    className="size-7 object-contain opacity-90"
                  />
                </span>
                <span className="font-sans text-xs font-medium tabular-nums tracking-tight text-foreground">
                  {Math.round(cartePolygonAreaM2).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} m²
                </span>
                <span className={cn(radianzMonoLabelClass, "max-w-full text-pretty text-[9px] leading-snug")}>
                  Surface parcelle
                </span>
              </div>
            ) : null}
            {discoveryRecapShowAzimuth && discoveryAzimuthDisplay ? (
              <div
                className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-1 text-center"
                title="Azimut PVGIS déduit de l’empreinte (0° = plein sud, 90° = ouest, −90° = est) — heuristique du plus long côté du polygone, identique à l’appel PVGIS de ce panneau."
              >
                <span className="flex size-7 shrink-0 items-center justify-center" aria-hidden>
                  <Image
                    src="/surfaceicon.svg"
                    alt=""
                    width={28}
                    height={28}
                    className="size-7 object-contain opacity-90"
                  />
                </span>
                <span className="font-sans text-xs font-medium tabular-nums tracking-tight text-foreground">
                  {discoveryAzimuthDisplay}
                </span>
                <span className={cn(radianzMonoLabelClass, "max-w-full text-pretty text-[9px] leading-snug")}>
                  Azimut toit
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="drawer-discovery-pills">
          <Badge
            variant="lime"
            className="h-6 min-h-6 rounded-md border-0 px-2 py-0 text-[10px] font-semibold uppercase leading-none tracking-wide ring-1 ring-ring/32 shadow-[0_1px_0_rgb(0_0_0/0.06)] transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-xs"
            title={`Score opérationnel (matching V5) : ${scoreDisplay}`}
          >
            Score {opScoreLetter}
          </Badge>
          <Badge
            variant="outline"
            className="h-6 min-h-6 rounded-md border-0 bg-foreground px-2 py-0 text-[10px] font-semibold uppercase leading-none tracking-wide text-background shadow-[0_1px_0_rgb(0_0_0/0.1)] transition-[transform,box-shadow] duration-200 hover:bg-foreground/90 hover:-translate-y-px hover:shadow-xs"
          >
            {kwcRounded}
          </Badge>
          <Badge
            variant="outline"
            className="h-6 min-h-6 rounded-md border border-border bg-muted/80 px-2 py-0 text-[10px] font-semibold uppercase leading-none tracking-wide text-foreground backdrop-blur-[2px] transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-xs"
            title={row.nomIris || row.codeInsee}
          >
            {geoPillLabel}
          </Badge>
          {multiEntreprises ? (
            <Badge
              variant="secondary"
              className="h-6 min-h-6 rounded-md border border-primary/40 px-2 py-0 text-[10px] font-semibold uppercase leading-none tracking-wide transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-xs"
            >
              Multi-entreprises
            </Badge>
          ) : null}
          {parcelleCluster.length > 1 ? (
            <Badge
              variant="secondary"
              className="h-6 min-h-6 rounded-md border border-primary/40 px-2 py-0 text-[10px] font-semibold uppercase leading-none tracking-wide transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-xs"
              title="Même composante connexe via bâtiments en statut « partage » (matching V5)"
            >
              {parcelleCluster.length} cadastres liés
            </Badge>
          ) : null}
        </div>
      </div>

      <TabsList className="w-full min-w-0">
        <TabsTrigger value="batiments" className="inline-flex items-center gap-1.5">
          <span>Informations</span>
          <span
            className="rounded px-1 py-px text-[0.625rem] font-medium tabular-nums text-muted-foreground"
            aria-label={`${discoveryBatimentsCount} bâtiment${discoveryBatimentsCount !== 1 ? "s" : ""}`}
          >
            {discoveryBatimentsCount}
          </span>
        </TabsTrigger>
        <TabsTrigger value="solaire">Solaire</TabsTrigger>
        <TabsTrigger value="terrain" className="inline-flex items-center gap-1.5">
          <span>Contact</span>
          <span
            className="rounded px-1 py-px text-[0.625rem] font-medium tabular-nums text-muted-foreground"
            aria-label={`${discoveryMergedPois.length} point${discoveryMergedPois.length !== 1 ? "s" : ""} d'intérêt détecté${discoveryMergedPois.length !== 1 ? "s" : ""}`}
          >
            {discoveryMergedPois.length}
          </span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="terrain" className="drawer-discovery-panel space-y-4">
        <section aria-labelledby="discovery-terrain-poi">
          <h4
            id="discovery-terrain-poi"
            className="drawer-discovery-section-title flex items-center justify-between gap-3"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Image
                src="/layericon.svg"
                alt=""
                width={44}
                height={44}
                className="size-11 shrink-0"
                aria-hidden
              />
              <span className="truncate text-base uppercase tracking-tight text-black">POI à proximité</span>
            </span>
            <span className="ml-auto inline-flex min-w-8 items-center justify-center font-mono text-[0.7rem] font-normal text-foreground">
              {discoveryMergedPois.length}
            </span>
          </h4>
          <DiscoveryDrawerMergedPoiBlock
            pois={discoveryMergedPois}
            showTitle={false}
            onNearbySearch={discoveryMergedPois.length === 0 ? handleDiscoveryLiveNearbySearch : undefined}
            nearbySearchPending={nearbyLivePending}
          />
        </section>

        <section aria-labelledby="discovery-terrain-ppm" className="space-y-3 border-t border-border pt-5">
          <h4
            id="discovery-terrain-ppm"
            className="drawer-discovery-section-title flex items-center justify-between gap-3"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Image
                src="/Topoicon.svg"
                alt=""
                width={44}
                height={44}
                className="size-11 shrink-0"
                aria-hidden
              />
              <span className="truncate text-base uppercase tracking-tight text-black">Passerelle</span>
            </span>
            <span className="ml-auto inline-flex min-w-8 items-center justify-center font-mono text-[0.7rem] font-normal text-foreground">
              {passerelleFlat.length}
            </span>
          </h4>
          {passerelleFlat.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-3 text-[0.6875rem] text-muted-foreground">
              Aucune information Passerelle disponible pour{" "}
              {parcelleCluster.length > 1 ? "ces parcelles" : "cette parcelle"} pour le moment.
            </div>
          ) : (
            <div className="drawer-discovery-table-wrap">
              <Table className="text-[11px]">
                <TableHeader>
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableHead className="min-w-[11rem]">Nom</TableHead>
                    <TableHead className="whitespace-nowrap">SIREN</TableHead>
                    <TableHead className="whitespace-nowrap">Parcelle</TableHead>
                    <TableHead className="min-w-[10rem]">Adresse</TableHead>
                    <TableHead className="whitespace-nowrap text-right">N</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {passerelleFlat.map(({ parcelleLabel, ppm: p }, i) => {
                    const siren = String(p.siren || "").trim() || "—";
                    const sirenHref =
                      /^\d{9}$/.test(siren) ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}` : null;
                    const key = `${parcelleLabel}-${siren}-${i}`;
                    const addrPpm = (p.address || "").trim() || "—";
                    return (
                      <TableRow key={key} className="border-0">
                        <TableCell className="min-w-0 align-top">
                          <span className="line-clamp-2 break-words" title={String(p.denomination || "").trim() || undefined}>
                            {discoveryRaisonSocialeDisplay(p.siren, p.denomination)}
                          </span>
                        </TableCell>
                        <TableCell className="min-w-0 whitespace-nowrap font-mono align-top">
                          {sirenHref ? (
                            <a
                              href={sirenHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Voir la fiche État (${siren})`}
                            >
                              <Badge
                                variant="solid"
                                className="h-5 min-h-5 rounded-md border-0 bg-foreground px-1.5 py-0 text-[9px] font-semibold uppercase leading-none tracking-wide text-background shadow-[0_1px_0_rgb(0_0_0/0.1)] transition-[box-shadow] duration-200 hover:bg-foreground/90 hover:shadow-xs cursor-pointer"
                              >
                                {siren}
                                <ChevronRight className="h-2.5 w-2.5 opacity-90" />
                              </Badge>
                            </a>
                          ) : (
                            <span title={siren !== "—" ? siren : undefined}>{siren}</span>
                          )}
                        </TableCell>
                        <TableCell className="min-w-0 whitespace-nowrap font-mono align-top text-muted-foreground">
                          {parcelleLabel}
                        </TableCell>
                        <TableCell className="min-w-0 align-top text-muted-foreground">
                          <span
                            className="block truncate"
                            title={addrPpm !== "—" ? addrPpm : undefined}
                          >
                            {addrPpm}
                          </span>
                        </TableCell>
                        <TableCell className="min-w-0 whitespace-nowrap text-right font-mono tabular-nums">
                          {p.rows != null && Number.isFinite(Number(p.rows)) ? String(p.rows) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section aria-labelledby="discovery-terrain-entreprises" className="space-y-3 border-t border-border pt-5">
          <h4
            id="discovery-terrain-entreprises"
            className="drawer-discovery-section-title flex items-center justify-between gap-3"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Image
                src="/houseicon.svg"
                alt=""
                width={44}
                height={44}
                className="size-11 shrink-0"
                aria-hidden
              />
              <span className="truncate text-base uppercase tracking-tight text-black">Établissements</span>
            </span>
            <span className="ml-auto inline-flex min-w-8 items-center justify-center font-mono text-[0.7rem] font-normal text-foreground">
              {discoverySiretRows.length}
            </span>
          </h4>
          <div className="drawer-discovery-table-wrap">
            <div className="drawer-entity-list">
              {discoverySiretRows.length === 0 ? (
                <div className="drawer-entity-list-empty">
                  Aucun établissement trouvé pour cette adresse pour le moment.
                </div>
              ) : (
                <>
                  <div className="drawer-entity-plain-table-wrap">
                    <Table className="drawer-entity-plain-table text-[11px]">
                      <TableHeader>
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className="min-w-[11rem]">Nom</TableHead>
                          <TableHead className="whitespace-nowrap">SIREN</TableHead>
                          <TableHead className="min-w-[6.5rem]">Gérant</TableHead>
                          <TableHead className="whitespace-nowrap">SIRET</TableHead>
                          <TableHead className="whitespace-nowrap">NAF</TableHead>
                          <TableHead className="whitespace-nowrap">Effectifs</TableHead>
                          <TableHead className="min-w-[8rem]">Adresse</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {discoveryDisplayedSiretRows.map((r) => {
                          const e = r.e;
                          const gouv = discoveryGouvEtabBySiret[e.siret];
                          const nafFromJson = (e.activite_principale || "").trim();
                          const nafFromApi = gouv?.status === "ok" ? (gouv.naf || "").trim() : "";
                          const naf = nafFromJson || nafFromApi;
                          const trancheCode =
                            (e.tranche_effectifs || "").trim() ||
                            (gouv?.status === "ok" ? gouv.tranche || "" : "");
                          const effYearJson = (e.annee_effectifs || "").trim();
                          const effYearApi = gouv?.status === "ok" ? (gouv.annee || "").trim() : "";
                          const effYear = effYearJson || effYearApi;
                          const effLib = labelTrancheEffectifs(trancheCode || undefined);
                          const effectifsCell =
                            gouv?.status === "loading" && !trancheCode ? (
                              <Skeleton className="h-3.5 w-[min(100%,7.5rem)] max-w-full" aria-hidden />
                            ) : effLib === "—" && !effYear ? (
                              "—"
                            ) : effYear ? (
                              `${effLib} (${effYear})`
                            ) : (
                              effLib
                            );
                          const nafCell =
                            gouv?.status === "loading" && !naf ? (
                              <Skeleton className="h-3.5 w-[min(100%,6rem)] max-w-full" aria-hidden />
                            ) : (
                              naf || "—"
                            );
                          const manager =
                            (gouv?.status === "ok" ? gouv.manager || "" : "").trim() || "—";
                          const siren = (e.siren || "").trim();
                          const sirenHref =
                            /^\d{9}$/.test(siren)
                              ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`
                              : null;
                          const addr = (e.adresse_etablissement || "").trim() || "—";
                          return (
                            <TableRow key={r.key} className="border-0">
                              <TableCell className="min-w-[11rem] align-top">
                                <span
                                  className="block truncate"
                                  title={String(e.denomination || "").trim() || undefined}
                                >
                                  {discoveryRaisonSocialeDisplay(e.siren, e.denomination)}
                                </span>
                              </TableCell>
                              <TableCell className="min-w-0 whitespace-nowrap font-mono align-top">
                                {sirenHref ? (
                                  <a
                                    href={sirenHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`Voir la fiche État (${siren})`}
                                  >
                                    <Badge
                                      variant="solid"
                                      className="h-5 min-h-5 rounded-md border-0 bg-foreground px-1.5 py-0 text-[9px] font-semibold uppercase leading-none tracking-wide text-background shadow-[0_1px_0_rgb(0_0_0/0.1)] transition-[box-shadow] duration-200 hover:bg-foreground/90 hover:shadow-xs cursor-pointer"
                                    >
                                      {siren}
                                      <ChevronRight className="h-3 w-3 opacity-90" />
                                    </Badge>
                                  </a>
                                ) : (
                                  <span title={siren || undefined}>{siren || "—"}</span>
                                )}
                              </TableCell>
                              <TableCell className="min-w-[6.5rem] align-top text-muted-foreground">
                                <span className="block truncate" title={manager !== "—" ? manager : undefined}>
                                  {manager}
                                </span>
                              </TableCell>
                              <TableCell className="min-w-0 whitespace-nowrap font-mono align-top">
                                <span title={e.siret}>{e.siret}</span>
                              </TableCell>
                              <TableCell className="min-w-0 align-top font-mono">
                                <span className="block truncate" title={typeof nafCell === "string" ? nafCell : undefined}>
                                  {nafCell}
                                </span>
                              </TableCell>
                              <TableCell className="min-w-0 align-top">
                                <span
                                  className="block truncate"
                                  title={typeof effectifsCell === "string" ? effectifsCell : undefined}
                                >
                                  {effectifsCell}
                                </span>
                              </TableCell>
                              <TableCell className="min-w-[8rem] align-top text-muted-foreground">
                                <span className="block truncate" title={addr !== "—" ? addr : undefined}>
                                  {addr}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {discoverySiretRows.length > initialDiscoveryEstablishmentsVisible ? (
                    <div className="px-3 pb-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-md px-2.5 font-mono text-[10px] uppercase tracking-[0.08em]"
                        onClick={() => setShowAllEstablishments((prev) => !prev)}
                      >
                        {showAllEstablishments ? "View less" : `View all (${discoverySiretRows.length})`}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </section>
      </TabsContent>

      <TabsContent value="solaire" className="drawer-discovery-panel space-y-3">
        {discoveryPvgisLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-[300px] w-full rounded-xl" />
          </div>
        ) : discoveryPvgisError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            {discoveryPvgisError}
          </div>
        ) : discoveryChartMonthlyData.length > 0 ? (
          <div className="space-y-4">
            <ProspectEnergyChartsPanel
              configurationModeKey=""
              annualProductionKwh={discoveryChartMonthlyData.reduce((s, m) => s + m.production, 0)}
              chartViewMode={discoveryChartViewMode}
              onChartViewModeChange={setDiscoveryChartViewMode}
              chartSelectedMonthIndex={discoveryChartMonthIndex}
              onChartSelectedMonthIndexChange={setDiscoveryChartMonthIndex}
              data={discoveryChartMonthlyData}
              dailyData={discoveryChartDailyData}
              includeBattery={discoveryIncludeBattery}
              onIncludeBatteryChange={onDiscoveryIncludeBatteryChange}
            />
            <div className="flex w-full flex-col gap-4">
              <RadianzBillReductionCard
                periodLabel={discoveryBillReductionCard.periodLabel}
                initialBillAnnualEur={estimateEnergyBillEur(discoveryAnnualConsumptionKwh)}
                headlineReductionEur={discoveryBillReductionCard.headlineReductionEur}
                segments={discoveryBillReductionCard.segments}
              />
              <RadianzCo2AvoidanceRadial
                annualProductionKwh={discoveryChartMonthlyData.reduce((s, m) => s + m.production, 0)}
                annualConsumptionKwh={discoveryAnnualConsumptionKwh}
              />
            </div>
            {pipelineProject ? (
              <DiscoverySolaireProjectCards
                summary={pipelineProject.summary}
                surfaceM2={pipelineProject.surfaceM2}
              />
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
            Aucune donnée de production disponible pour ce bâtiment.
          </div>
        )}
      </TabsContent>

      <TabsContent value="batiments" className="drawer-discovery-panel space-y-3">
        <section aria-labelledby="discovery-info-building">
          <h4
            id="discovery-info-building"
            className="drawer-discovery-section-title flex items-center justify-between gap-3"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Image
                src="/Buildingicon.svg"
                alt=""
                width={44}
                height={44}
                className="size-11 shrink-0"
                aria-hidden
              />
              <span className="truncate text-base uppercase tracking-tight text-black">Building</span>
            </span>
            <span className="ml-auto inline-flex min-w-8 items-center justify-center font-mono text-[0.7rem] font-normal text-foreground">
              {buildingDetailRows.length}
            </span>
          </h4>
          {buildingDetailRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
              Aucun détail bâtiment dans l’export pour cette entité (parcelle sans{" "}
              <span className="font-mono text-foreground/80">buildings_json</span> ou bâtiment non renseigné).
            </div>
          ) : (
            <div className="drawer-discovery-table-wrap">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableHead className="whitespace-nowrap">N°</TableHead>
                    <TableHead className="whitespace-nowrap">Année</TableHead>
                    <TableHead className="whitespace-nowrap">Empreinte</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buildingDetailRows.map((b, i) => (
                    <TableRow key={`${b.batimentConstructionId}-${i}`} className="border-0">
                      <TableCell
                        className="min-w-0 whitespace-nowrap font-mono tabular-nums"
                        title={
                          b.batimentConstructionId && b.batimentConstructionId !== "—"
                            ? `Rang ${i + 1} · construction BDNB : ${b.batimentConstructionId}${
                                b.batimentGroupeId ? ` · groupe : ${b.batimentGroupeId}` : ""
                              }`
                            : `Rang ${i + 1}`
                        }
                      >
                        {i + 1}
                      </TableCell>
                      <TableCell className="min-w-0 whitespace-nowrap font-mono tabular-nums">
                        {b.anneeConstruction != null ? b.anneeConstruction : "—"}
                      </TableCell>
                      <TableCell className="min-w-0 whitespace-nowrap font-mono tabular-nums">
                        {b.footprintM2 != null
                          ? `${b.footprintM2.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} m²`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section aria-labelledby="discovery-info-parcelles" className="space-y-3 border-t border-border pt-5">
          <h4
            id="discovery-info-parcelles"
            className="drawer-discovery-section-title flex items-center justify-between gap-3"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Image
                src="/Topoicon.svg"
                alt=""
                width={44}
                height={44}
                className="size-11 shrink-0"
                aria-hidden
              />
              <span className="truncate text-base uppercase tracking-tight text-black">Parcelle</span>
            </span>
            <span className="ml-auto inline-flex min-w-8 items-center justify-center font-mono text-[0.7rem] font-normal text-foreground">
              {informationParcellesRows.length}
            </span>
          </h4>
          {informationParcellesRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
              Aucune parcelle liée.
            </div>
          ) : (
            <div className="drawer-discovery-table-wrap">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableHead className="whitespace-nowrap">N°</TableHead>
                    <TableHead className="whitespace-nowrap">Numéro</TableHead>
                    <TableHead className="whitespace-nowrap">Surface</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {informationParcellesRows.map((parcelle, i) => {
                    const numero = `${parcelle.section || "—"} ${parcelle.numeroNorm || "—"}`.trim();
                    const surfaceM2 = polygonAreaM2ApproxWgs84(parcelle.geometry);
                    const surfaceLabel = `${surfaceM2.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} m²`;
                    return (
                      <TableRow key={`${parcelle.id}-${i}`} className="border-0">
                        <TableCell className="min-w-0 whitespace-nowrap font-mono tabular-nums">
                          {i + 1}
                        </TableCell>
                        <TableCell className="min-w-0 whitespace-nowrap font-mono">
                          {numero}
                        </TableCell>
                        <TableCell className="min-w-0 whitespace-nowrap font-mono tabular-nums text-muted-foreground">
                          <span className="block min-w-0 text-foreground" title={surfaceLabel}>
                            {surfaceLabel}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </TabsContent>

    </Tabs>
    </GoogleMapsLoader>
  );
}

interface ProspectDrawerProps {
  prospect: Prospect | null;
  /** Indique que le fetch BDNB est en cours (clic POI sans données pré-chargées) */
  bdnbLoading?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToPipeline?: () => void;
  onSaveSuccess?: () => void;
  /** Patch fusionné dans le state parent (éviter `...prospect` depuis une closure async). */
  onProspectUpdate?: (patch: Partial<Prospect>) => void;
  voirHref?: (prospectId: string) => string;
  /** Mode découverte matching V5 (carte / tiroir sans prospect Firestore). */
  discoveryRow?: ScoutMatchingV5Row | null;
  /** Parcelles du même groupe (transitif « partage » ou bâtiment multi-parcelles). Défaut : parcelle seule. */
  discoveryLinkedParcelleRows?: ScoutMatchingV5Row[] | null;
  /** Prospect déjà en pipeline pour cette sélection (Découverte) — désactive l’ajout et affiche l’état. */
  discoveryExistingPipelineProspect?: Prospect | null;
  /** Après ajout pipeline depuis Discovery : invalider la liste (ex. `mutate` SWR côté page). */
  onDiscoveryPipelineAdded?: () => void;
  /** Après enregistrement POI Google live en base (Découverte) : ex. forcer un refetch des features. */
  onDiscoveryMatchingV5Persisted?: () => void;
}

export function ProspectDrawer({
  prospect,
  bdnbLoading = false,
  isOpen,
  onOpenChange,
  onAddToPipeline,
  onSaveSuccess,
  onProspectUpdate,
  voirHref = (_id) => "/discovery",
  discoveryRow = null,
  discoveryLinkedParcelleRows = null,
  discoveryExistingPipelineProspect = null,
  onDiscoveryPipelineAdded,
  onDiscoveryMatchingV5Persisted,
}: ProspectDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isOnMap = pathname?.includes("/solar-scout") ?? false;
  const isOnDiscovery = pathname?.includes("/discovery") ?? false;
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [address, setAddress] = useState(prospect?.address || "");
  const [isLoadingPVGIS, setIsLoadingPVGIS] = useState(false);
  const [pvgisError, setPvgisError] = useState<string | null>(null);
  const [chartViewMode, setChartViewMode] = useState<"monthly" | "daily">("monthly");
  const [chartSelectedMonthIndex, setChartSelectedMonthIndex] = useState(0);
  const [usedPanelRef, setUsedPanelRef] = useState<PanelReference | null>(null);
  const [usedInverterRef, setUsedInverterRef] = useState<InverterReference | null>(null);
  const [usedBatteryRef, setUsedBatteryRef] = useState<BatteryReference | null>(null);
  const [batteryCount, setBatteryCount] = useState(() =>
    prospect?.batteryCount != null && prospect.batteryCount >= 1 ? prospect.batteryCount : 1
  );
  /** "highest_production" = max surface utilisée | "perfect_fit" = production ≈ consommation */
  const [configurationMode, setConfigurationMode] = useState<"highest_production" | "perfect_fit">("highest_production");
  const [companyEnrichmentLoading, setCompanyEnrichmentLoading] = useState(false);
  const [phase2Scoring, setPhase2Scoring] = useState<ScoredCandidate[] | null>(null);
  const [phase2ScoringLoading, setPhase2ScoringLoading] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  /** PVGIS + kWp + surface (mode Découverte) pour fourchette prix / B-E pipeline. */
  const [discoveryPipelineFinanceInputs, setDiscoveryPipelineFinanceInputs] =
    useState<DiscoveryDrawerFinancialInputs | null>(null);
  const [discoveryIncludeBattery, setDiscoveryIncludeBattery] = useState(
    () => getSolarEquipmentSettings().includeBattery ?? true
  );
  const { user } = useAuth();

  /** Mis à true uniquement au clic sur Perfect fit / Highest production — resync batterie quand la cible kWh change. */
  const pendingBatteryResyncAfterModeChangeRef = useRef(false);

  const handlePoiNavigate = useCallback(
    async (delta: -1 | 1) => {
      if (!onProspectUpdate || !prospect?.poiCandidates?.length) return;
      const candidates = prospect.poiCandidates;
      const n = candidates.length;
      const idx = prospect.poiCandidateIndex ?? 0;
      const next = idx + delta;
      if (next < 0 || next >= n) return;
      const c = candidates[next]!;
      const poiCoordinates =
        c.coordinates != null
          ? { lat: c.coordinates.lat, lng: c.coordinates.lng }
          : undefined;
      const clearCompany: Partial<Prospect> = {
        siren: undefined,
        siret: undefined,
        companyLegalName: undefined,
        companyManagerName: undefined,
        companyAddress: undefined,
        companyNaf: undefined,
        companyTrancheEffectif: undefined,
        companyEnrichmentApiUrl: undefined,
        companyPhone: undefined,
      };
      if (!c.placeId) {
        onProspectUpdate({
          ...clearCompany,
          name: c.name,
          placeId: c.placeId,
          poiCandidateIndex: next,
          poiCoordinates,
        });
        return;
      }
      const placeDetails = await getPlaceDetailsNew(c.placeId);
      if (!placeDetails) {
        onProspectUpdate({
          ...clearCompany,
          name: c.name,
          placeId: c.placeId,
          poiCandidateIndex: next,
          poiCoordinates,
        });
        return;
      }
      const fullAddress = placeDetails.formattedAddress;
      const displayName = placeDetails.displayName ?? c.name;
      const placeType = (placeDetails.primaryTypeDisplayName ?? "other") as Prospect["placeType"];
      const contact =
        placeDetails.nationalPhoneNumber || placeDetails.internationalPhoneNumber
          ? {
              nationalPhoneNumber: placeDetails.nationalPhoneNumber ?? undefined,
              internationalPhoneNumber: placeDetails.internationalPhoneNumber ?? undefined,
              websiteUri: placeDetails.websiteURI ?? undefined,
            }
          : undefined;
      onProspectUpdate({
        ...clearCompany,
        name: displayName,
        placeId: c.placeId,
        placeType,
        poiCandidateIndex: next,
        poiCoordinates,
        contact,
        ...(fullAddress != null ? { address: fullAddress } : {}),
      });
    },
    [onProspectUpdate, prospect]
  );

  // Enrichissement api.gouv : un seul appel find-local-siren si GPS + nom + adresse, sinon recherche-entreprises (priorité rue).
  useEffect(() => {
    if (!isOpen || !prospect) {
      setPhase2Scoring(null);
      return;
    }
    if (!onProspectUpdate) return;

    const hasQuery = !!(prospect.name?.trim() || prospect.address?.trim());
    if (!hasQuery || prospect.siren) return;

    const name = prospect.name?.trim();
    const address = prospect.address?.trim();
    const lat = prospect.poiCoordinates?.lat ?? prospect.coordinates?.lat;
    const lng = prospect.poiCoordinates?.lng ?? prospect.coordinates?.lng;
    const canResolveLocal = !!(
      name &&
      address &&
      lat != null &&
      lng != null &&
      Number.isFinite(lat) &&
      Number.isFinite(lng)
    );

    let cancelled = false;
    setCompanyEnrichmentLoading(true);
    setPhase2ScoringLoading(canResolveLocal);
    setPhase2Scoring(null);

    const applyEnrichment = (enrichment: EnrichmentResult, winningQuery: string | null) => {
      if (cancelled || !onProspectUpdate) return;
      logPolygonDrawer("drawer:applyEnrichment", {
        closureSurfaces: prospect.roofSurfaces?.length ?? 0,
        closureRoofArea: prospect.roofSurface?.area,
        siren: enrichment.siren,
      });
      // Ne pas spread `prospect` : la closure peut être périmée et réécraser adresse / POI.
      onProspectUpdate({
        siren: enrichment.siren ?? prospect.siren,
        siret: enrichment.siret ?? prospect.siret,
        companyLegalName: enrichment.companyLegalName ?? prospect.companyLegalName,
        companyManagerName: enrichment.companyManagerName ?? prospect.companyManagerName,
        companyAddress: enrichment.companyAddress ?? prospect.companyAddress,
        companyNaf: enrichment.companyNaf ?? prospect.companyNaf,
        companyTrancheEffectif: enrichment.companyTrancheEffectif ?? prospect.companyTrancheEffectif,
        companyEnrichmentApiUrl: winningQuery ? buildApiGouvSearchUrl(winningQuery) : undefined,
      });
    };

    const run = async () => {
      if (canResolveLocal) {
        const params = new URLSearchParams({
          poiName: name!,
          address: address!,
          lat: String(lat!),
          lon: String(lng!),
        });
        const res = await fetch(`/api/find-local-siren?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          enrichment: EnrichmentResult | null;
          winningQuery: string | null;
          phase2Scoring: ScoredCandidate[] | null;
        };
        if (cancelled) return;
        if (data.enrichment) {
          applyEnrichment(data.enrichment, data.winningQuery ?? null);
        }
        setPhase2Scoring(data.phase2Scoring ?? null);
        return;
      }

      const { enrichment, winningQuery } = await fetchCompanyEnrichment(prospect);
      if (cancelled || !enrichment) return;
      applyEnrichment(enrichment, winningQuery);
      setPhase2Scoring(null);
    };

    run()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setCompanyEnrichmentLoading(false);
          setPhase2ScoringLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prospect utilisé dans applyEnrichment ; deps granulaires pour éviter re-fetch inutile
  }, [
    isOpen,
    prospect?.id,
    prospect?.name,
    prospect?.address,
    prospect?.siren,
    prospect?.coordinates?.lat,
    prospect?.coordinates?.lng,
    prospect?.poiCoordinates?.lat,
    prospect?.poiCoordinates?.lng,
    prospect?.placeId,
    prospect?.poiCandidateIndex,
    onProspectUpdate,
  ]);

  const { data: panelsData } = usePanelReferences(user?.uid ?? null);
  const { data: invertersData } = useInverterReferences(user?.uid ?? null);
  const { data: batteriesData } = useBatteryReferences(user?.uid ?? null);

  useEffect(() => {
    if (discoveryRow) {
      setDiscoveryIncludeBattery(getSolarEquipmentSettings().includeBattery ?? true);
    }
  }, [discoveryRow]);

  const discoveryRecommendedBatteryKwh = useMemo(() => {
    const inputs = discoveryPipelineFinanceInputs;
    if (!inputs || inputs.monthlyPerKwp.length !== 12 || inputs.kwp <= 0 || inputs.footprintM2 <= 0) {
      return null;
    }
    const placeType = "other";
    const annualConsumptionKwh = getEnergyConsumption(placeType) * inputs.footprintM2;
    const annualProductionKwh = Math.round(inputs.annualPerKwp * inputs.kwp);
    return computeRecommendedBatteryTargetKwh({
      productionPerKwpMonthly: inputs.monthlyPerKwp,
      effectiveKwp: inputs.kwp,
      annualProductionKwh,
      annualConsumptionKwh,
      placeType,
      surfaceM2: inputs.footprintM2,
    });
  }, [discoveryPipelineFinanceInputs]);

  const discoveryRecommendedBatteryComposition = useMemo(() => {
    const visible = (batteriesData ?? []).filter((b) => b.visible !== false);
    if (!visible.length || discoveryRecommendedBatteryKwh == null) return null;
    return pickRecommendedBatteryComposition(discoveryRecommendedBatteryKwh, visible);
  }, [batteriesData, discoveryRecommendedBatteryKwh]);

  const discoverySimBattery = useMemo(() => {
    if (!discoveryRow || !discoveryPipelineFinanceInputs) return null;
    const visibleBatteries = (batteriesData ?? []).filter((b) => b.visible !== false);
    if (!visibleBatteries.length) return { ref: null as BatteryReference | null, count: 1 };
    const composed = discoveryRecommendedBatteryComposition;
    const ref =
      composed?.model ??
      (usedBatteryRef && visibleBatteries.some((b) => b.id === usedBatteryRef.id)
        ? usedBatteryRef
        : visibleBatteries.find((r) => r.recommended === true) ?? visibleBatteries[0] ?? null);
    const count =
      composed != null && ref?.id === composed.model.id
        ? composed.count
        : Math.max(1, batteryCount);
    return { ref, count };
  }, [
    discoveryRow,
    discoveryPipelineFinanceInputs,
    batteriesData,
    discoveryRecommendedBatteryComposition,
    usedBatteryRef,
    batteryCount,
  ]);

  const discoveryDailySimulationBattery = useMemo((): { ref: BatteryReference; count: number } | null => {
    if (!discoveryIncludeBattery) return null;
    const b = discoverySimBattery;
    if (!b?.ref) return null;
    return { ref: b.ref, count: Math.max(1, b.count) };
  }, [discoveryIncludeBattery, discoverySimBattery]);

  // Équipement propre au prospect : initialiser depuis prospect.panelReferenceId / etc. ou recommandé global
  useEffect(() => {
    if (!isOpen || !panelsData) return;
    // Panneaux : un seul modèle "visible" doit être utilisé. Compat legacy : si `visible` est absent partout,
    // on retombe sur la logique recommended/premier.
    const visible = panelsData.find((r) => r.visible === true);
    const legacyPick =
      (prospect?.panelReferenceId ? panelsData.find((r) => r.id === prospect.panelReferenceId) : null) ??
      panelsData.find((r) => r.recommended === true) ??
      panelsData[0] ??
      getPanelReferences()[0] ??
      null;
    setUsedPanelRef(visible ?? legacyPick);
  }, [isOpen, panelsData, prospect?.panelReferenceId]);

  useEffect(() => {
    if (!invertersData) return;
    const visibleInverters = invertersData.filter((r) => r.visible !== false);
    const byId =
      prospect?.inverterReferenceId ? visibleInverters.find((r) => r.id === prospect.inverterReferenceId) : null;
    const recommended = visibleInverters.find((r) => r.recommended === true);
    setUsedInverterRef(byId ?? recommended ?? visibleInverters[0] ?? null);
  }, [invertersData, prospect?.inverterReferenceId]);

  /** Mode Découverte sans prospect : batterie par défaut (recommandée / première) pour le calcul projet. */
  useEffect(() => {
    if (!isOpen || prospect || !discoveryRow || !batteriesData?.length) return;
    const visibleBatteries = batteriesData.filter((b) => b.visible !== false);
    if (!visibleBatteries.length) {
      setUsedBatteryRef(null);
      setBatteryCount(1);
      return;
    }
    setUsedBatteryRef((prev) =>
      prev && visibleBatteries.some((b) => b.id === prev.id)
        ? prev
        : visibleBatteries.find((r) => r.recommended === true) ?? visibleBatteries[0] ?? null
    );
    setBatteryCount(1);
  }, [isOpen, prospect, discoveryRow, batteriesData]);

  useEffect(() => {
    if (!isOpen || !discoveryRow) setDiscoveryPipelineFinanceInputs(null);
  }, [isOpen, discoveryRow]);

  // Adresse : suivre le prospect courant
  useEffect(() => {
    if (prospect?.address) {
      setAddress(prospect.address);
    }
  }, [prospect?.address]);

  // Mode Perfect fit / Highest production : ne dépendre que de l'id et du champ persisté.
  // Avant : [prospect] réexécutait l'effet à chaque merge (batterie, PVGIS…) et le `else` forçait
  // "highest_production" quand configurationMode était encore absent du document — les boutons ne suivaient pas le clic.
  useEffect(() => {
    if (!isOpen || !prospect) return;
    if (prospect.configurationMode) {
      setConfigurationMode(prospect.configurationMode);
    } else {
      setConfigurationMode("highest_production");
    }
  }, [isOpen, prospect?.id, prospect?.configurationMode]);

  useEffect(() => {
    logPolygonDrawer("drawer:prospect-sync", {
      isOpen,
      roofSurfacesCount: prospect?.roofSurfaces?.length ?? 0,
      roofSurfaceArea: prospect?.roofSurface?.area,
      addressPreview: prospect?.address?.slice(0, 36),
    });
  }, [prospect, isOpen]);

  // Clé stable : inclure la surface pour re-fetcher quand elle change (données PVGIS dépendent du kWp)
  const totalAreaForKey =
    prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
  const pvgisFetchKey =
    isOpen && prospect?.coordinates && !prospect.solarPotential?.pvgisDataFetched && totalAreaForKey > 0
      ? `${prospect.id ?? "noid"}-${prospect.coordinates.lat}-${prospect.coordinates.lng}-${Math.round(totalAreaForKey)}`
      : null;
  const pvgisFetchInProgressRef = useRef(false);

  // Récupérer les données PVGIS une seule fois à l'ouverture du drawer pour ce prospect
  useEffect(() => {
    if (!pvgisFetchKey || !prospect || !prospect.coordinates || !onProspectUpdate) return;
    if (pvgisFetchInProgressRef.current) return;

    const fetchPVGISData = async () => {
      pvgisFetchInProgressRef.current = true;
      setIsLoadingPVGIS(true);
      setPvgisError(null);

      try {
        const surfaces = prospect.roofSurfaces ||
          (prospect.roofSurface?.area > 0 ? [prospect.roofSurface] : []);
        const firstSurface = surfaces[0];
        const orientation = firstSurface?.orientation;

        const requestBody: {
          lat: number;
          lon: number;
          peakpower: number;
          loss: number;
          azimuth?: number;
          slope?: number;
        } = {
          lat: prospect.coordinates.lat,
          lon: prospect.coordinates.lng,
          peakpower: 1,
          loss: 14,
        };

        if (orientation != null) {
          requestBody.azimuth = orientation;
          requestBody.slope = 30;
        }

        const response = await fetch("/api/pvgis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Erreur ${response.status}`);
        }

        const pvgisData = await response.json();

        if (!pvgisData || typeof pvgisData.annualProduction !== "number") {
          throw new Error("Données PVGIS invalides reçues");
        }

        const productionPerKwpAnnual = Math.round(pvgisData.annualProduction * 100) / 100;
        const productionPerKwpMonthly = Array.isArray(pvgisData.monthlyProduction)
          ? pvgisData.monthlyProduction.map((m: { month: number; production: number }) => ({
              month: m.month,
              production: Math.round((m.production || 0) * 100) / 100,
            }))
          : [];

        const updatedSolarPotential: SolarPotential = {
          ...prospect.solarPotential,
          productionPerKwpAnnual,
          productionPerKwpMonthly,
          maxSunshineHoursPerYear: pvgisData.sunshineHoursEquivalent,
          optimalInclination: pvgisData.optimalInclination,
          optimalAzimuth: pvgisData.optimalAzimuth,
          annualIrradiation: pvgisData.annualIrradiation,
          monthlyIrradiation: Array.isArray(pvgisData.monthlyIrradiation)
            ? pvgisData.monthlyIrradiation
            : [],
          pvgisDataFetched: true,
          maxArrayPanelsCount: prospect.solarPotential?.maxArrayPanelsCount || 0,
        };

        logPolygonDrawer("drawer:pvgis-complete", {
          closureSurfaces: prospect.roofSurfaces?.length ?? 0,
          closureRoofArea: prospect.roofSurface?.area,
        });
        // Uniquement solarPotential : le `prospect` de cette closure peut dater d'avant geocode/POI.
        onProspectUpdate({ solarPotential: updatedSolarPotential });
      } catch (error) {
        console.error("Erreur lors de la récupération des données PVGIS:", error);
        setPvgisError(
          error instanceof Error ? error.message : "Erreur lors de la récupération des données d'ensoleillement"
        );
      } finally {
        pvgisFetchInProgressRef.current = false;
        setIsLoadingPVGIS(false);
      }
    };

    fetchPVGISData();
  }, [pvgisFetchKey]); // prospect et onProspectUpdate lus dans la closure, pas en deps pour éviter re-jeux infinis

  const discoveryFootprintSumM2 = useMemo(() => {
    if (!discoveryRow) return 0;
    const cluster = getParcelleClusterForV5(discoveryRow, discoveryLinkedParcelleRows);
    return footprintSumTotalFromV5(discoveryRow, cluster);
  }, [discoveryRow, discoveryLinkedParcelleRows]);

  const discoveryPipelineMapHref = useMemo(() => {
    if (!discoveryExistingPipelineProspect) return null;
    return buildDiscoveryFocusHref(discoveryExistingPipelineProspect);
  }, [discoveryExistingPipelineProspect]);

  const handleDiscoveryAddToPipeline = async () => {
    if (!discoveryRow) return;
    setIsAdding(true);
    try {
      const panelRef = getRecommendedPanelReferenceSync();
      const cluster = getParcelleClusterForV5(discoveryRow, discoveryLinkedParcelleRows);
      const centroid = discoveryCentroidFromV5(discoveryRow, cluster);
      let pvgis: PVGISData | null = null;
      if (centroid && validateCoordinates(centroid)) {
        try {
          const footprintAz = pvgisAzimuthFromFootprintGeometry(discoveryRow.geometry);
          pvgis = await getPVGISData(
            centroid,
            footprintAz != null
              ? { azimuth: footprintAz, slope: DISCOVERY_PVGIS_ROOF_SLOPE_DEG }
              : undefined
          );
        } catch {
          pvgis = null;
        }
      }
      const draft = matchingV5RowsToProspectDraft(discoveryRow, discoveryLinkedParcelleRows, {
        panelRef,
        pvgisData: pvgis,
      });
      const draftForPipeline =
        discoveryFinancialSummary != null
          ? {
              ...draft,
              priceRangeMinEur: discoveryFinancialSummary.priceRange.totalMinEur,
              priceRangeMaxEur: discoveryFinancialSummary.priceRange.totalMaxEur,
              breakEvenMinYears: discoveryFinancialSummary.breakEvenMin,
              breakEvenMaxYears: discoveryFinancialSummary.breakEvenMax,
            }
          : draft;
      const kwp = draftForPipeline.solarPotential?.estimatedKwp ?? 0;
      const basePipeline =
        kwp > 0 && discoveryFootprintSumM2 > 0 ? ({ estimatedKwp: kwp } as const) : null;
      const pipelineOptions =
        basePipeline && discoveryFinancialSummary
          ? {
              ...basePipeline,
              priceRangeMinEur: discoveryFinancialSummary.priceRange.totalMinEur,
              priceRangeMaxEur: discoveryFinancialSummary.priceRange.totalMaxEur,
              breakEvenMinYears: discoveryFinancialSummary.breakEvenMin,
              breakEvenMaxYears: discoveryFinancialSummary.breakEvenMax,
            }
          : basePipeline ?? undefined;
      const prospectId = await addProspectToPipeline(draftForPipeline, pipelineOptions, user?.uid);
      await createLeadFromProspect(
        prospectId,
        draftForPipeline.name || draftForPipeline.address,
        draftForPipeline.contact?.websiteUri
      );
      onDiscoveryPipelineAdded?.();
      onOpenChange(false);
      toast.success("Lead ajouté au pipeline", {
        description: draftForPipeline.name || draftForPipeline.address,
        action: {
          label: "Ouvrir le pipeline",
          onClick: () => router.push("/"),
        },
      });
    } catch {
      toast.error("Erreur lors de l'ajout au pipeline", {
        description: "Veuillez réessayer.",
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddToPipeline = async () => {
    if (!prospect || !onAddToPipeline) return;

    setIsAdding(true);
    try {
      // Calculer les mêmes valeurs que l'affichage (même méthode) pour les stocker en Firestore
      const totalArea =
        prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ??
        prospect.roofSurface?.area ??
        0;
      let pipelineOptions: {
        estimatedKwp?: number;
        priceRangeMinEur?: number;
        priceRangeMaxEur?: number;
        breakEvenMinYears?: number | null;
        breakEvenMaxYears?: number | null;
      } = {};
      if (totalArea > 0) {
        if (financialSummary && effectiveConfig.effectiveKwp > 0) {
          pipelineOptions.estimatedKwp = effectiveConfig.effectiveKwp;
          pipelineOptions.priceRangeMinEur = financialSummary.priceRange.totalMinEur;
          pipelineOptions.priceRangeMaxEur = financialSummary.priceRange.totalMaxEur;
          pipelineOptions.breakEvenMinYears = financialSummary.breakEvenMin;
          pipelineOptions.breakEvenMaxYears = financialSummary.breakEvenMax;
        }
      }

      const prospectId = await addProspectToPipeline(
        {
          ...prospect,
          address: address || prospect.address,
          configurationMode,
        },
        pipelineOptions,
        user?.uid
      );

      // Créer un lead à partir du prospect
      await createLeadFromProspect(
        prospectId,
        address || prospect.address,
        prospect.contact?.websiteUri
      );

      // Réinitialiser le formulaire
      onAddToPipeline();
      onOpenChange(false);

      toast.success("Lead ajouté au pipeline", {
        description: prospect.name || address || prospect.address,
        action: {
          label: "Ouvrir le pipeline",
          onClick: () => router.push("/"),
        },
      });
    } catch (error) {
      toast.error("Erreur lors de l'ajout au pipeline", {
        description: "Veuillez réessayer.",
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleSave = async () => {
    if (!prospect?.id) return;

    setIsSaving(true);
    try {
      const totalArea =
        prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ??
        prospect.roofSurface?.area ??
        0;
      let pipelineOptions: {
        estimatedKwp?: number;
        priceRangeMinEur?: number;
        priceRangeMaxEur?: number;
        breakEvenMinYears?: number | null;
        breakEvenMaxYears?: number | null;
      } = {};
      if (totalArea > 0 && financialSummary && effectiveConfig.effectiveKwp > 0) {
        pipelineOptions.estimatedKwp = effectiveConfig.effectiveKwp;
        pipelineOptions.priceRangeMinEur = financialSummary.priceRange.totalMinEur;
        pipelineOptions.priceRangeMaxEur = financialSummary.priceRange.totalMaxEur;
        pipelineOptions.breakEvenMinYears = financialSummary.breakEvenMin;
        pipelineOptions.breakEvenMaxYears = financialSummary.breakEvenMax;
      }

      const updatedProspect: Prospect = {
        ...prospect,
        address: address || prospect.address,
        configurationMode,
        ...(usedPanelRef?.id && { panelReferenceId: usedPanelRef.id }),
        ...(usedInverterRef?.id && { inverterReferenceId: usedInverterRef.id }),
        ...(usedBatteryRef?.id && { batteryReferenceId: usedBatteryRef.id }),
        ...(usedBatteryRef && { batteryCount: Math.max(1, Math.min(usedBatteryRef.maxBatteriesPerRack ?? 20, batteryCount)) }),
        ...(pipelineOptions.estimatedKwp != null && {
          solarPotential: {
            ...prospect.solarPotential,
            maxArrayPanelsCount: prospect.solarPotential?.maxArrayPanelsCount ?? 0,
            maxArrayAreaMeters2: prospect.solarPotential?.maxArrayAreaMeters2 ?? 0,
            maxSunshineHoursPerYear: prospect.solarPotential?.maxSunshineHoursPerYear ?? 0,
            maxKwhPerYear: prospect.solarPotential?.maxKwhPerYear ?? 0,
            estimatedKwp: pipelineOptions.estimatedKwp,
          },
        }),
        ...(pipelineOptions.priceRangeMinEur != null && { priceRangeMinEur: pipelineOptions.priceRangeMinEur }),
        ...(pipelineOptions.priceRangeMaxEur != null && { priceRangeMaxEur: pipelineOptions.priceRangeMaxEur }),
        ...(pipelineOptions.breakEvenMinYears !== undefined && { breakEvenMinYears: pipelineOptions.breakEvenMinYears }),
        ...(pipelineOptions.breakEvenMaxYears !== undefined && { breakEvenMaxYears: pipelineOptions.breakEvenMaxYears }),
      };

      await updateProspectInPipeline(
        prospect.id,
        updatedProspect,
        pipelineOptions
      );

      onProspectUpdate?.(updatedProspect);
      toast.success("Enregistré");
      onSaveSuccess?.();
    } catch (error) {
      alert("Erreur lors de l'enregistrement. Veuillez réessayer.");
    } finally {
      setIsSaving(false);
    }
  };

  const openProspectClientPortal = useCallback(
    async (target: Prospect) => {
      if (!target.id) return;

      const openTab = (shareToken: string) => {
        if (typeof window === "undefined") return;
        const w = window.open(`/p/${shareToken}`, "_blank", "noopener,noreferrer");
        if (w) w.opener = null;
      };

      if (target.shareToken) {
        openTab(target.shareToken);
        return;
      }

      setIsGeneratingLink(true);
      try {
        const shareToken = crypto.randomUUID();
        let commercialReferent: CommercialReferent;
        if (user) {
          const userProfile = await getUserProfile(user.uid);
          const fromUser = buildCommercialReferentFromUser(user, userProfile);
          const fromSettings = getCommercialReferent();
          commercialReferent = {
            ...fromUser,
            calendlyUrl: fromSettings.calendlyUrl || fromUser.calendlyUrl,
          };
        } else {
          commercialReferent = getCommercialReferent();
        }

        await updateProspect(target.id, { shareToken, commercialReferent });
        if (prospect?.id === target.id) {
          onProspectUpdate?.({ shareToken, commercialReferent });
        }
        onDiscoveryPipelineAdded?.();
        openTab(shareToken);
      } catch {
        toast.error("Erreur lors de l’ouverture de la page partagée", {
          description: "Veuillez réessayer.",
        });
      } finally {
        setIsGeneratingLink(false);
      }
    },
    [user, prospect?.id, onProspectUpdate, onDiscoveryPipelineAdded]
  );

  const handleOpenSharePage = () => {
    if (!prospect?.id) return;
    void openProspectClientPortal(prospect);
  };

  /** Valeurs effectives selon le mode (Perfect fit vs Highest production).
   * Source : productionPerKwp (PVGIS) × kWp actuel. kWp = surfaceToKwp(surface). */
  const effectiveConfig = useMemo(() => {
    const surfaceM2 = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    const panelRef = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const legacyKwp = (prospect?.solarPotential?.maxArrayAreaMeters2 ?? 0) > 0
      ? surfaceToKwp(prospect!.solarPotential!.maxArrayAreaMeters2!, undefined, undefined, panelRef)
      : undefined;
    const perKwp = getProductionPerKwpFromSolarPotential(prospect?.solarPotential, legacyKwp);

    if (!prospect || surfaceM2 <= 0 || !panelRef || !perKwp) {
      return {
        scaleFactor: 1,
        effectiveKwp: 0,
        effectivePanelCount: 0,
        effectiveAnnualProductionKwh: 0,
        kwpAtFetch: 0,
        productionPerKwp: null,
      };
    }

    const fullKwp = surfaceToKwp(surfaceM2, undefined, undefined, panelRef);
    const productible = perKwp.productionPerKwpAnnual;
    const usableArea = getUsableRoofAreaM2(surfaceM2);
    const maxPanelCount = calculatePanelCount(usableArea, undefined, panelRef);
    const panelPowerW = panelRef.powerW;

    const panelCountFromKwp = (kwp: number) =>
      Math.min(Math.floor((kwp * 1000) / panelPowerW), maxPanelCount);

    if (configurationMode === "highest_production") {
      const effectiveKwp = fullKwp;
      const effectiveAnnualProductionKwh = Math.round(productible * fullKwp);
      return {
        scaleFactor: 1,
        effectiveKwp,
        effectivePanelCount: panelCountFromKwp(fullKwp),
        effectiveAnnualProductionKwh,
        kwpAtFetch: fullKwp,
        productionPerKwp: perKwp,
      };
    }

    const PERFECT_FIT_SELF_CONSUMPTION_TARGET = 0.7;
    const placeType = prospect.placeType || "other";
    const consoFromType = getEnergyConsumption(placeType) * surfaceM2;
    const consoAnnuelleKwh = prospect.annualConsumptionKwhOverride ?? consoFromType;
    const targetKwp = productible > 0
      ? (consoAnnuelleKwh * PERFECT_FIT_SELF_CONSUMPTION_TARGET) / productible
      : 0;
    const effectiveKwp = Math.min(targetKwp, fullKwp);
    const effectiveAnnualProductionKwh = Math.round(productible * effectiveKwp);
    return {
      scaleFactor: 1,
      effectiveKwp,
      effectivePanelCount: panelCountFromKwp(effectiveKwp),
      effectiveAnnualProductionKwh,
      kwpAtFetch: fullKwp,
      productionPerKwp: perKwp,
    };
  }, [prospect, configurationMode, usedPanelRef]);

  /** Config pour les choice cards : panneaux + onduleurs. production = productionPerKwp × kWp. */
  const choiceCardsConfig = useMemo(() => {
    const surfaceM2 = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    const panelRef = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const inverterRef = usedInverterRef ?? getRecommendedInverterReferenceSync();
    const legacyKwp = (prospect?.solarPotential?.maxArrayAreaMeters2 ?? 0) > 0
      ? surfaceToKwp(prospect!.solarPotential!.maxArrayAreaMeters2!, undefined, undefined, panelRef)
      : undefined;
    const perKwp = getProductionPerKwpFromSolarPotential(prospect?.solarPotential, legacyKwp);

    if (!prospect || surfaceM2 <= 0 || !panelRef || !perKwp) {
      return { perfectFit: { panelCount: 0, inverterCount: 0, kwp: 0 }, highestProduction: { panelCount: 0, inverterCount: 0, kwp: 0 } };
    }

    const fullKwp = surfaceToKwp(surfaceM2, undefined, undefined, panelRef);
    const productible = perKwp.productionPerKwpAnnual;
    const usableArea = getUsableRoofAreaM2(surfaceM2);
    const maxPanelCount = calculatePanelCount(usableArea, undefined, panelRef);

    const panelCountFromKwp = (kwp: number) =>
      Math.min(Math.floor((kwp * 1000) / panelRef.powerW), maxPanelCount);

    const highestPanelCount = panelCountFromKwp(fullKwp);
    const highestInverterCount = calculateInverterCount(fullKwp, inverterRef);

    const PERFECT_FIT_SELF_CONSUMPTION_TARGET = 0.7;
    const placeType = prospect.placeType || "other";
    const consoFromType = getEnergyConsumption(placeType) * surfaceM2;
    const consoAnnuelleKwh = prospect.annualConsumptionKwhOverride ?? consoFromType;
    const targetKwp = productible > 0
      ? (consoAnnuelleKwh * PERFECT_FIT_SELF_CONSUMPTION_TARGET) / productible
      : 0;
    const cappedKwp = Math.min(targetKwp, fullKwp);
    const perfectFitPanelCount = panelCountFromKwp(cappedKwp);
    const perfectFitInverterCount = calculateInverterCount(cappedKwp, inverterRef);

    const config = {
      perfectFit: { panelCount: perfectFitPanelCount, inverterCount: perfectFitInverterCount, kwp: cappedKwp },
      highestProduction: { panelCount: highestPanelCount, inverterCount: highestInverterCount, kwp: fullKwp },
    };
    return config;
  }, [prospect, usedPanelRef, usedInverterRef]);

  /**
   * Taille batterie recommandée (kWh) :
   * - Avec profils PVGIS (12 mois) : simulation sans batterie → surplus = injection réseau annuelle ;
   *   capacité ≈ (surplus journalier moyen) / η (0,9).
   * - Sinon : repli sur bilan annuel prod − conso (historique), puis règle kWh/kWc si pas de surplus.
   */
  const recommendedBatteryKwh = useMemo(() => {
    const totalArea = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    if (!prospect || totalArea <= 0) return null;
    const effectiveKwp = effectiveConfig.effectiveKwp;
    const hasProductionData = effectiveConfig.productionPerKwp != null;
    if (!hasProductionData || effectiveKwp <= 0) return null;
    const placeType = prospect.placeType || "other";
    const annualConsumptionKwh =
      prospect.annualConsumptionKwhOverride ?? getEnergyConsumption(placeType) * totalArea;
    const annualProductionKwh = effectiveConfig.effectiveAnnualProductionKwh;
    const monthly = effectiveConfig.productionPerKwp?.productionPerKwpMonthly;

    return computeRecommendedBatteryTargetKwh({
      productionPerKwpMonthly: monthly,
      effectiveKwp,
      annualProductionKwh,
      annualConsumptionKwh,
      placeType,
      surfaceM2: totalArea,
    });
  }, [prospect, effectiveConfig.effectiveAnnualProductionKwh, effectiveConfig.effectiveKwp, effectiveConfig.productionPerKwp]);

  /**
   * Composition recommandée :
   * - Cible haute (>= plus grosse batterie) : on part de la plus grosse, on optimise le count.
   *   Ex. 100 kWh, modèles 25 et 75 → 75×1=75 (écart 25) vs 75×2=150 (écart 50) → 1×75 kWh.
   * - Cible basse (< plus grosse batterie) : meilleur match parmi tous les modèles.
   *   Ex. 13,7 kWh, modèles 105 et 215 → 105×1 plus proche que 215×1 → 1×105 kWh.
   */
  const recommendedBatteryComposition = useMemo(() => {
    const visibleBatteries = (batteriesData ?? []).filter((b) => b.visible !== false);
    if (!visibleBatteries.length || recommendedBatteryKwh == null) return null;
    return pickRecommendedBatteryComposition(recommendedBatteryKwh, visibleBatteries);
  }, [batteriesData, recommendedBatteryKwh]);

  useEffect(() => {
    if (recommendedBatteryKwh != null && DEBUG_AUTOCONSO && process.env.NODE_ENV === "development") {
      console.log("[Batterie] Dimensionnement calculé:", {
        recommendedBatteryKwh,
        composition: recommendedBatteryComposition ? `${recommendedBatteryComposition.count}× ${recommendedBatteryComposition.model.name}` : null,
      });
    }
  }, [recommendedBatteryKwh, recommendedBatteryComposition]);

  useEffect(() => {
    pendingBatteryResyncAfterModeChangeRef.current = false;
  }, [prospect?.id]);

  // Batterie : toujours une ref issue de batteriesData. Par défaut : choix prospect → composition recommandée → premier avec flag recommandé → premier de la liste.
  // Après clic Perfect fit / Highest production : réaligner modèle + nombre sur recommendedBatteryComposition (y compris quand PVGIS / composition arrive après le clic).
  // Si le prospect a un batteryCount persisté, il prime sinon ; hors resync explicite au changement de mode.
  useEffect(() => {
    if (!isOpen || !prospect) return;
    const visibleBatteries = (batteriesData ?? []).filter((b) => b.visible !== false);
    if (!visibleBatteries.length) {
      setUsedBatteryRef(null);
      setBatteryCount(1);
      return;
    }

    if (pendingBatteryResyncAfterModeChangeRef.current && recommendedBatteryComposition != null) {
      const { model, count } = recommendedBatteryComposition;
      setUsedBatteryRef(model);
      setBatteryCount(count);
      pendingBatteryResyncAfterModeChangeRef.current = false;
      // Patch partiel uniquement : ne pas spread `prospect` (closure périmée → réécrase configurationMode après clic mode).
      onProspectUpdate?.({
        batteryReferenceId: model.id,
        batteryCount: count,
      });
      return;
    }

    const byId = prospect.batteryReferenceId ? visibleBatteries.find((r) => r.id === prospect.batteryReferenceId) : null;
    const chosen =
      byId ??
      recommendedBatteryComposition?.model ??
      visibleBatteries.find((r) => r.recommended === true) ??
      visibleBatteries[0];
    setUsedBatteryRef(chosen);
    const countFromProspect = prospect.batteryCount != null && prospect.batteryCount >= 1 ? prospect.batteryCount : null;
    const countFromRec = recommendedBatteryComposition?.model?.id === chosen?.id ? recommendedBatteryComposition.count : null;
    setBatteryCount(countFromProspect ?? countFromRec ?? 1);
  }, [isOpen, batteriesData, prospect, recommendedBatteryComposition, configurationMode, onProspectUpdate]);

  /** Nombre max d'onduleurs recommandé ; au-delà, le modèle n'est pas adapté */
  const MAX_INVERTER_COUNT = 8;
  const effectiveInverterCount = configurationMode === "perfect_fit"
    ? choiceCardsConfig.perfectFit.inverterCount
    : choiceCardsConfig.highestProduction.inverterCount;
  const inverterCountExceedsLimit = effectiveInverterCount > MAX_INVERTER_COUNT;

  const includeBatteryEffective = prospect?.includeBatteryOverride ?? getSolarEquipmentSettings().includeBattery ?? true;

  const discoveryFinancialSummary = useMemo(() => {
    if (!discoveryRow || !discoveryPipelineFinanceInputs) return null;
    const panelRef = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const inverterRef = usedInverterRef ?? getRecommendedInverterReferenceSync();
    if (!panelRef || !inverterRef) return null;
    const simBat = discoverySimBattery;
    const batteryRef = discoveryIncludeBattery ? simBat?.ref ?? null : null;
    const batteryCountSim =
      discoveryIncludeBattery && batteryRef ? Math.max(1, simBat?.count ?? 1) : 1;
    return computeDiscoveryDrawerFinancialSummary({
      inputs: discoveryPipelineFinanceInputs,
      placeType: "other",
      panelRef,
      inverterRef,
      batteryRef,
      batteryCount: batteryCountSim,
      includeBattery: discoveryIncludeBattery,
    });
  }, [
    discoveryRow,
    discoveryPipelineFinanceInputs,
    usedPanelRef,
    usedInverterRef,
    discoverySimBattery,
    discoveryIncludeBattery,
  ]);

  /** Résumé financier (équipement, fourchette prix, économies, break-even) avec ou sans batterie */
  const financialSummary = useMemo(() => {
    const totalArea = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    if (!prospect || totalArea <= 0) return null;
    const recommendedPanel = usedPanelRef ?? getRecommendedPanelReferenceSync();
    const recommendedInverter = usedInverterRef ?? getRecommendedInverterReferenceSync();
    const panelCount = effectiveConfig.effectivePanelCount;
    const totalPowerKW = effectiveConfig.effectiveKwp;
    const inverterCount = calculateInverterCount(totalPowerKW, recommendedInverter);
    const placeType = prospect.placeType || "other";
    const totalConsumptionKwh =
      prospect.annualConsumptionKwhOverride ?? getEnergyConsumption(placeType) * totalArea;

    let equipmentEur: number;
    let annualSavings: number;

    let batteryByMonth: { selfConsumptionDirectKwh: number; selfConsumptionViaBatteryKwh: number; injectionBatteryKwh: number; injectionReseauKwh: number; excessKwh: number; gridDrawKwh: number }[] | undefined;
    let breakdownFromHourlySim = false;
    let selfConsumptionDirectKwhTotal = 0;
    let selfConsumptionViaBatteryKwhTotal = 0;
    let injectionReseauKwhTotal = 0;
    const canUseProfiles = effectiveConfig.productionPerKwp?.productionPerKwpMonthly?.length === 12;
    const annualProductionKWh = effectiveConfig.effectiveAnnualProductionKwh;

    if (canUseProfiles && annualProductionKWh > 0 && totalConsumptionKwh > 0) {
      breakdownFromHourlySim = true;
      const productionPerKwpMonthly = effectiveConfig.productionPerKwp!.productionPerKwpMonthly;
      const kwp = effectiveConfig.effectiveKwp;
      const productionTypicalDayByMonth = Array.from({ length: 12 }, (_, m) =>
        buildTypicalDayForMonth(productionPerKwpMonthly, m, kwp)
      );
      const consumptionTypicalDayByMonth = Array.from({ length: 12 }, (_, m) =>
        buildTypicalConsumptionDayForMonth(placeType, m, totalArea)
      );
      const scaledBattery = includeBatteryEffective && usedBatteryRef
        ? scaleBatteryForCount(usedBatteryRef, batteryCount)
        : null;
      if (DEBUG_AUTOCONSO && process.env.NODE_ENV === "development" && scaledBattery) {
        console.log("[Autoconsommation] ProspectDrawer — simulation avec", usedBatteryRef!.name, "×", batteryCount, "→ capacité totale:", scaledBattery.capacityKwh, "kWh");
      }
      const simulationResult = runProductionSimulation({
        productionTypicalDayByMonth,
        consumptionTypicalDayByMonth,
        battery: scaledBattery,
      });
      annualSavings = estimateAnnualSavingsEurWithBattery(simulationResult);
      equipmentEur = estimateInstallationPriceEur(
        panelCount,
        inverterCount,
        recommendedPanel,
        recommendedInverter,
        includeBatteryEffective && usedBatteryRef ? usedBatteryRef : undefined,
        batteryCount
      );
      batteryByMonth = simulationResult.byMonth;
      selfConsumptionDirectKwhTotal = simulationResult.selfConsumptionDirectKwh;
      selfConsumptionViaBatteryKwhTotal = simulationResult.selfConsumptionViaBatteryKwh;
      injectionReseauKwhTotal = simulationResult.excessKwh;
    } else {
      annualSavings = estimateAnnualSavingsEur(annualProductionKWh, undefined, totalConsumptionKwh);
      equipmentEur = estimateInstallationPriceEur(
        panelCount,
        inverterCount,
        recommendedPanel,
        recommendedInverter
      );
    }

    const priceRange = estimateTotalPriceRangeEur(totalPowerKW, equipmentEur);
    const breakEvenMin = getBreakEvenYears(priceRange.totalMinEur, annualSavings);
    const breakEvenMax = getBreakEvenYears(priceRange.totalMaxEur, annualSavings);
    return {
      equipmentEur,
      priceRange,
      annualSavings,
      breakEvenMin,
      breakEvenMax,
      batteryByMonth,
      breakdownFromHourlySim,
      selfConsumptionDirectKwhTotal,
      selfConsumptionViaBatteryKwhTotal,
      injectionReseauKwhTotal,
    };
  }, [
    prospect,
    configurationMode,
    effectiveConfig,
    usedPanelRef,
    usedInverterRef,
    usedBatteryRef,
    batteryCount,
    includeBatteryEffective,
  ]);

  const liveAnnualConsumptionKwh = useMemo(() => {
    const totalArea = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    const placeType = prospect?.placeType || "other";
    return prospect?.annualConsumptionKwhOverride ?? getEnergyConsumption(placeType) * totalArea;
  }, [prospect]);

  const prospectBillReductionCard = useMemo(() => {
    const retail = DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH;
    const feedIn = DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH;
    const billAnnual = estimateEnergyBillEur(liveAnnualConsumptionKwh);
    const pctOfRefBill = (part: number, ref: number) =>
      ref > 0 && Number.isFinite(part) ? (Math.max(0, part) / ref) * 100 : 0;
    const directEurY = Math.max(0, financialSummary?.selfConsumptionDirectKwhTotal ?? 0) * retail;
    const viaBatteryEurY = Math.max(0, financialSummary?.selfConsumptionViaBatteryKwhTotal ?? 0) * retail;
    const injectionEurY = Math.max(0, financialSummary?.injectionReseauKwhTotal ?? 0) * feedIn;
    return {
      periodLabel: "Moyenne mensuelle",
      headlineReductionEur: Math.round((financialSummary?.annualSavings ?? 0) / 12),
      segments: [
        { id: "direct", label: "Autoconso directe", monthlyReductionEur: Math.round(directEurY / 12), pctOfBill: pctOfRefBill(directEurY, billAnnual), variant: "direct" as const },
        { id: "battery", label: "Autoconso batterie", monthlyReductionEur: Math.round(viaBatteryEurY / 12), pctOfBill: pctOfRefBill(viaBatteryEurY, billAnnual), variant: "battery" as const },
        { id: "injection", label: "Injection réseau", monthlyReductionEur: Math.round(injectionEurY / 12), pctOfBill: pctOfRefBill(injectionEurY, billAnnual), variant: "injection" as const },
      ],
    };
  }, [financialSummary, liveAnnualConsumptionKwh]);

  const chartData = useMemo(() => {
    const surfaceM2 = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    const placeType = prospect?.placeType || "other";
    if (!prospect || !effectiveConfig.productionPerKwp) return [];
    const { monthlyProduction } = getProductionFromPerKwp(
      effectiveConfig.productionPerKwp.productionPerKwpAnnual,
      effectiveConfig.productionPerKwp.productionPerKwpMonthly,
      effectiveConfig.effectiveKwp
    );
    const byMonth = financialSummary?.batteryByMonth;
    return monthlyProduction.map((m) => {
      const base = {
        month: m.month,
        production: m.production,
        consumption: Math.round(getEnergyConsumptionForMonth(placeType, (m.month - 1) as MonthIndex) * surfaceM2),
      };
      if (byMonth?.[m.month - 1]) {
        const b = byMonth[m.month - 1]!;
        return {
          ...base,
          selfConsumptionDirect: b.selfConsumptionDirectKwh,
          selfConsumptionViaBattery: b.selfConsumptionViaBatteryKwh,
          injectionBattery: b.injectionBatteryKwh,
          excess: b.injectionReseauKwh,
          gridDraw: b.gridDrawKwh,
        };
      }
      return base;
    });
  }, [prospect, effectiveConfig, financialSummary?.batteryByMonth]);

  const chartDailyData = useMemo(() => {
    const surfaceM2 = prospect?.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect?.roofSurface?.area ?? 0;
    if (!prospect || surfaceM2 <= 0 || !effectiveConfig.productionPerKwp) return undefined;
    const placeType = prospect.placeType || "other";
    const prodDay = buildTypicalDayForMonth(
      effectiveConfig.productionPerKwp.productionPerKwpMonthly,
      chartSelectedMonthIndex,
      effectiveConfig.effectiveKwp
    );
    const consDay = buildTypicalConsumptionDayForMonth(placeType, chartSelectedMonthIndex, surfaceM2);
    const batteryForChart = includeBatteryEffective && usedBatteryRef
      ? scaleBatteryForCount(usedBatteryRef, batteryCount)
      : null;
    const hourly = runSimulationOneDayForChart(prodDay, consDay, batteryForChart);
    return hourly.map((h, hour) => ({
      hour,
      production: prodDay[hour] ?? 0,
      consumption: consDay[hour] ?? 0,
      selfConsumptionDirect: h.selfConsumptionDirectKwh,
      selfConsumptionViaBattery: h.selfConsumptionViaBatteryKwh,
      injectionBattery: h.injectionBatteryKwh,
      excess: h.injectionReseauKwh,
      gridDraw: h.gridDrawKwh,
    }));
  }, [
    prospect,
    effectiveConfig,
    chartSelectedMonthIndex,
    includeBatteryEffective,
    usedBatteryRef,
    batteryCount,
  ]);

  return (
    <div className="h-full w-full bg-white border border-border flex flex-col rounded-2xl overflow-hidden">
        <div className="rounded-t-2xl p-3 sm:p-4">
          <div
            className={cn(
              "flex items-start gap-3",
              discoveryRow ? "justify-end" : "justify-between"
            )}
          >
            {discoveryRow ? (
              <p className="sr-only">Détails découverte matching V5</p>
            ) : (
              <h2 className="text-lg font-semibold leading-none tracking-tight">Informations du prospect</h2>
            )}
            <Button
              variant="outline"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 shrink-0"
              title="Fermer"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto px-4 space-y-2">
          {false ? (
            <>
              {/* Skeleton pour le score de qualité */}
              <div className="bg-gray-100 rounded-xl py-3 px-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                  <Skeleton className="h-2 w-full" />
                </div>
              </div>

              {/* Skeleton pour l’aperçu carte */}
              <div className="bg-gray-100 rounded-xl py-3 px-4">
                <Skeleton className="h-4 w-28 mb-2" />
                <Skeleton className="h-48 w-full rounded-md" />
              </div>

              {/* Skeleton pour le nom */}
              <Skeleton className="h-12 w-full rounded-md" />

              {/* Skeleton pour l'adresse */}
              <Skeleton className="h-12 w-full rounded-md" />

              {/* Skeleton pour le type de lieu */}
              <Skeleton className="h-12 w-full rounded-md" />

              {/* Skeleton pour les coordonnées */}
              <div className="flex gap-2">
                <Skeleton className="h-12 flex-1 rounded-md" />
                <Skeleton className="h-12 flex-1 rounded-md" />
              </div>
            </>
          ) : discoveryRow ? (
            <ProspectDrawerDiscoverySection
              row={discoveryRow}
              linkedParcelleRows={
                discoveryLinkedParcelleRows ??
                (discoveryRow.grain === "parcelle" ? [discoveryRow] : [])
              }
              isOpen={isOpen}
              onPipelineFinanceInputsChange={setDiscoveryPipelineFinanceInputs}
              pipelineProject={
                discoveryFinancialSummary && discoveryPipelineFinanceInputs
                  ? {
                      summary: discoveryFinancialSummary,
                      surfaceM2: discoveryPipelineFinanceInputs.footprintM2,
                    }
                  : null
              }
              discoveryIncludeBattery={discoveryIncludeBattery}
              onDiscoveryIncludeBatteryChange={setDiscoveryIncludeBattery}
              discoverySimulationSummary={discoveryFinancialSummary}
              discoveryDailySimulationBattery={discoveryDailySimulationBattery}
              onDiscoveryMatchingV5Persisted={onDiscoveryMatchingV5Persisted}
            />
          ) : prospect ? (
            <>
              {/* Score en tag */}
              <div className="flex gap-2">
                <Badge
                  variant="secondary"
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider bg-gray-100 text-gray-800 border-gray-200 h-5"
                >
                  Score {prospect.qualityScore}
                </Badge>
              </div>

              <div className="w-full space-y-2">
                <div className="space-y-2">
              {/* Bloc prospect : nom, adresse, type, lat/lon */}
              <Card className="bg-white border border-border text-foreground shadow-none overflow-hidden rounded-xl">
                <CardContent className="py-3 px-4">
                  <div className="flex flex-col gap-3 relative">
                    <div className="space-y-0 [&>p]:m-0 [&>p]:leading-tight">
                    {prospect.name && (
                      <div className="flex items-center gap-1 min-w-0">
                        <p className="text-xl font-medium text-foreground truncate flex-1 min-w-0" title={prospect.name}>
                          {prospect.name}
                        </p>
                        {prospect.poiCandidates && prospect.poiCandidates.length > 1 && onProspectUpdate && (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
                              disabled={
                                companyEnrichmentLoading || (prospect.poiCandidateIndex ?? 0) <= 0
                              }
                              onClick={() => void handlePoiNavigate(-1)}
                              aria-label="POI précédent"
                              title="POI précédent"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
                              disabled={
                                companyEnrichmentLoading ||
                                (prospect.poiCandidateIndex ?? 0) >= prospect.poiCandidates.length - 1
                              }
                              onClick={() => void handlePoiNavigate(1)}
                              aria-label="POI suivant"
                              title="POI suivant"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    {prospect.address && (
                      <p className="text-xs text-muted-foreground truncate" title={prospect.address}>
                        {prospect.address}
                      </p>
                    )}
                    </div>

                    <Separator className="my-2" />

                    {/* Entreprise (api.gouv) — liste fixe : skeleton / valeur / "No data" par ligne */}
                    <div className="divide-y divide-border text-xs pt-3">
                      {PROSPECT_DATA_ROWS.map((row) => {
                        const isLoading = row.isBdnb ? bdnbLoading : companyEnrichmentLoading;
                        const value = row.getValue(prospect);
                        return (
                          <div key={row.label} className="flex items-center gap-4 min-w-0 py-2.5 first:pt-0 last:pb-0">
                            <div className="shrink-0 text-muted-foreground w-[115px]">
                              <span>{row.label}</span>
                            </div>
                            {isLoading ? (
                              <Skeleton className="h-3.5 flex-1" />
                            ) : value ? (
                              row.isPhone ? (
                                <a
                                  href={`tel:${value.replace(/\s/g, "")}`}
                                  className="font-mono text-foreground truncate min-w-0 flex-1 text-left pl-1 hover:underline"
                                  title={value}
                                >
                                  {value}
                                </a>
                              ) : row.isWebsite ? (
                                <a
                                  href={websiteHref(value)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono text-foreground truncate min-w-0 flex-1 text-left pl-1 hover:underline inline-flex items-center gap-1"
                                  title={value}
                                >
                                  <span className="truncate">{value}</span>
                                </a>
                              ) : (
                                <span className="font-mono truncate min-w-0 flex-1 text-left pl-1 text-foreground" title={value}>
                                  {value}
                                </span>
                              )
                            ) : (
                              <span className="font-mono text-muted-foreground min-w-0 flex-1 text-left pl-1">No data</span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Ligne Lat/Lon (gauche) + Badge (droite) - en bas */}
                    <div className="flex items-center justify-between gap-2 pt-1 mt-auto">
                      <div className="flex gap-3 text-[11px] text-muted-foreground shrink-0">
                        <span>Lat {prospect.coordinates.lat.toFixed(5)}</span>
                        <span>Lon {prospect.coordinates.lng.toFixed(5)}</span>
                      </div>
                      <div className="shrink-0">
                        {phase2ScoringLoading && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                        {!phase2ScoringLoading && phase2Scoring && phase2Scoring.filter((p) => p.score > 0).length > 0 && (() => {
                          const filteredScoring = phase2Scoring.filter((p) => p.score > 0);
                          const bestScore = filteredScoring[0]?.score ?? 0;
                          const confidenceLevel = getConfidenceLevel(bestScore);
                          const badgeProps = getConfidenceBadgeProps(confidenceLevel);
                          return (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="cursor-pointer">
                                  <Badge variant="outline" className={`text-xs font-semibold ${badgeProps.className} cursor-pointer hover:opacity-80 transition-opacity border-border`}>
                                    {badgeProps.label}
                                  </Badge>
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-96 p-3" align="end">
                                <div className="space-y-2">
                                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">
                                    Établissements scorés ({filteredScoring.length})
                                  </div>
                                  <div className="max-h-64 space-y-1.5 overflow-y-auto">
                                    {filteredScoring.map((p) => {
                                      const pConfidence = getConfidenceLevel(p.score);
                                      const pBadge = getConfidenceBadgeProps(pConfidence);
                                      return (
                                        <div
                                          key={p.siret}
                                          onClick={() => {
                                            if (onProspectUpdate && prospect) {
                                              onProspectUpdate({
                                                siren: p.siren,
                                                siret: p.siret,
                                                companyLegalName: p.nom_complet,
                                                companyAddress: p.adresse,
                                                companyTrancheEffectif: undefined,
                                              });
                                              toast.success("Informations mises à jour", {
                                                description: `Établissement ${p.nom_complet} sélectionné`,
                                                className: "bg-emerald-50 border-emerald-200 [&>div]:text-sm [&>div]:font-semibold [&>div]:text-gray-700",
                                                descriptionClassName: "text-sm text-gray-600",
                                              });
                                            }
                                          }}
                                          className="flex items-start justify-between gap-2 rounded bg-gray-50 px-2 py-2 hover:bg-gray-100 cursor-pointer transition-colors text-xs"
                                        >
                                          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="font-mono text-muted-foreground">#{p.rank}</span>
                                              <span className="font-semibold text-gray-800">score: {p.score}/1000</span>
                                            </div>
                                            <span className="truncate font-medium text-gray-700" title={p.nom_complet}>{p.nom_complet}</span>
                                            <span className="truncate font-mono text-muted-foreground text-[10px]" title={p.siret}>SIRET: {p.siret}</span>
                                            <span className="truncate text-muted-foreground text-[10px]" title={p.adresse}>{p.code_postal} - {p.adresse}</span>
                                          </div>
                                          <Badge variant="outline" className={`text-xs shrink-0 ${pBadge.className}`}>
                                            {pBadge.label}
                                          </Badge>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Score opérationnel : surface + année construction */}
              {(() => {
                const totalArea = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0;
                const annee = prospect.anneeConstruction ?? null;

                // Surface sub-score /50 : échelonné linéairement entre 700 m² et 10 000 m²
                let scoreSurface = 0;
                if (totalArea >= 10000) scoreSurface = 50;
                else if (totalArea >= 700) scoreSurface = Math.round(((totalArea - 700) / (10000 - 700)) * 50);
                else scoreSurface = 0;

                // Année construction sub-score /50
                let scoreAnnee = 0;
                if (annee != null) {
                  if (annee > 2010) scoreAnnee = 50;
                  else if (annee >= 1990) scoreAnnee = 25;
                  else scoreAnnee = 0;
                }

                const totalScore = scoreSurface + scoreAnnee;
                const pct = totalScore; // 0–100

                const donutData = [
                  { value: pct },
                  { value: 100 - pct },
                ];

                let scoreColor = "#ef4444"; // red
                if (pct >= 70) scoreColor = "#22c55e"; // green
                else if (pct >= 40) scoreColor = "#f59e0b"; // amber

                return (
                  <Card className="bg-muted/40 border border-border rounded-xl overflow-hidden">
                    <CardContent className="py-3 px-4">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-3">Score opérationnel</div>
                      <div className="flex items-center gap-4">
                        {/* Donut */}
                        <div className="relative shrink-0" style={{ width: 80, height: 80 }}>
                          <PieChart width={80} height={80}>
                            <Pie
                              data={donutData}
                              cx={35}
                              cy={35}
                              innerRadius={26}
                              outerRadius={36}
                              startAngle={90}
                              endAngle={-270}
                              dataKey="value"
                              strokeWidth={0}
                            >
                              <Cell fill={scoreColor} />
                              <Cell fill="hsl(var(--muted))" />
                            </Pie>
                          </PieChart>
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="text-sm font-semibold" style={{ color: scoreColor }}>{pct}</span>
                          </div>
                        </div>
                        {/* Détail */}
                        <div className="flex flex-col gap-1.5 text-xs min-w-0">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground truncate">Surface toiture</span>
                            <span className="font-medium tabular-nums">
                              {totalArea > 0 ? `${Math.round(totalArea)} m²` : "—"}
                              <span className="text-muted-foreground ml-1">({scoreSurface}/50)</span>
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground truncate">Année construction</span>
                            <span className="font-medium tabular-nums">
                              {annee != null ? annee : "—"}
                              <span className="text-muted-foreground ml-1">({scoreAnnee}/50)</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {prospect.exposure && (
                <div className="bg-gray-100 rounded-xl py-3 px-4">
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>Nord: {prospect.exposure.north}%</div>
                    <div>Sud: {prospect.exposure.south}%</div>
                    <div>Est: {prospect.exposure.east}%</div>
                    <div>Ouest: {prospect.exposure.west}%</div>
                  </div>
                </div>
              )}

              {/* Chargement / erreur PVGIS */}
              {isLoadingPVGIS && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2 bg-gray-100 rounded-xl px-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Chargement des données d&apos;ensoleillement...</span>
                </div>
              )}
              {pvgisError && !isLoadingPVGIS && (
                <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{pvgisError}</span>
                </div>
              )}
                </div>

                <div className="space-y-2">
              {/* Choice cards : Perfect fit / Highest production — au-dessus de Production */}
              {(prospect.solarPotential?.productionPerKwpMonthly?.length || prospect.solarPotential?.monthlyProduction?.length) &&
               !isLoadingPVGIS &&
               ((prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0) > 0) && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      pendingBatteryResyncAfterModeChangeRef.current = true;
                      setConfigurationMode("perfect_fit");
                      if (prospect && onProspectUpdate) {
                        onProspectUpdate({ configurationMode: "perfect_fit" });
                      }
                    }}
                    className={`cursor-pointer rounded-xl px-4 py-4 text-left transition-colors h-full flex flex-col justify-between overflow-hidden ${
                      configurationMode === "perfect_fit"
                        ? "border border-[#0000FF33] bg-[#0000FF0D] shadow-xs"
                        : "border border-transparent bg-gray-100 hover:bg-gray-200/80"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-gray-500">Perfect fit</span>
                    </div>
                    <div className="mt-auto">
                      <div className={`text-sm font-normal ${configurationMode === "perfect_fit" ? "text-[#0000FF]" : "text-gray-700"}`}>
                        {choiceCardsConfig.perfectFit.kwp.toFixed(2)}
                        <span className={`text-xs font-light ml-0.5 ${configurationMode === "perfect_fit" ? "text-[#0000FF]" : "text-gray-400"}`}>kWp</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <span className="text-[10px] text-muted-foreground">{choiceCardsConfig.perfectFit.panelCount} panneaux</span>
                        <span className="text-[10px] text-muted-foreground">·</span>
                        <span className="text-[10px] text-muted-foreground">{choiceCardsConfig.perfectFit.inverterCount} onduleur{choiceCardsConfig.perfectFit.inverterCount > 1 ? "s" : ""}</span>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      pendingBatteryResyncAfterModeChangeRef.current = true;
                      setConfigurationMode("highest_production");
                      if (prospect && onProspectUpdate) {
                        onProspectUpdate({ configurationMode: "highest_production" });
                      }
                    }}
                    className={`cursor-pointer rounded-xl px-4 py-4 text-left transition-colors h-full flex flex-col justify-between overflow-hidden ${
                      configurationMode === "highest_production"
                        ? "border border-[#0000FF33] bg-[#0000FF0D] shadow-xs"
                        : "border border-transparent bg-gray-100 hover:bg-gray-200/80"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-gray-500">Highest production</span>
                    </div>
                    <div className="mt-auto">
                      <div className={`text-sm font-normal ${configurationMode === "highest_production" ? "text-[#0000FF]" : "text-gray-700"}`}>
                        {choiceCardsConfig.highestProduction.kwp.toFixed(2)}
                        <span className={`text-xs font-light ml-0.5 ${configurationMode === "highest_production" ? "text-[#0000FF]" : "text-gray-400"}`}>kWp</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <span className="text-[10px] text-muted-foreground">{choiceCardsConfig.highestProduction.panelCount} panneaux</span>
                        <span className="text-[10px] text-muted-foreground">·</span>
                        <span className="text-[10px] text-muted-foreground">{choiceCardsConfig.highestProduction.inverterCount} onduleur{choiceCardsConfig.highestProduction.inverterCount > 1 ? "s" : ""}</span>
                      </div>
                    </div>
                  </button>
                </div>
              )}

              {/* Production mensuelle : affiché uniquement si surface définie (kWp + consommation) */}
              {(prospect.solarPotential?.productionPerKwpMonthly?.length || prospect.solarPotential?.monthlyProduction?.length) &&
               !isLoadingPVGIS &&
               ((prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0) > 0) && (
                <>
                  <ProspectEnergyChartsPanel
                    configurationModeKey={configurationMode}
                    annualProductionKwh={effectiveConfig.effectiveAnnualProductionKwh}
                    chartViewMode={chartViewMode}
                    onChartViewModeChange={setChartViewMode}
                    chartSelectedMonthIndex={chartSelectedMonthIndex}
                    onChartSelectedMonthIndexChange={setChartSelectedMonthIndex}
                    data={chartData}
                    dailyData={chartDailyData}
                    includeBattery={prospect.includeBatteryOverride ?? getSolarEquipmentSettings().includeBattery ?? true}
                    onIncludeBatteryChange={(checked) => onProspectUpdate?.({ includeBatteryOverride: checked })}
                  />

                  {/* Bloc finance (même que page partagée) + Estimated price */}
                  {(() => {
                    const totalArea = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0;
                    if (totalArea <= 0 || !financialSummary) return null;
                    const placeType = prospect.placeType || "other";
                    const totalConsumptionKwh = totalArea > 0 ? getEnergyConsumption(placeType) * totalArea : 0;
                    const energyBillEur = estimateEnergyBillEur(totalConsumptionKwh);
                    const {
                      priceRange,
                      annualSavings,
                      breakEvenMin,
                      breakEvenMax,
                      breakdownFromHourlySim,
                      selfConsumptionDirectKwhTotal,
                      selfConsumptionViaBatteryKwhTotal,
                      injectionReseauKwhTotal,
                    } = financialSummary;
                    const breakEvenLabel =
                      breakEvenMin != null && breakEvenMax != null
                        ? breakEvenMin === breakEvenMax
                          ? `${breakEvenMin} an${breakEvenMin > 1 ? "s" : ""}`
                          : `${breakEvenMin} – ${breakEvenMax} ans`
                        : "—";
                    const fmtPart = (eur: number) =>
                      eur >= 1000 ? `${Math.round(eur / 100) / 10} k€` : `${Math.round(eur)} €`;
                    const directEur = (selfConsumptionDirectKwhTotal ?? 0) * DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH;
                    const viaBatteryEur = (selfConsumptionViaBatteryKwhTotal ?? 0) * DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH;
                    const injectionReseauEur = (injectionReseauKwhTotal ?? 0) * DEFAULT_FEED_IN_TARIFF_EUR_PER_KWH;
                    const totalSavings = directEur + viaBatteryEur + injectionReseauEur;
                    const savingsPctRaw = energyBillEur > 0 ? (annualSavings / energyBillEur) * 100 : 0;
                    const savingsPct = Math.min(100, savingsPctRaw);
                    const pctBattery = totalSavings > 0 ? (viaBatteryEur / totalSavings) * 100 : 0;
                    const pctDirect = totalSavings > 0 ? (directEur / totalSavings) * 100 : 0;
                    const productionKwh = effectiveConfig.effectiveAnnualProductionKwh;
                    const autoKwh = (selfConsumptionDirectKwhTotal ?? 0) + (selfConsumptionViaBatteryKwhTotal ?? 0);
                    const autoPct = productionKwh > 0 ? Math.round((autoKwh / productionKwh) * 100) : 0;
                    const row = (key: string, label: ReactNode, value: ReactNode, valueSmall?: boolean) => (
                      <div key={key} className="flex items-center justify-between gap-2 min-w-0 py-0 first:pt-0 last:pb-0">
                        <span className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide truncate min-w-0">{label}</span>
                        <span className={`font-normal text-gray-500 shrink-0 tabular-nums ${valueSmall ? "text-[10px] sm:text-xs" : "text-xs sm:text-sm"}`}>{value}</span>
                      </div>
                    );
                    return (
                      <>
                        <div className="rounded-xl px-3 py-3 sm:px-4 sm:py-4 min-h-0 flex flex-col justify-center bg-gray-100 overflow-y-auto overflow-x-hidden">
                          <div className="flex items-center justify-between gap-1 mb-1.5 sm:mb-2">
                            <span className="text-[10px] uppercase tracking-wide text-gray-500">Financial yearly</span>
                          </div>
                          <div className="flex flex-col gap-y-1 sm:gap-y-1.5 text-xs">
                            {energyBillEur > 0 && (
                              <div className="w-full mb-1.5 shrink-0">
                                <div className="flex justify-between items-center mb-0.5">
                                  {annualSavings > 0 && (
                                    <span className="text-[9px] text-gray-400 tabular-nums" title="Économies en % de la facture énergétique">
                                      {Math.round(savingsPctRaw)}%
                                    </span>
                                  )}
                                  {productionKwh > 0 && (
                                    <span className="text-[9px] text-gray-400 tabular-nums" title="Taux d'autoconsommation">
                                      {autoPct}%
                                    </span>
                                  )}
                                </div>
                                <div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden flex">
                                  {savingsPct > 0 && breakdownFromHourlySim && totalSavings > 0 ? (
                                    <div className="h-full flex shrink-0" style={{ width: `${savingsPct}%` }}>
                                      <div className="h-full bg-[#0000FF] shrink-0" style={{ width: `${pctBattery}%` }} title="Autoconsommation batterie" />
                                      <div className="h-full bg-[#4B5563] shrink-0" style={{ width: `${pctDirect}%` }} title="Autoconsommation directe" />
                                      <div className="h-full bg-[#32F490] shrink-0 flex-1" title="Injection réseau" />
                                    </div>
                                  ) : savingsPct > 0 ? (
                                    <div className="h-full rounded-l-full bg-gray-600" style={{ width: `${savingsPct}%` }} />
                                  ) : null}
                                </div>
                              </div>
                            )}
                            {row("energy-bill", "Est. Energy bill", <>{energyBillEur.toLocaleString("fr-FR")}<span className="text-gray-400 ml-0.5 font-light">€</span></>)}
                            {row("savings", "Savings", <>{annualSavings.toLocaleString("fr-FR")}<span className="text-gray-400 ml-0.5 font-light">€</span></>)}
                            {breakdownFromHourlySim ? (
                              <>
                                {row(
                                  "battery",
                                  <span className="flex items-center gap-1.5 truncate text-[9px] sm:text-[10px]"><span className="w-2 h-2 rounded-[2px] bg-[#0000FF] shrink-0" />Autoconsommation batterie</span>,
                                  fmtPart(viaBatteryEur),
                                  true
                                )}
                                {row(
                                  "direct",
                                  <span className="flex items-center gap-1.5 truncate text-[9px] sm:text-[10px]"><span className="w-2 h-2 rounded-[2px] bg-[#4B5563] shrink-0" />Autoconsommation directe</span>,
                                  fmtPart(directEur),
                                  true
                                )}
                                {row(
                                  "injection",
                                  <span className="flex items-center gap-1.5 truncate text-[9px] sm:text-[10px]"><span className="w-2 h-2 rounded-[2px] bg-[#32F490] shrink-0" />Injection réseau</span>,
                                  fmtPart(injectionReseauEur),
                                  true
                                )}
                              </>
                            ) : (
                              <p className="text-[10px] text-gray-500 py-0">Répartition non disponible sans données mensuelles</p>
                            )}
                          </div>
                        </div>
                        <div className="rounded-xl px-4 py-4 min-h-[130px] flex flex-col justify-between bg-gray-100">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] uppercase tracking-wide text-gray-500">Estimated project price</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" title="Fourchette du coût total d'installation (équipement, BOS et maîtrise d'œuvre)." />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <div className="text-sm text-gray-500">{breakEvenLabel}</div>
                            <div className="text-2xl font-normal text-gray-700">
                              {priceRange.totalMinEur.toLocaleString("fr-FR")} – {priceRange.totalMaxEur.toLocaleString("fr-FR")}
                              <span className="text-sm font-light text-gray-400 ml-0.5">€</span>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                  {/* Équipement (Panneau + Onduleur + Batterie) */}
                  {(usedPanelRef || usedInverterRef || usedBatteryRef || includeBatteryEffective) && (
                  <div className="bg-gray-100 rounded-xl py-3 px-4">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-3">Équipement</div>
                    <div className="space-y-2">
                        {panelsData && panelsData.length > 0 && (
                          <div>
                            <EquipmentSelectCard<PanelReference>
                              value={usedPanelRef}
                              options={
                                panelsData.filter((p) => p.visible === true).length > 0
                                  ? panelsData.filter((p) => p.visible === true)
                                  : panelsData
                              }
                              onChange={setUsedPanelRef}
                              getItemId={(p) => p.id}
                              showRecommendedBadge={!!usedPanelRef?.recommended}
                              rightBadge={usedPanelRef ? String(effectiveConfig.effectivePanelCount) : undefined}
                              placeholder={
                                <span className="flex items-center gap-2">
                                  <Zap className="h-5 w-5" />
                                  Choisir un panneau
                                </span>
                              }
                              renderTriggerContent={(p, { badges }) => (
                                <>
                                  <EquipmentThumbnail imageUrl={p.imageUrl} alt={p.name} fallback={<span className="text-muted-foreground text-xs">—</span>} />
                                  <div className="flex-1 min-w-0 flex flex-col justify-center text-left">
                                    <div className="flex w-full items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0 font-semibold text-xs text-foreground truncate">{p.name}</div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {badges}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">€{p.costEur}</span>
                                      <span className="text-muted-foreground/40 text-xs">|</span>
                                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                        <Zap className="h-3 w-3 text-muted-foreground/80" />
                                        {p.powerW}W
                                      </span>
                                      {p.warrantyYears != null && (
                                        <>
                                          <span className="text-muted-foreground/40 text-xs">|</span>
                                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                            <FileCheck className="h-3 w-3 text-muted-foreground/80" />
                                            {p.warrantyYears}y
                                          </span>
                                        </>
                                      )}
                                      {p.countryCode && (
                                        <>
                                          <span className="text-muted-foreground/40 text-xs">|</span>
                                          <span className="inline-flex shrink-0" title={p.countryOfOrigin}>
                                            <img src={getCountryFlagUrl(p.countryCode)} alt="" className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50" width={12} height={12} />
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                              renderOptionContent={(p, selected) => (
                                <>
                                  <EquipmentThumbnail imageUrl={p.imageUrl} alt="" fallback={<span className="text-muted-foreground text-xs">—</span>} size="sm" />
                                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <div className="font-medium text-xs text-foreground truncate">{p.name}</div>
                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] text-muted-foreground">
                                      <span>€{p.costEur}</span>
                                      <span>·</span>
                                      <span>{p.powerW}W</span>
                                      {p.recommended && (
                                        <span className="inline-flex items-center rounded bg-gray-900 px-1 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                            />
                          </div>
                        )}
                        {invertersData && invertersData.length > 0 && (
                          <div>
                            <EquipmentSelectCard<InverterReference>
                              value={usedInverterRef}
                              options={invertersData.filter((i) => i.visible !== false)}
                              onChange={setUsedInverterRef}
                              getItemId={(i) => i.id}
                              showRecommendedBadge={!!usedInverterRef?.recommended && !inverterCountExceedsLimit}
                              warningBadge={inverterCountExceedsLimit ? (
                                <span className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" title="Plus de 8 onduleurs : choisir un modèle plus puissant">
                                  Changer de modèle
                                </span>
                              ) : undefined}
                              rightBadge={usedInverterRef ? String(effectiveInverterCount) : undefined}
                              placeholder={
                                <span className="flex items-center gap-2">
                                  <Zap className="h-5 w-5" />
                                  Choisir un onduleur
                                </span>
                              }
                              renderTriggerContent={(i, { badges }) => (
                                <>
                                  <EquipmentThumbnail imageUrl={i.imageUrl} alt={i.name} fallback={<span className="text-muted-foreground text-xs">—</span>} />
                                  <div className="flex-1 min-w-0 flex flex-col justify-center text-left">
                                    <div className="flex w-full items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0 font-semibold text-xs text-foreground truncate">{i.name}</div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {badges}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">€{i.costEur}</span>
                                      <span className="text-muted-foreground/40 text-xs">|</span>
                                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                        <Zap className="h-3 w-3 text-muted-foreground/80" />
                                        {i.powerW}W
                                      </span>
                                      {i.warrantyYears != null && (
                                        <>
                                          <span className="text-muted-foreground/40 text-xs">|</span>
                                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                            <FileCheck className="h-3 w-3 text-muted-foreground/80" />
                                            {i.warrantyYears}y
                                          </span>
                                        </>
                                      )}
                                      {i.countryCode && (
                                        <>
                                          <span className="text-muted-foreground/40 text-xs">|</span>
                                          <span className="inline-flex shrink-0" title={i.countryOfOrigin}>
                                            <img src={getCountryFlagUrl(i.countryCode)} alt="" className="w-3 h-3 rounded-full object-cover ring-1 ring-border/50" width={12} height={12} />
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                              renderOptionContent={(i) => (
                                <>
                                  <EquipmentThumbnail imageUrl={i.imageUrl} alt="" fallback={<span className="text-muted-foreground text-xs">—</span>} size="sm" />
                                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <div className="font-medium text-xs text-foreground truncate">{i.name}</div>
                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] text-muted-foreground">
                                      <span>€{i.costEur}</span>
                                      <span>·</span>
                                      <span>{i.powerW}W</span>
                                      {i.recommended && (
                                        <span className="inline-flex items-center rounded bg-gray-900 px-1 py-0.5 text-[10px] font-medium text-white">recommandé</span>
                                      )}
                                    </div>
                                  </div>
                                </>
                              )}
                            />
                          </div>
                        )}
                        {includeBatteryEffective && (
                          <div className="space-y-1.5">
                            {recommendedBatteryKwh != null && (
                              <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5">
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Cible batterie</span>
                                <span className="text-xs font-semibold tabular-nums">{recommendedBatteryKwh} kWh</span>
                              </div>
                            )}
                            {batteriesData && batteriesData.filter((b) => b.visible !== false).length > 0 ? (
                              <BatterySelectCard
                                value={usedBatteryRef}
                                onChange={(b) => {
                                  setUsedBatteryRef(b);
                                  const maxForNew = b?.maxBatteriesPerRack ?? 20;
                                  const clampedCount = b ? Math.min(maxForNew, Math.max(1, batteryCount)) : 1;
                                  setBatteryCount(clampedCount);
                                  if (b && prospect && onProspectUpdate) {
                                    onProspectUpdate({ batteryReferenceId: b.id, batteryCount: clampedCount });
                                  }
                                }}
                                count={batteryCount}
                                onCountChange={(n) => {
                                  setBatteryCount(n);
                                  if (prospect && onProspectUpdate) {
                                    onProspectUpdate({ batteryCount: n });
                                  }
                                }}
                                maxCount={usedBatteryRef?.maxBatteriesPerRack ?? 20}
                                batteries={batteriesData.filter((b) => b.visible !== false)}
                                isRecommendedForProspect={
                                  !!recommendedBatteryComposition &&
                                  usedBatteryRef?.id === recommendedBatteryComposition.model.id &&
                                  batteryCount === recommendedBatteryComposition.count
                                }
                                recommendedBatteryIdForProspect={recommendedBatteryComposition?.model.id ?? null}
                              />
                            ) : (
                              <p className="text-xs text-muted-foreground">Aucune batterie configurée. Ajoutez-en dans Paramètres.</p>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                  )}
                </>
              )}
                </div>
              </div>

              {/* Données financières (en dernier) */}
              {(() => {
                const totalArea = prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0;
                if (totalArea <= 0 || !financialSummary) return null;
                return null;
              })()}
            </>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-8">
              Cliquez sur la carte pour obtenir les informations d&apos;un lieu
            </div>
          )}
        </div>

        {!discoveryRow ? (
          <div className="p-4 mt-auto bg-white space-y-2 rounded-b-2xl">
            {prospect?.id && (
              <div className="flex flex-wrap gap-2">
                {!isOnDiscovery && !voirHref(prospect.id).includes("/solar-scout") && (
                  <Link href={voirHref(prospect.id)}>
                    <Button
                      variant="default"
                      size="icon"
                      className="h-12 w-12 shrink-0 border-0 bg-gray-100 hover:bg-gray-200 text-gray-700"
                      title={isOnMap ? "Voir" : "Voir sur la carte"}
                      aria-label={isOnMap ? "Voir" : "Voir sur la carte"}
                    >
                      {isOnMap ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <MapIcon className="h-4 w-4" />
                      )}
                    </Button>
                  </Link>
                )}
                <Button
                  variant="default"
                  size="icon"
                  className="h-12 w-12 shrink-0 border-0 bg-gray-100 hover:bg-gray-200 text-gray-700"
                  onClick={handleOpenSharePage}
                  disabled={isGeneratingLink}
                  title={isGeneratingLink ? "Ouverture..." : "Ouvrir la page client"}
                  aria-label={isGeneratingLink ? "Ouverture..." : "Ouvrir la page client"}
                >
                  {isGeneratingLink ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  onClick={handleSave}
                  className="flex-1 min-w-0"
                  size="lg"
                  disabled={isSaving}
                >
                  {isSaving ? "Enregistrement..." : "Enregistrer"}
                </Button>
              </div>
            )}
            {prospect && onAddToPipeline && !prospect.id && (
              <div className="flex gap-2">
                <Button
                  variant={(prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0) > 0 ? "default" : "secondary"}
                  onClick={handleAddToPipeline}
                  className="flex-1"
                  size="lg"
                  disabled={isAdding}
                >
                  {isAdding ? "Ajout en cours..." : "Ajouter au pipeline"}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 mt-auto bg-white space-y-2 rounded-b-2xl border-t border-border">
            {discoveryExistingPipelineProspect?.id ? (
              <div className="flex flex-wrap gap-2">
                {discoveryPipelineMapHref && !isOnDiscovery ? (
                  <Button
                    type="button"
                    variant="default"
                    size="icon"
                    className="h-12 w-12 shrink-0 border-0 bg-gray-100 hover:bg-gray-200 text-gray-700"
                    asChild
                  >
                    <Link
                      href={discoveryPipelineMapHref}
                      title="Voir sur la carte Découverte"
                      aria-label="Voir sur la carte Découverte"
                    >
                      <MapIcon className="h-4 w-4" />
                    </Link>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="default"
                  size="icon"
                  className="h-12 w-12 shrink-0 border-0 bg-gray-100 hover:bg-gray-200 text-gray-700"
                  onClick={() => void openProspectClientPortal(discoveryExistingPipelineProspect)}
                  disabled={isGeneratingLink}
                  title={isGeneratingLink ? "Ouverture..." : "Ouvrir la page client"}
                  aria-label={isGeneratingLink ? "Ouverture..." : "Ouvrir la page client"}
                >
                  {isGeneratingLink ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                </Button>
                <Button type="button" variant="outline" className="flex-1 min-w-0" size="lg" asChild>
                  <Link href="/">Ouvrir le pipeline</Link>
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant={discoveryFootprintSumM2 > 0 ? "default" : "secondary"}
                onClick={() => void handleDiscoveryAddToPipeline()}
                className="w-full"
                size="lg"
                disabled={isAdding || discoveryFootprintSumM2 <= 0}
              >
                {isAdding ? "Ajout en cours..." : "Ajouter au pipeline"}
              </Button>
            )}
          </div>
        )}
    </div>
  );
}
