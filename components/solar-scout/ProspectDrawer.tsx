"use client";

import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  X,
  Loader2,
  AlertCircle,
  Zap,
  FileCheck,
  Info,
  Link2,
  Eye,
  Map as MapIcon,
  ExternalLink,
  Battery,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { PieChart, Pie, Cell } from "recharts";
import { addProspectToPipeline, createLeadFromProspect, updateProspectInPipeline, updateProspect } from "@/lib/firestore";
import { logPolygonDrawer } from "@/lib/debug-polygon-drawer";

/** Activer les logs détaillés d'autoconsommation. Désactivé par défaut. */
const DEBUG_AUTOCONSO = false;
import { translatePlaceType } from "@/lib/place-types-translation";
import { MonthlyProductionChart } from "./MonthlyProductionChart";
import { BatterySelectCard } from "./BatterySelectCard";
import { EquipmentSelectCard, EquipmentThumbnail } from "./EquipmentSelectCard";
import { surfaceToKwp, getUsableRoofAreaM2 } from "@/lib/surface-to-kwp";
import {
  buildTypicalConsumptionDayForMonth,
  getEnergyConsumption,
  getEnergyConsumptionForMonth,
  getHourlyConsumptionProfileKwhPerM2,
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
  parseMatchingV5BuildingsJson,
  parsePasserelleAddressesJson,
  parseSiretsMatchJson,
  type ScoutMatchingV5Row,
  type V5BuildingsJsonEntry,
  type V5PasserellePpmEntry,
} from "@/lib/scout-matching-v5-map";
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

/** Dernier bloc de chiffres contigu dans l’identifiant BDNB construction (affichage court au lieu de l’id complet). */
function bdnbConstructionShortNumber(constructionId: string): string {
  const s = constructionId.trim();
  if (!s || s === "—") return "—";
  const runs = s.match(/\d+/g);
  return runs?.length ? runs[runs.length - 1]! : "—";
}

type DiscoveryApiNomEntry = { status: "loading" | "ok" | "err"; name?: string };

/** Contenu du drawer en mode découverte PostgreSQL (matching V5), même tiroir que Solar Scout. */
function ProspectDrawerDiscoverySection({
  row,
  linkedParcelleRows,
  isOpen,
}: {
  row: ScoutMatchingV5Row;
  /** Parcelles du même groupe (transitif « partage » ou bâtiment multi-parcelles). */
  linkedParcelleRows: ScoutMatchingV5Row[];
  isOpen: boolean;
}) {
  const parcelleCluster = useMemo(() => {
    const filtered = linkedParcelleRows.filter((r) => r.grain === "parcelle");
    if (filtered.length > 0) return filtered;
    if (row.grain === "parcelle") return [row];
    return [];
  }, [linkedParcelleRows, row]);

  const discoveryClusterKey = useMemo(
    () => `${row.id}|${parcelleCluster.map((p) => p.id).sort().join(",")}`,
    [row.id, parcelleCluster]
  );

  const matchingV5ApiNomFetchedRef = useRef<Set<string>>(new Set());
  const [matchingV5ApiNomBySiren, setMatchingV5ApiNomBySiren] = useState<
    Record<string, DiscoveryApiNomEntry>
  >({});
  const [discoveryMainTab, setDiscoveryMainTab] = useState("terrain");

  useEffect(() => {
    matchingV5ApiNomFetchedRef.current.clear();
    setMatchingV5ApiNomBySiren({});
    setDiscoveryMainTab("terrain");
  }, [discoveryClusterKey]);

  const sirensForApiNom = useMemo(() => {
    if (parcelleCluster.length > 0) return collectSirensFromMatchingV5Rows(parcelleCluster);
    return collectSirensFromMatchingV5Row(row);
  }, [parcelleCluster, row]);

  useEffect(() => {
    if (!isOpen) return;
    if (discoveryMainTab !== "entreprises" && discoveryMainTab !== "terrain") return;
    const sirens = sirensForApiNom;
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

  /** Lignes `buildings_json` ; pour une ligne `building` sans JSON, une ligne synthétique à partir de la row. */
  const buildingDetailRows = useMemo((): V5BuildingsJsonEntry[] => {
    const byBc = new Map<string, V5BuildingsJsonEntry>();
    for (const pr of parcelleCluster.length > 0 ? parcelleCluster : []) {
      for (const b of parseMatchingV5BuildingsJson(pr.buildingsJson)) {
        if (!byBc.has(b.batimentConstructionId)) byBc.set(b.batimentConstructionId, b);
      }
    }
    if (byBc.size > 0) return Array.from(byBc.values());

    const parsed = parseMatchingV5BuildingsJson(row.buildingsJson);
    if (parsed.length > 0) return parsed;
    if (row.grain !== "building") return [];
    const bc = row.batimentConstructionId?.trim() || "";
    const bg = row.batimentGroupeId?.trim() || null;
    if (!bc && !bg) return [];
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
    return [
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

  /** Découverte : pas de type Google lieu — profil conso « other » (kWh/m²/an typique). */
  const discoveryPlaceType = "other";
  const [discoveryChartViewMode, setDiscoveryChartViewMode] = useState<"monthly" | "daily">("monthly");
  const [discoveryChartMonthIndex, setDiscoveryChartMonthIndex] = useState(6);
  const [discoveryPvgis, setDiscoveryPvgis] = useState<PVGISData | null>(null);
  const [discoveryPvgisLoading, setDiscoveryPvgisLoading] = useState(false);
  const [discoveryPvgisError, setDiscoveryPvgisError] = useState<string | null>(null);
  /** Complète NAF / effectifs via `/api/recherche-entreprises` (api.gouv) quand absents de sirets_json. */
  const [discoveryGouvEtabBySiret, setDiscoveryGouvEtabBySiret] = useState<
    Record<string, { status: "loading" | "ok" | "err"; naf?: string; tranche?: string; annee?: string }>
  >({});

  useEffect(() => {
    setDiscoveryGouvEtabBySiret({});
  }, [discoveryClusterKey]);

  useEffect(() => {
    if (!isOpen || discoveryMainTab !== "entreprises") return;
    let cancelled = false;
    const siretsToResetOnCleanup: string[] = [];
    for (const e of sirets) {
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
  }, [isOpen, discoveryMainTab, sirets]);

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
    void getPVGISData({ lat: centroid.lat, lng: centroid.lng })
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
  }, [isOpen, discoveryClusterKey, centroid]);

  const discoveryChartMonthlyData = useMemo(() => {
    if (!discoveryPvgis || kwpEst <= 0 || footprintSumTotal <= 0) return [];
    const perKwpMonthly = discoveryPvgis.monthlyProduction;
    const { monthlyProduction } = getProductionFromPerKwp(
      discoveryPvgis.annualProduction,
      perKwpMonthly,
      kwpEst
    );
    const surfaceM2 = footprintSumTotal;
    return monthlyProduction.map((m) => ({
      month: m.month,
      production: m.production,
      consumption: Math.round(
        getEnergyConsumptionForMonth(discoveryPlaceType, (m.month - 1) as MonthIndex) * surfaceM2
      ),
    }));
  }, [discoveryPvgis, kwpEst, footprintSumTotal]);

  const discoveryChartDailyData = useMemo(() => {
    if (!discoveryPvgis || footprintSumTotal <= 0 || kwpEst <= 0) return undefined;
    const perKwpMonthly = discoveryPvgis.monthlyProduction;
    const prodDay = buildTypicalDayForMonth(perKwpMonthly, discoveryChartMonthIndex, kwpEst);
    const consDay = buildTypicalConsumptionDayForMonth(
      discoveryPlaceType,
      discoveryChartMonthIndex,
      footprintSumTotal
    );
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      production: prodDay[hour] ?? 0,
      consumption: consDay[hour] ?? 0,
    }));
  }, [discoveryPvgis, footprintSumTotal, kwpEst, discoveryChartMonthIndex]);

  const discoveryBatimentsCount = buildingDetailRows.length;
  const discoveryEntreprisesCount = discoverySiretRows.length;

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
        <span
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-muted-foreground"
          title="Chargement du nom officiel…"
        >
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
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
      <TableCell className={cn("min-w-[10rem] max-w-xl text-xs leading-relaxed", mono && "font-mono")}>
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

  const opConfidenceForLetter = useMemo(() => {
    if (parcelleCluster.length === 0) return row.matchingConfidence;
    return Math.max(...parcelleCluster.map((p) => p.matchingConfidence), row.matchingConfidence);
  }, [parcelleCluster, row.matchingConfidence]);
  const opScoreLetter = operationalScoreLetterFromMatching(opConfidenceForLetter);

  const heroAddress = useMemo(() => {
    const addrs = parcelleCluster
      .map((p) => p.passerelleAddress?.trim())
      .filter((x): x is string => Boolean(x));
    const uniq = Array.from(new Set(addrs));
    if (uniq.length === 1) return uniq[0]!;
    if (uniq.length > 1) return uniq.join(" · ");
    return row.passerelleAddress?.trim() || "Pas d’adresse passerelle";
  }, [parcelleCluster, row.passerelleAddress]);

  const heroTypeLine = useMemo(() => {
    if (row.grain === "building") {
      return `Bâtiment multi-parcelles · empreinte BDNB ${footprintSumTotal.toLocaleString("fr-FR")} m²`;
    }
    if (parcelleCluster.length > 1) {
      return `${parcelleCluster.length} parcelles cadastrales liées (partage) · empreinte BDNB Σ ${footprintSumTotal.toLocaleString("fr-FR")} m² · contours ~${cartePolygonAreaM2.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} m²`;
    }
    return `Parcelle cadastrale · empreinte BDNB ${footprintSumTotal.toLocaleString("fr-FR")} m² · contour ~${cartePolygonAreaM2.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} m²`;
  }, [row.grain, parcelleCluster, footprintSumTotal, cartePolygonAreaM2]);

  const geoPillLabel = (() => {
    const n = (row.nomIris || "").trim().replace(/\s+/g, " ");
    if (n) return n.slice(0, 26).toUpperCase();
    const ci = (row.codeInsee || "").trim();
    if (ci.length >= 2) return `DEPT. ${ci.slice(0, 2)}`;
    return "ZONE";
  })();
  const empreinteM2Formatted = `${footprintSumTotal.toLocaleString("fr-FR")} m²`;
  const contourM2Formatted = `${cartePolygonAreaM2.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} m²`;
  const kwcRounded = `${Math.round(kwpEst)} kWc`;

  return (
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
        <p className="drawer-discovery-subtitle">{heroTypeLine}</p>
        <div className="drawer-discovery-pills">
          <span
            className="drawer-discovery-pill drawer-discovery-pill-score"
            title={`Score opérationnel (matching V5) : ${scoreDisplay}`}
          >
            Score {opScoreLetter}
          </span>
          <span className="drawer-discovery-pill drawer-discovery-pill-inverse">{kwcRounded}</span>
          <span
            className="drawer-discovery-pill drawer-discovery-pill-muted"
            title="Empreinte au sol des bâtiments (BDNB, Σ footprint)"
          >
            Empreinte {empreinteM2Formatted}
          </span>
          <span
            className="drawer-discovery-pill drawer-discovery-pill-muted"
            title={
              row.grain === "parcelle"
                ? parcelleCluster.length > 1
                  ? "Somme des aires des polygones parcelles (approx. géodésique locale)"
                  : "Aire du polygone parcelle sur la carte (approx. géodésique locale)"
                : "Aire du polygone affiché (bâtiment) sur la carte"
            }
          >
            {row.grain === "parcelle"
              ? parcelleCluster.length > 1
                ? "Contours parcelles"
                : "Contour parcelle"
              : "Contour carte"}{" "}
            {contourM2Formatted}
          </span>
          <span
            className="drawer-discovery-pill drawer-discovery-pill-muted"
            title={row.nomIris || row.codeInsee}
          >
            {geoPillLabel}
          </span>
          <span className="drawer-discovery-pill drawer-discovery-pill-muted">Ombrage non estimé</span>
          {multiEntreprises ? (
            <span className="drawer-discovery-pill drawer-discovery-pill-secondary">Multi-entreprises</span>
          ) : null}
          {parcelleCluster.length > 1 ? (
            <span
              className="drawer-discovery-pill drawer-discovery-pill-secondary"
              title="Même composante connexe via bâtiments en statut « partage » (matching V5)"
            >
              {parcelleCluster.length} cadastres liés
            </span>
          ) : null}
        </div>
      </div>

      <TabsList className="w-full">
        <TabsTrigger value="terrain">Terrain</TabsTrigger>
        <TabsTrigger value="solaire">Solaire</TabsTrigger>
        <TabsTrigger value="batiments" className="inline-flex items-center gap-1.5">
          <span>Bâtiments</span>
          <span
            className="rounded px-1 py-px text-[0.625rem] font-medium tabular-nums text-muted-foreground"
            aria-label={`${discoveryBatimentsCount} bâtiment${discoveryBatimentsCount !== 1 ? "s" : ""}`}
          >
            {discoveryBatimentsCount}
          </span>
        </TabsTrigger>
        <TabsTrigger value="entreprises" className="inline-flex items-center gap-1.5">
          <span>Entreprises</span>
          <span
            className="rounded px-1 py-px text-[0.625rem] font-medium tabular-nums text-muted-foreground"
            aria-label={`${discoveryEntreprisesCount} établissement${discoveryEntreprisesCount !== 1 ? "s" : ""}`}
          >
            {discoveryEntreprisesCount}
          </span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="terrain" className="drawer-discovery-panel space-y-4">
        <section aria-labelledby="discovery-terrain-ppm">
          <h4 id="discovery-terrain-ppm" className="drawer-discovery-section-title">
            SIREN propriétaires (passerelle PPM)
          </h4>
          {passerelleFlat.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-3 text-[0.6875rem] text-muted-foreground">
              Aucune ligne PPM pour {parcelleCluster.length > 1 ? "ces parcelles" : "cette parcelle"} (
              <span className="font-mono text-foreground/80">passerelle_addresses_json</span> vide).
            </div>
          ) : (
            <div className="drawer-discovery-table-wrap">
              <Table>
                <TableHeader>
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableHead className="min-w-[9rem]">Parcelle</TableHead>
                    <TableHead className="min-w-[7rem]">SIREN</TableHead>
                    <TableHead className="min-w-[12rem]">Raison sociale (PPM)</TableHead>
                    <TableHead className="min-w-[13rem]">Adresse (PPM)</TableHead>
                    <TableHead className="min-w-[4rem]">Lignes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {passerelleFlat.map(({ parcelleLabel, ppm: p }, i) => {
                    const siren = String(p.siren || "").trim() || "—";
                    const key = `${parcelleLabel}-${siren}-${i}`;
                    const addrPpm = (p.address || "").trim() || "—";
                    return (
                      <TableRow key={key} className="border-0">
                        <TableCell className="min-w-[9rem] whitespace-nowrap font-mono text-[0.65rem] align-top text-muted-foreground">
                          {parcelleLabel}
                        </TableCell>
                        <TableCell className="min-w-[7rem] whitespace-nowrap font-mono text-xs align-top">
                          <span title={siren !== "—" ? siren : undefined}>{siren}</span>
                        </TableCell>
                        <TableCell className="min-w-[12rem] max-w-[20rem] align-top text-xs">
                          {discoveryRaisonSocialeDisplay(p.siren, p.denomination)}
                        </TableCell>
                        <TableCell className="min-w-[13rem] max-w-[22rem] align-top text-xs leading-relaxed text-muted-foreground">
                          <span
                            className="block min-w-0 max-w-full truncate whitespace-nowrap"
                            title={addrPpm !== "—" ? addrPpm : undefined}
                          >
                            {addrPpm}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
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

        <section aria-labelledby="discovery-terrain-parcelle">
          <h4 id="discovery-terrain-parcelle" className="drawer-discovery-section-title">
            Détail parcelle & adresse
          </h4>
          {terrainDetailParcelles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-3 text-[0.6875rem] text-muted-foreground">
              Aucune parcelle cadastrale liée à cette entité pour le détail terrain.
            </div>
          ) : (
            <div className="space-y-4">
              {terrainDetailParcelles.map((pr) => (
                <div key={pr.id} className="space-y-2">
                  {terrainDetailParcelles.length > 1 ? (
                    <p className="text-[0.65rem] font-semibold leading-tight text-muted-foreground font-mono">
                      {pr.section && pr.numeroNorm ? `${pr.section} ${pr.numeroNorm}` : pr.id} · INSEE{" "}
                      {pr.codeInsee || "—"}
                    </p>
                  ) : null}
                  <div className="drawer-discovery-table-wrap">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-0 hover:bg-transparent">
                          <TableHead className="min-w-[11rem] whitespace-nowrap">Champ</TableHead>
                          <TableHead className="min-w-[14rem]">Valeur</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow className="border-0">
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">Parcelle</TableCell>
                          {discoveryValueTd(
                            pr.section && pr.numeroNorm ? `${pr.section} ${pr.numeroNorm}` : "—",
                            true
                          )}
                        </TableRow>
                        <TableRow className="border-0">
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            Commune (INSEE)
                          </TableCell>
                          {discoveryValueTd(pr.codeInsee || "—", true)}
                        </TableRow>
                        <TableRow className="border-0">
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">IRIS</TableCell>
                          {discoveryValueTd(
                            (pr.codeIris || "").trim()
                              ? `${pr.codeIris}${pr.nomIris ? ` (${pr.nomIris})` : ""}`
                              : "—"
                          )}
                        </TableRow>
                        <TableRow className="border-0">
                          <TableCell className="max-w-[11rem] whitespace-normal text-xs leading-snug text-muted-foreground">
                            Adresse passerelle (PPM)
                          </TableCell>
                          {discoveryValueTd(pr.passerelleAddress?.trim() || "—", { singleLine: true })}
                        </TableRow>
                        <TableRow className="border-0">
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            Statut SIREN parcelle
                          </TableCell>
                          {discoveryValueTd(pr.sirenStatus || "—", true)}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </TabsContent>

      <TabsContent value="solaire" className="drawer-discovery-panel space-y-3">
        <div className="drawer-discovery-callout">
          <p className="font-semibold text-foreground">Écart par rapport à une fiche prospect</p>
          <ul className="mt-2 list-inside list-disc space-y-1.5 text-muted-foreground">
            <li>
              <span className="text-foreground">Type de lieu Google</span> (commerce, bureaux, etc.) : profil de
              consommation <span className="font-mono text-foreground">« other »</span> — estimation générique kWh/m²/an
              × empreinte BDNB.
            </li>
            <li>
              <span className="text-foreground">Consommation réelle</span> : pas de données énergie du site, ni
              simulation batterie / autoconsommation détaillée.
            </li>
            <li>
              <span className="text-foreground">Toit / orientation</span> : PVGIS au centroïde
              {parcelleCluster.length > 1
                ? " (moyenne pondérée par la surface de chaque polygone parcelle du groupe)"
                : " du polygone carte"}{" "}
              avec inclinaison et azimuth optimaux, pas le modèle 3D du toit prospect.
            </li>
          </ul>
        </div>

        {footprintSumTotal <= 0 || kwpEst <= 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
            Empreinte ou kWc nul : graphique production / consommation non affiché.
          </div>
        ) : !centroid ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
            Centroïde introuvable : impossible d’appeler PVGIS.
          </div>
        ) : discoveryPvgisLoading ? (
          <div className="drawer-discovery-chart-shell space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-[220px] w-full rounded-lg" />
          </div>
        ) : discoveryPvgisError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            {discoveryPvgisError}
          </div>
        ) : discoveryChartMonthlyData.length > 0 ? (
          <div className="drawer-discovery-chart-shell">
            <div className="mb-1 flex shrink-0 items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="drawer-discovery-subpanel-title">Production / consommation</span>
                <span className="text-[0.65rem] leading-snug text-muted-foreground">
                  Mensuel kWh — conso estimée profil « other » ×{" "}
                  {footprintSumTotal.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} m²
                </span>
              </div>
              <div
                role="tablist"
                className="drawer-discovery-segmented"
                aria-label="Vue du graphique"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={discoveryChartViewMode === "monthly"}
                  onClick={() => setDiscoveryChartViewMode("monthly")}
                  className={cn(
                    discoveryChartViewMode === "monthly"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Mensuel
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={discoveryChartViewMode === "daily"}
                  onClick={() => setDiscoveryChartViewMode("daily")}
                  className={cn(
                    discoveryChartViewMode === "daily"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Journalier
                </button>
              </div>
            </div>
            <div className="h-[240px] min-w-0 w-full">
              <MonthlyProductionChart
                viewMode={discoveryChartViewMode}
                onViewModeChange={setDiscoveryChartViewMode}
                selectedMonthIndex={discoveryChartMonthIndex}
                onSelectedMonthIndexChange={setDiscoveryChartMonthIndex}
                data={discoveryChartMonthlyData}
                dailyData={discoveryChartDailyData}
              />
            </div>
          </div>
        ) : null}
      </TabsContent>

      <TabsContent value="batiments" className="drawer-discovery-panel space-y-3">
        <div>
          <p className="drawer-discovery-subpanel-title">Constructions BDNB (export matching)</p>
          <p className="mt-1 max-w-prose text-[0.7rem] leading-relaxed text-muted-foreground">
            Colonne « N° » : dernier bloc de chiffres de l’id construction BDNB. Survol pour l’id complet et le groupe.{" "}
            <span className="font-mono text-foreground/90">buildings_json</span>.
          </p>
        </div>
        {buildingDetailRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
            Aucun détail bâtiment dans l’export pour cette entité (parcelle sans{" "}
            <span className="font-mono text-foreground/80">buildings_json</span> ou bâtiment non renseigné).
          </div>
        ) : (
          <div className="drawer-discovery-table-wrap">
            <Table>
              <TableHeader>
                <TableRow className="border-0 hover:bg-transparent">
                  <TableHead className="min-w-[4rem]">N°</TableHead>
                  <TableHead className="min-w-[4.5rem]">Année</TableHead>
                  <TableHead className="min-w-[6rem]">Empreinte</TableHead>
                  <TableHead className="min-w-[6rem]">Intersect.</TableHead>
                  <TableHead className="min-w-[14rem]">Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buildingDetailRows.map((b, i) => (
                  <TableRow key={`${b.batimentConstructionId}-${i}`} className="border-0">
                    <TableCell
                      className="whitespace-nowrap font-mono text-xs tabular-nums"
                      title={
                        b.batimentConstructionId && b.batimentConstructionId !== "—"
                          ? `Construction BDNB : ${b.batimentConstructionId}${
                              b.batimentGroupeId ? ` · groupe : ${b.batimentGroupeId}` : ""
                            }`
                          : undefined
                      }
                    >
                      {bdnbConstructionShortNumber(b.batimentConstructionId)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                      {b.anneeConstruction != null ? b.anneeConstruction : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                      {b.footprintM2 != null
                        ? `${b.footprintM2.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} m²`
                        : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                      {b.intersectionAreaM2 != null
                        ? `${b.intersectionAreaM2.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} m²`
                        : "—"}
                    </TableCell>
                    <TableCell className="min-w-[12rem] max-w-[24rem] text-xs leading-relaxed text-muted-foreground">
                      {(() => {
                        const parts = [
                          b.matchingStatus || "—",
                          b.matchingDecision?.trim(),
                          b.matchingSirenSelected
                            ? `SIREN retenu : ${b.matchingSirenSelected}`
                            : "",
                        ].filter(Boolean);
                        const line = parts.join(" · ");
                        return (
                          <span
                            className="block min-w-0 break-words font-mono text-foreground"
                            title={line}
                          >
                            {line}
                          </span>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="entreprises" className="drawer-discovery-panel-last space-y-3">
        <div>
          <p className="drawer-discovery-subpanel-title">Établissements (matching adresse)</p>
          <p className="mt-1 max-w-prose text-[0.7rem] leading-relaxed text-muted-foreground">
            SIRET issus de <span className="font-mono text-foreground/90">sirets_json</span> ; NAF et effectifs
            complétés via api.gouv si absents du JSON.
          </p>
        </div>
        <div className="drawer-discovery-table-wrap">
          <Table>
            <TableHeader>
              <TableRow className="border-0 hover:bg-transparent">
                <TableHead className="min-w-[12rem]">Raison sociale</TableHead>
                <TableHead className="min-w-[6.5rem]">SIREN</TableHead>
                <TableHead className="min-w-[8.5rem]">SIRET</TableHead>
                <TableHead className="min-w-[7rem]">Code NAF (APE)</TableHead>
                <TableHead className="min-w-[9rem]">Effectifs</TableHead>
                <TableHead className="min-w-[13rem]">Adresse</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
            {discoverySiretRows.length === 0 ? (
              <TableRow className="border-0">
                <TableCell colSpan={6} className="py-10 text-center text-xs leading-relaxed text-muted-foreground">
                  Aucun établissement matché sur l’adresse passerelle (
                  <span className="font-mono text-foreground/80">sirets_json</span> vide ou matching non abouti).
                </TableCell>
              </TableRow>
            ) : (
              discoverySiretRows.map((r) => {
                const e = r.e;
                const gouv = discoveryGouvEtabBySiret[e.siret];
                const nafFromJson = (e.activite_principale || "").trim();
                const nafFromApi = gouv?.status === "ok" ? (gouv.naf || "").trim() : "";
                const naf = nafFromJson || nafFromApi;
                const trancheCode = (e.tranche_effectifs || "").trim() || (gouv?.status === "ok" ? gouv.tranche || "" : "");
                const effYearJson = (e.annee_effectifs || "").trim();
                const effYearApi = gouv?.status === "ok" ? (gouv.annee || "").trim() : "";
                const effYear = effYearJson || effYearApi;
                const effLib = labelTrancheEffectifs(trancheCode || undefined);
                const effectifsCell =
                  gouv?.status === "loading" && !trancheCode ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      api.gouv…
                    </span>
                  ) : effLib === "—" && !effYear ? (
                    "—"
                  ) : effYear ? (
                    `${effLib} (${effYear})`
                  ) : (
                    effLib
                  );
                const nafCell =
                  gouv?.status === "loading" && !naf ? (
                    <span className="inline-flex max-w-full items-center gap-1 truncate text-muted-foreground">
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                      …
                    </span>
                  ) : (
                    naf || "—"
                  );
                const nafTitle = typeof nafCell === "string" ? nafCell : undefined;
                const effTitle =
                  typeof effectifsCell === "string" ? effectifsCell : undefined;
                const addr = (e.adresse_etablissement || "").trim() || "—";
                return (
                  <TableRow key={r.key} className="border-0">
                    <TableCell className="min-w-[12rem] max-w-[20rem] align-top">
                      {discoveryRaisonSocialeDisplay(e.siren, e.denomination)}
                    </TableCell>
                    <TableCell className="min-w-[6.5rem] whitespace-nowrap font-mono text-xs align-top">
                      <span title={e.siren || undefined}>{e.siren || "—"}</span>
                    </TableCell>
                    <TableCell className="min-w-[8.5rem] whitespace-nowrap font-mono text-xs align-top">
                      <span title={e.siret}>{e.siret}</span>
                    </TableCell>
                    <TableCell className="min-w-[7rem] max-w-[13rem] align-top text-xs">
                      {typeof nafCell === "string" ? (
                        <span className="block min-w-0 break-words font-mono leading-relaxed" title={nafTitle}>
                          {nafCell}
                        </span>
                      ) : (
                        nafCell
                      )}
                    </TableCell>
                    <TableCell className="min-w-[9rem] max-w-[15rem] align-top text-xs">
                      {typeof effectifsCell === "string" ? (
                        <span className="block min-w-0 break-words leading-relaxed" title={effTitle}>
                          {effectifsCell}
                        </span>
                      ) : (
                        effectifsCell
                      )}
                    </TableCell>
                    <TableCell className="min-w-[13rem] max-w-[22rem] align-top text-xs leading-relaxed text-muted-foreground">
                      <span
                        className="block min-w-0 max-w-full truncate whitespace-nowrap"
                        title={addr !== "—" ? addr : undefined}
                      >
                        {addr}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        </div>
      </TabsContent>
    </Tabs>
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
}

export function ProspectDrawer({
  prospect,
  bdnbLoading = false,
  isOpen,
  onOpenChange,
  onAddToPipeline,
  onSaveSuccess,
  onProspectUpdate,
  voirHref = (id) => `/solar-scout?prospectId=${id}`,
  discoveryRow = null,
  discoveryLinkedParcelleRows = null,
}: ProspectDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isOnMap = pathname?.includes("/solar-scout") ?? false;
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

  const handleOpenSharePage = async () => {
    if (!prospect?.id) return;

    const open = (shareToken: string) => {
      if (typeof window === "undefined") return;
      const w = window.open(`/p/${shareToken}`, "_blank", "noopener,noreferrer");
      if (w) w.opener = null;
    };

    // Si déjà généré, on ouvre directement (pas de loading inutile)
    if (prospect.shareToken) {
      open(prospect.shareToken);
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

      await updateProspect(prospect.id, { shareToken, commercialReferent });
      onProspectUpdate?.({ shareToken, commercialReferent });

      open(shareToken);
    } catch {
      toast.error("Erreur lors de l’ouverture de la page partagée", {
        description: "Veuillez réessayer.",
      });
    } finally {
      setIsGeneratingLink(false);
    }
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
    const sortedByCapacity = [...visibleBatteries].sort((a, b) => b.capacityKwh - a.capacityKwh);
    const largestModel = sortedByCapacity[0];
    if (!largestModel) return null;

    const target = recommendedBatteryKwh;

    if (target >= largestModel.capacityKwh) {
      // Cible haute : plus grosse batterie, optimiser le count
      const maxPerRack = largestModel.maxBatteriesPerRack ?? 20;
      let bestCount = 1;
      let bestEcart = Math.abs(largestModel.capacityKwh - target);
      for (let c = 2; c <= maxPerRack; c++) {
        const totalKwh = largestModel.capacityKwh * c;
        const ecart = Math.abs(totalKwh - target);
        if (ecart < bestEcart) {
          bestEcart = ecart;
          bestCount = c;
        }
      }
      return { model: largestModel, count: bestCount };
    }

    // Cible basse : meilleur match parmi tous les modèles
    let best: { model: BatteryReference; count: number; ecart: number } | null = null;
    for (const model of visibleBatteries) {
      const maxPerRack = model.maxBatteriesPerRack ?? 20;
      for (let c = 1; c <= maxPerRack; c++) {
        const totalKwh = model.capacityKwh * c;
        const ecart = Math.abs(totalKwh - target);
        const isBetter =
          best == null ||
          ecart < best.ecart ||
          (ecart === best.ecart && c < best.count) ||
          (ecart === best.ecart && c === best.count && model.capacityKwh > best.model.capacityKwh);
        if (isBetter) best = { model, count: c, ecart };
      }
    }
    return best ? { model: best.model, count: best.count } : null;
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
                  <div className="flex flex-col bg-gray-100 rounded-xl py-3 px-4 pb-2">
                    <div className="flex shrink-0 items-start justify-between gap-2 mb-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] uppercase tracking-wide text-gray-500">Production</span>
                        {(() => {
                          const surfaceM2 =
                            prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ??
                            prospect.roofSurface?.area ??
                            0;
                          const placeType = prospect.placeType || "other";

                          if (chartViewMode === "daily" && effectiveConfig.productionPerKwp) {
                            const { dailyTypical } = getProductionFromPerKwp(
                              effectiveConfig.productionPerKwp.productionPerKwpAnnual,
                              effectiveConfig.productionPerKwp.productionPerKwpMonthly,
                              effectiveConfig.effectiveKwp
                            );
                            const dailyProductionKwh = dailyTypical.reduce((s, v) => s + (v ?? 0), 0);
                            const hourlyConsumptionPerM2 = getHourlyConsumptionProfileKwhPerM2(placeType);
                            const dailyConsumptionKwh =
                              surfaceM2 * (hourlyConsumptionPerM2?.reduce((s, v) => s + (v ?? 0), 0) ?? 0);
                            const fmt = (kwh: number) =>
                              kwh >= 1000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${Math.round(kwh)} kWh`;
                            return (
                              <>
                                <span className="text-xs text-gray-600 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-black shrink-0" />
                                  {fmt(dailyProductionKwh)} /j
                                </span>
                                <span className="text-xs text-gray-600 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[hsl(0,0%,72%)]" />
                                  {fmt(dailyConsumptionKwh)} /j
                                </span>
                              </>
                            );
                          }

                          const totalConsumptionKwh = getEnergyConsumption(placeType) * surfaceM2;
                          const consumptionGwh = totalConsumptionKwh / 1_000_000;
                          const productionKwh = effectiveConfig.effectiveAnnualProductionKwh;
                          const productionGwh = productionKwh / 1_000_000;
                          return (
                            <>
                              <span className="text-xs text-gray-600 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-black shrink-0" />
                                {productionGwh >= 0.001 ? productionGwh.toFixed(3) : productionGwh.toFixed(6)} GWh
                              </span>
                              <span className="text-xs text-gray-600 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[hsl(0,0%,72%)]" />
                                {consumptionGwh >= 0.001 ? consumptionGwh.toFixed(3) : consumptionGwh.toFixed(6)} GWh
                              </span>
                            </>
                          );
                        })()}
                      </div>
                      <div
                        role="tablist"
                        className="inline-flex rounded-md border border-border bg-muted/50 p-0.5 shrink-0"
                        aria-label="Vue du graphique"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={chartViewMode === "monthly"}
                          onClick={() => setChartViewMode("monthly")}
                          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                            chartViewMode === "monthly"
                              ? "bg-background text-foreground shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Mensuel
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={chartViewMode === "daily"}
                          onClick={() => setChartViewMode("daily")}
                          className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            chartViewMode === "daily"
                              ? "bg-background text-foreground shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Journalier
                        </button>
                      </div>
                    </div>
                    <div className="h-[260px] min-w-0 w-full">
                      <MonthlyProductionChart
                        key={configurationMode}
                        viewMode={chartViewMode}
                        onViewModeChange={setChartViewMode}
                        selectedMonthIndex={chartSelectedMonthIndex}
                        onSelectedMonthIndexChange={setChartSelectedMonthIndex}
                        data={chartData}
                        dailyData={chartDailyData}
                      />
                    </div>
                  </div>

                  {/* Switch batterie : valeur effective = prospect.includeBatteryOverride ?? settings.includeBattery (défaut true) */}
                  {(prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ?? prospect.roofSurface?.area ?? 0) > 0 && (
                    <div className="flex items-center justify-between rounded-xl border border-border bg-white p-3">
                      <div className="flex items-center gap-2">
                        <Battery className="h-4 w-4 text-muted-foreground" />
                        <Label htmlFor="include-battery" className="text-sm font-medium cursor-pointer">Inclure batterie</Label>
                      </div>
                      <Switch
                        id="include-battery"
                        className="data-[state=checked]:bg-[#0000FF]"
                        checked={prospect.includeBatteryOverride ?? getSolarEquipmentSettings().includeBattery ?? true}
                        onCheckedChange={(checked) => {
                          if (onProspectUpdate) {
                            onProspectUpdate({ includeBatteryOverride: checked });
                          }
                        }}
                      />
                    </div>
                  )}

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
                <Button
                  variant="default"
                  size="icon"
                  className="h-12 w-12 shrink-0 border-0 bg-gray-100 hover:bg-gray-200 text-gray-700"
                  onClick={handleOpenSharePage}
                  disabled={isGeneratingLink}
                  title={isGeneratingLink ? "Ouverture..." : "Voir la page partagée"}
                  aria-label={isGeneratingLink ? "Ouverture..." : "Voir la page partagée"}
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
        ) : null}
    </div>
  );
}
