"use client";

import { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Image from "next/image";
import { MapPin, Phone, Globe, Sun, Zap, Battery, Info, X, MoreVertical, Link2, Eye, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  usePanelReferences,
  useInverterReferences,
  useBatteryReferences,
  useProspectsForPipeline,
} from "@/lib/swr-hooks";
import { getEnergyConsumption } from "@/lib/building-energy-consumption";
import { updateProspect } from "@/lib/firestore";
import { getCommercialReferent, buildCommercialReferentFromUser } from "@/lib/commercial-mock";
import { getUserProfile } from "@/lib/firestore-user-profile";
import { getSolarEquipmentSettings } from "@/lib/solar-settings";
import type { Prospect, ProspectPipelineStatus, PanelReference, InverterReference, BatteryReference } from "@/types";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Cell, PieChart, Pie, Cell as PieCell } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDrawer } from "@/lib/drawer-context";
import { ProspectDrawer } from "@/components/solar-scout/ProspectDrawer";
import { loadMatchingV5DrawerContextForProspect } from "@/lib/pipeline-matching-v5-drawer-context";

const PIPELINE_DEFAULT_CODE_INSEE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SCOUT_MATCHING_V5_CODE_INSEE?.trim()) || "33318";

function EquipmentThumbnail({
  equipment,
  fallbackIcon: FallbackIcon,
  alt,
}: {
  equipment: PanelReference | InverterReference | BatteryReference | null;
  fallbackIcon: React.ComponentType<{ className?: string }>;
  alt: string;
}) {
  if (!equipment)
    return <div className="w-8 h-8 rounded-md bg-muted/50 shrink-0" />;
  const src = equipment.imageUrl;
  return (
    <div
      className="w-8 h-8 rounded-md overflow-hidden bg-muted flex items-center justify-center shrink-0 ring-1 ring-border/50"
      title={equipment.name}
    >
      {src ? (
        <Image src={src} alt={alt} width={32} height={32} className="object-contain w-full h-full" unoptimized />
      ) : (
        <FallbackIcon className="h-4 w-4 text-muted-foreground" />
      )}
    </div>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const color =
    score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="min-w-[64px]" title={`${score}/100`}>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<ProspectPipelineStatus, string> = {
  nouveau: "Nouveau",
  en_cours: "En cours",
  devis_envoye: "Devis envoyé",
  converti: "Converti",
  perdu: "Perdu",
};

const STATUS_COLORS: Record<ProspectPipelineStatus, string> = {
  nouveau: "hsl(217, 91%, 60%)",
  en_cours: "hsl(38, 92%, 50%)",
  devis_envoye: "hsl(142, 76%, 36%)",
  converti: "hsl(142, 71%, 45%)",
  perdu: "hsl(0, 84%, 60%)",
};

const chartConfig = {
  nouveau: {
    label: "Nouveau",
    color: STATUS_COLORS.nouveau,
  },
  en_cours: {
    label: "En cours",
    color: STATUS_COLORS.en_cours,
  },
  devis_envoye: {
    label: "Devis envoyé",
    color: STATUS_COLORS.devis_envoye,
  },
  converti: {
    label: "Converti",
    color: STATUS_COLORS.converti,
  },
  perdu: {
    label: "Perdu",
    color: STATUS_COLORS.perdu,
  },
} satisfies ChartConfig;

function HomePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { setIsDrawerOpen, setDrawerContent } = useDrawer();
  const { data: panelsData } = usePanelReferences(user?.uid ?? null);
  const { data: invertersData } = useInverterReferences(user?.uid ?? null);
  const { data: batteriesData } = useBatteryReferences(user?.uid ?? null);
  const {
    data: prospectsData,
    error: prospectsError,
    isLoading: prospectsLoading,
    mutate: mutateProspects,
  } = useProspectsForPipeline(user?.uid ?? null);

  const prospects = prospectsData ?? [];
  const panelRef = panelsData?.find((p) => p.recommended) ?? panelsData?.[0] ?? null;
  const inverterRef = invertersData?.find((i) => i.recommended) ?? invertersData?.[0] ?? null;
  const batteryRef = batteriesData?.find((b) => b.recommended) ?? batteriesData?.[0] ?? null;

  const searchParams = useSearchParams();

  /** Anciens liens `?prospectId=` : ne plus ouvrir de drawer — nettoyer l’URL. */
  useEffect(() => {
    if (!searchParams.get("prospectId")) return;
    router.replace("/");
  }, [router, searchParams]);

  const error = prospectsError ? (prospectsError.message || "Erreur lors du chargement") : null;
  const [filterStatus, setFilterStatus] = useState<string>("all");
  /** Filtre source pipeline : `all` | `discovery_v5` | `legacy` (hors matching V5). */
  const [filterPlaceType, setFilterPlaceType] = useState<string>("all");
  const [leadPeriod, setLeadPeriod] = useState<"daily" | "weekly" | "yearly" | "all">("weekly");
  const [selectedProspectId, setSelectedProspectId] = useState<string | null>(null);

  const handlePipelineDrawerOpenChange = useCallback(
    (open: boolean) => {
      setIsDrawerOpen(open);
      if (!open) {
        setSelectedProspectId(null);
        setDrawerContent(null);
      }
    },
    [setDrawerContent, setIsDrawerOpen]
  );

  useEffect(() => {
    return () => {
      setDrawerContent(null);
      setIsDrawerOpen(false);
    };
  }, [setDrawerContent, setIsDrawerOpen]);

  const selectedProspect = useMemo(
    () => (selectedProspectId ? prospects.find((p) => p.id === selectedProspectId) ?? null : null),
    [prospects, selectedProspectId]
  );

  const onDiscoveryPipelineAddedFromHome = useCallback(() => {
    void mutateProspects();
  }, [mutateProspects]);

  useEffect(() => {
    if (!selectedProspect?.id) {
      setIsDrawerOpen(false);
      setDrawerContent(null);
      return;
    }
    if (
      selectedProspect.pipelineEntrySource !== "discovery_v5" ||
      !String(selectedProspect.matchingV5RowId ?? "").trim()
    ) {
      toast.info("Cette fiche n’est pas au format Découverte.", {
        description: "Seuls les leads ajoutés depuis la Découverte (matching V5) s’ouvrent ici.",
      });
      setSelectedProspectId(null);
      return;
    }

    let cancelled = false;
    setIsDrawerOpen(true);
    setDrawerContent(
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 bg-white p-6 text-center text-sm text-muted-foreground">
        Chargement de l’emprise…
      </div>
    );

    void (async () => {
      const ctx = await loadMatchingV5DrawerContextForProspect(selectedProspect, PIPELINE_DEFAULT_CODE_INSEE);
      if (cancelled) return;
      if (!ctx.ok) {
        toast.error(ctx.message);
        setSelectedProspectId(null);
        setIsDrawerOpen(false);
        setDrawerContent(null);
        return;
      }
      const pid = selectedProspect.id!;
      setDrawerContent(
        <ProspectDrawer
          key={pid}
          prospect={null}
          discoveryRow={ctx.anchor}
          discoveryLinkedParcelleRows={ctx.discoveryLinkedParcelleRowsForDrawer}
          discoveryExistingPipelineProspect={selectedProspect}
          bdnbLoading={false}
          isOpen
          onOpenChange={handlePipelineDrawerOpenChange}
          voirHref={(_prospectId) => "/discovery"}
          onDiscoveryPipelineAdded={onDiscoveryPipelineAddedFromHome}
        />
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [
    selectedProspect,
    setDrawerContent,
    setIsDrawerOpen,
    handlePipelineDrawerOpenChange,
    onDiscoveryPipelineAddedFromHome,
  ]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  // Calcul des prospects filtrés
  const filteredProspects = useMemo(() => {
    return prospects.filter((prospect) => {
      const status = prospect.pipelineStatus ?? "nouveau";
      const matchesStatus = filterStatus === "all" || status === filterStatus;
      const isDiscovery = prospect.pipelineEntrySource === "discovery_v5";
      const matchesSource =
        filterPlaceType === "all" ||
        (filterPlaceType === "discovery_v5" && isDiscovery) ||
        (filterPlaceType === "legacy" && !isDiscovery);
      return matchesStatus && matchesSource;
    });
  }, [prospects, filterStatus, filterPlaceType]);

  // Calcul des leads selon la période sélectionnée
  const leadsCount = useMemo(() => {
    const now = new Date();
    let startDate: Date | null = null;

    if (leadPeriod === "daily") {
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    } else if (leadPeriod === "weekly") {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (leadPeriod === "yearly") {
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    } else if (leadPeriod === "all") {
      return prospects.length;
    }

    if (!startDate) return prospects.length;

    return prospects.filter((prospect) => {
      if (!prospect.createdAt) return false;
      const createdAt = prospect.createdAt instanceof Date 
        ? prospect.createdAt 
        : new Date(prospect.createdAt);
      return createdAt >= startDate!;
    }).length;
  }, [prospects, leadPeriod]);

  // Calcul des leads de la période précédente pour la progression
  const leadsPreviousPeriod = useMemo(() => {
    if (leadPeriod === "all") return null;
    
    const now = new Date();
    let periodStart: Date;
    let previousPeriodStart: Date;
    let previousPeriodEnd: Date;

    if (leadPeriod === "daily") {
      periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      previousPeriodStart = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      previousPeriodEnd = periodStart;
    } else if (leadPeriod === "weekly") {
      periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      previousPeriodStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      previousPeriodEnd = periodStart;
    } else if (leadPeriod === "yearly") {
      periodStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      previousPeriodStart = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);
      previousPeriodEnd = periodStart;
    } else {
      return null;
    }

    return prospects.filter((prospect) => {
      if (!prospect.createdAt) return false;
      const createdAt = prospect.createdAt instanceof Date 
        ? prospect.createdAt 
        : new Date(prospect.createdAt);
      return createdAt >= previousPeriodStart && createdAt < previousPeriodEnd;
    }).length;
  }, [prospects, leadPeriod]);

  // Calcul de la progression
  const periodProgress = useMemo(() => {
    if (leadPeriod === "all" || leadsPreviousPeriod === null) return null;
    if (leadsPreviousPeriod === 0) return null;
    const diff = leadsCount - leadsPreviousPeriod;
    const percent = Math.round((diff / leadsPreviousPeriod) * 100);
    return { diff, percent };
  }, [leadsCount, leadsPreviousPeriod, leadPeriod]);

  // Libellé de la période
  const periodLabel = useMemo(() => {
    switch (leadPeriod) {
      case "daily": return "LEADS DU JOUR";
      case "weekly": return "LEADS DE LA SEMAINE";
      case "yearly": return "LEADS DE L'ANNÉE";
      case "all": return "TOTAL DES LEADS";
      default: return "LEADS";
    }
  }, [leadPeriod]);

  // Nombre total de leads
  const totalLeads = useMemo(() => {
    return prospects.length;
  }, [prospects]);

  // KPIs pipeline : Découverte (V5) vs hors découverte (données non canoniques pour ce produit)
  const kpisByPlaceType = useMemo(() => {
    let discovery = 0;
    let legacy = 0;
    prospects.forEach((prospect) => {
      if (prospect.pipelineEntrySource === "discovery_v5") discovery += 1;
      else legacy += 1;
    });
    return { discovery_v5: discovery, legacy } as Record<string, number>;
  }, [prospects]);

  const chartDataByPlaceType = useMemo(() => {
    const colors = ["hsl(217, 91%, 60%)", "hsl(38, 92%, 50%)"];
    const raw: Array<[string, number]> = [
      ["discovery_v5", kpisByPlaceType.discovery_v5 ?? 0],
      ["legacy", kpisByPlaceType.legacy ?? 0],
    ];
    const entries = raw.filter(([, c]) => c > 0);
    return entries.map(([type, count], index) => ({
      name: type === "discovery_v5" ? "Découverte (V5)" : "Hors découverte",
      value: count,
      typeKey: type,
      color: colors[index % colors.length],
    }));
  }, [kpisByPlaceType]);

  const sourceFilterOptions = useMemo(() => {
    const hasD = prospects.some((p) => p.pipelineEntrySource === "discovery_v5");
    const hasL = prospects.some((p) => p.pipelineEntrySource !== "discovery_v5");
    const opts: { value: string; label: string }[] = [];
    if (hasD) opts.push({ value: "discovery_v5", label: "Découverte (V5)" });
    if (hasL) opts.push({ value: "legacy", label: "Hors découverte" });
    return opts;
  }, [prospects]);

  // Index Maps pour lookups O(1) du matériel par prospect (règle 7.2 Vercel React Best Practices)
  const panelById = useMemo(
    () => new Map((panelsData ?? []).map((p) => [p.id, p])),
    [panelsData]
  );
  const inverterById = useMemo(
    () => new Map((invertersData ?? []).map((i) => [i.id, i])),
    [invertersData]
  );
  const batteryById = useMemo(
    () => new Map((batteriesData ?? []).map((b) => [b.id, b])),
    [batteriesData]
  );

  // Cache du réglage batterie global (évite appels répétés à getSolarEquipmentSettings dans la boucle)
  const includeBatteryDefault = getSolarEquipmentSettings().includeBattery ?? true;

  const resetFilters = () => {
    setFilterStatus("all");
    setFilterPlaceType("all");
  };

  const [generatingLinkId, setGeneratingLinkId] = useState<string | null>(null);
  const [viewingPageId, setViewingPageId] = useState<string | null>(null);
  const handleGenerateLink = async (prospect: Prospect, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!prospect?.id) return;
    setGeneratingLinkId(prospect.id);
    try {
      const shareToken = prospect.shareToken ?? crypto.randomUUID();
      const commercialReferent = user
        ? buildCommercialReferentFromUser(user, await getUserProfile(user.uid))
        : getCommercialReferent();
      await updateProspect(prospect.id, { shareToken, commercialReferent });
      const updated = { ...prospect, shareToken, commercialReferent };
      mutateProspects((prev) =>
        prev ? prev.map((x) => (x.id === prospect.id ? updated : x)) : prev
      );
      const url = `${typeof window !== "undefined" ? window.location.origin : ""}/p/${shareToken}`;
      await navigator.clipboard.writeText(url);
      toast.success("Lien copié", { description: "Le lien prospect a été copié dans le presse-papiers." });
    } catch {
      toast.error("Erreur lors de la génération du lien", { description: "Veuillez réessayer." });
    } finally {
      setGeneratingLinkId(null);
    }
  };

  const handleViewProspectPage = async (prospect: Prospect, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!prospect?.id) return;
    setViewingPageId(prospect.id);
    try {
      const shareToken = prospect.shareToken ?? crypto.randomUUID();
      const commercialReferent = user
        ? buildCommercialReferentFromUser(user, await getUserProfile(user.uid))
        : getCommercialReferent();
      await updateProspect(prospect.id, { shareToken, commercialReferent });
      const updated = { ...prospect, shareToken, commercialReferent };
      mutateProspects((prev) =>
        prev ? prev.map((x) => (x.id === prospect.id ? updated : x)) : prev
      );
      const url = `${typeof window !== "undefined" ? window.location.origin : ""}/p/${shareToken}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Erreur lors de l'ouverture de la page", { description: "Veuillez réessayer." });
    } finally {
      setViewingPageId(null);
    }
  };

  if (authLoading || (user && prospectsLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5 min-w-0 w-full">
      <div className="max-w-7xl mx-auto w-full min-w-0">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold truncate">Prospects Pipeline</h1>
          <Button asChild variant="default" size="sm" className="shrink-0">
            <Link href="/discovery" className="gap-2">
              <ScanSearch className="h-4 w-4" />
              Ajouter
            </Link>
          </Button>
        </div>

        {error && (
          <Card className="mb-6 border-destructive shadow-none">
            <CardContent className="py-4 text-destructive">{error}</CardContent>
          </Card>
        )}

        {/* Section KPI - Style Energy Bill */}
        {prospects.length > 0 && (
          <div className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-stretch">
              {/* Nombre de leads selon la période */}
              <div className="rounded-xl px-4 py-4 min-h-[130px] flex flex-col justify-between bg-white border border-zinc-200">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">
                    {periodLabel}
                  </span>
                  <Select value={leadPeriod} onValueChange={(value) => setLeadPeriod(value as typeof leadPeriod)}>
                    <SelectTrigger className="h-6 w-[80px] text-[10px] border-0 bg-transparent shadow-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                      <SelectItem value="all">All</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-normal text-gray-700">{leadsCount}</div>
                  {periodProgress !== null ? (
                    <Badge 
                      variant={periodProgress.diff >= 0 ? "lime" : "destructive"}
                      className="text-xs"
                    >
                      {periodProgress.diff >= 0 ? '+' : ''}{periodProgress.diff} ({periodProgress.percent >= 0 ? '+' : ''}{periodProgress.percent}%)
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      —
                    </Badge>
                  )}
                </div>
              </div>

              {/* Nombre total de leads */}
              <div className="rounded-xl px-4 py-4 min-h-[130px] flex flex-col justify-between bg-white border border-zinc-200">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">
                    Total des leads
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" />
                </div>
                <div className="text-2xl font-normal text-gray-700">{totalLeads}</div>
              </div>

            </div>
          </div>
        )}

        {/* Section Filtres */}
        {prospects.length > 0 && (
          <Card className="mb-6 shadow-none">
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-0 sm:min-w-[200px]">
                  <label className="text-sm font-medium mb-2 block">Statut</label>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="Tous les statuts" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les statuts</SelectItem>
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-0 sm:min-w-[200px]">
                  <label className="text-sm font-medium mb-2 block">Source</label>
                  <Select value={filterPlaceType} onValueChange={setFilterPlaceType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Toutes les sources" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Toutes les sources</SelectItem>
                      {sourceFilterOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    variant="outline"
                    onClick={resetFilters}
                    disabled={filterStatus === "all" && filterPlaceType === "all"}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Réinitialiser
                  </Button>
                </div>
              </div>
              {(filterStatus !== "all" || filterPlaceType !== "all") && (
                <div className="mt-4 text-sm text-muted-foreground">
                  {filteredProspects.length} prospect{filteredProspects.length > 1 ? "s" : ""} trouvé{filteredProspects.length > 1 ? "s" : ""}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {prospects.length === 0 ? (
          <Card className="shadow-none">
            <CardContent className="py-12 text-center text-muted-foreground">
              <MapPin className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="mb-4">Aucun prospect dans le pipeline</p>
              <Button asChild>
                <Link href="/discovery">
                  <ScanSearch className="h-4 w-4 mr-2" />
                  Ouvrir la découverte
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-x-auto shadow-none mb-6">
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border/80">
                  <TableHead className="w-12 h-11 px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40" />
                  <TableHead className="min-w-[100px] px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">Nom</TableHead>
                  <TableHead className="min-w-[160px] px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">Adresse</TableHead>
                  <TableHead className="min-w-[80px] px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">Type</TableHead>
                  <TableHead className="min-w-[95px] px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">Statut</TableHead>
                  <TableHead className="text-right w-14 px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 shrink-0">kWp</TableHead>
                  <TableHead className="w-[100px] px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">Score</TableHead>
                  <TableHead className="w-12 px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40" title="Panneau">
                    <Sun className="h-4 w-4 mx-auto" />
                  </TableHead>
                  <TableHead className="w-12 px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40" title="Onduleur">
                    <Zap className="h-4 w-4 mx-auto" />
                  </TableHead>
                  <TableHead className="w-12 px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40" title="Batterie">
                    <Battery className="h-4 w-4 mx-auto" />
                  </TableHead>
                  <TableHead className="text-right w-16 px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 shrink-0">Surface</TableHead>
                  <TableHead className="text-right w-16 px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 shrink-0">Prod.</TableHead>
                  <TableHead className="text-right w-16 px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 shrink-0" title="Consommation annuelle estimée">Conso.</TableHead>
                  <TableHead className="text-right min-w-[80px] px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">Prix</TableHead>
                  <TableHead className="text-right w-16 px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 shrink-0">B-E</TableHead>
                  <TableHead className="min-w-[110px] px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">Contact</TableHead>
                  <TableHead className="text-right w-20 px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 shrink-0">Ajouté</TableHead>
                  <TableHead className="w-12 px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 shrink-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProspects.map((prospect) => {
                  const isDiscovery = prospect.pipelineEntrySource === "discovery_v5";
                  const totalArea =
                    prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ??
                    prospect.solarPotential?.maxArrayAreaMeters2 ??
                    0;
                  const kwp = isDiscovery ? (prospect.solarPotential?.estimatedKwp ?? 0) : 0;
                  const prodPerKwp = isDiscovery ? prospect.solarPotential?.productionPerKwpAnnual : undefined;
                  const productionKwh = isDiscovery
                    ? prospect.solarPotential?.maxKwhPerYear ??
                      (prodPerKwp != null && kwp > 0 ? Math.round(prodPerKwp * kwp) : 0)
                    : 0;
                  const consumptionKwh = isDiscovery
                    ? prospect.annualConsumptionKwhOverride ??
                      (totalArea > 0 ? getEnergyConsumption(prospect.placeType) * totalArea : 0)
                    : 0;
                  const status = prospect.pipelineStatus ?? "nouveau";
                  const priceMin = isDiscovery ? prospect.priceRangeMinEur : undefined;
                  const priceMax = isDiscovery ? prospect.priceRangeMaxEur : undefined;
                  const breakEvenMin = isDiscovery ? prospect.breakEvenMinYears : undefined;
                  const breakEvenMax = isDiscovery ? prospect.breakEvenMaxYears : undefined;
                  const breakEvenLabel =
                    isDiscovery && breakEvenMin != null && breakEvenMax != null
                      ? breakEvenMin === breakEvenMax
                        ? `${breakEvenMin} an${breakEvenMin > 1 ? "s" : ""}`
                        : `${breakEvenMin} – ${breakEvenMax} ans`
                      : "—";
                  const contactPhone =
                    prospect.contact?.nationalPhoneNumber ||
                    prospect.contact?.internationalPhoneNumber;
                  const contactWeb = prospect.contact?.websiteUri;
                  const contactLabel =
                    (contactPhone ||
                      contactWeb ||
                      (prospect.companyLegalName ? String(prospect.companyLegalName) : "") ||
                      (prospect.siret ? String(prospect.siret) : "")) || "";
                  const hasContactRow = isDiscovery && contactLabel.length > 0;
                  const createdAt = prospect.createdAt
                    ? new Date(prospect.createdAt).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "2-digit",
                        year: "2-digit",
                      })
                    : "—";
                  const prospectPanelRef =
                    (prospect.panelReferenceId && panelById.get(prospect.panelReferenceId)) ?? panelRef;
                  const prospectInverterRef =
                    (prospect.inverterReferenceId && inverterById.get(prospect.inverterReferenceId)) ?? inverterRef;
                  const prospectBatteryRef =
                    (prospect.batteryReferenceId && batteryById.get(prospect.batteryReferenceId)) ?? batteryRef;
                  const includeBatteryForProspect =
                    prospect.includeBatteryOverride ?? includeBatteryDefault;

                  return (
                    <TableRow
                      key={prospect.id}
                      className="h-12 cursor-pointer border-b border-border/50 hover:bg-muted/30 transition-colors"
                      onClick={() => {
                        if (prospect.id) setSelectedProspectId(prospect.id);
                      }}
                    >
                      <TableCell className="w-12 p-2.5 align-middle">
                        <div className="w-8 h-8 rounded-md overflow-hidden bg-muted flex items-center justify-center shrink-0 ring-1 ring-border/50">
                          {prospect.thumbnailUrl ? (
                            <Image
                              src={prospect.thumbnailUrl}
                              alt=""
                              width={32}
                              height={32}
                              className="object-cover w-full h-full"
                            />
                          ) : (
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium p-2.5 max-w-[100px]">
                        <span className="truncate block" title={prospect.name || prospect.address}>
                          {prospect.name || prospect.address}
                        </span>
                      </TableCell>
                      <TableCell className="p-2.5 max-w-[160px]">
                        <span className="truncate block text-muted-foreground" title={prospect.address}>
                          {prospect.address}
                        </span>
                      </TableCell>
                      <TableCell className="p-2.5 max-w-[80px]">
                        <span
                          className="truncate block text-muted-foreground"
                          title={isDiscovery ? "Découverte (matching V5)" : "Donnée non Discovery"}
                        >
                          {isDiscovery ? "Découverte" : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="p-2.5 min-w-[95px]">
                        <Badge
                          variant="default"
                          className="text-[11px] px-2 py-0.5 h-5 font-medium shrink-0"
                        >
                          {STATUS_LABELS[status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right p-2.5 whitespace-nowrap text-muted-foreground">
                        {isDiscovery && kwp > 0 ? `${kwp.toFixed(1)}` : "—"}
                      </TableCell>
                      <TableCell className="p-2.5">
                        {isDiscovery ? (
                          <ScoreGauge score={prospect.qualityScore} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="p-2.5 align-middle">
                        {isDiscovery ? (
                          <EquipmentThumbnail equipment={prospectPanelRef || null} fallbackIcon={Sun} alt="Panneau" />
                        ) : (
                          <div className="w-8 h-8 rounded-md bg-muted/50 shrink-0" title="Non applicable" />
                        )}
                      </TableCell>
                      <TableCell className="p-2.5 align-middle">
                        {isDiscovery ? (
                          <EquipmentThumbnail equipment={prospectInverterRef || null} fallbackIcon={Zap} alt="Onduleur" />
                        ) : (
                          <div className="w-8 h-8 rounded-md bg-muted/50 shrink-0" />
                        )}
                      </TableCell>
                      <TableCell className="p-2.5 align-middle">
                        {isDiscovery ? (
                          includeBatteryForProspect && prospectBatteryRef ? (
                            <EquipmentThumbnail equipment={prospectBatteryRef} fallbackIcon={Battery} alt="Batterie" />
                          ) : (
                            <div className="w-8 h-8 rounded-md bg-muted/50 shrink-0 flex items-center justify-center" title={includeBatteryForProspect ? "Aucune batterie configurée" : "Batterie désactivée pour ce prospect"}>
                              <Info className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )
                        ) : (
                          <div className="w-8 h-8 rounded-md bg-muted/50 shrink-0" />
                        )}
                      </TableCell>
                      <TableCell className="text-right p-2.5 whitespace-nowrap text-muted-foreground">
                        {isDiscovery && totalArea > 0 ? `${totalArea.toFixed(0)} m²` : "—"}
                      </TableCell>
                      <TableCell className="text-right p-2.5 whitespace-nowrap text-[#0000FF] font-medium">
                        {isDiscovery && productionKwh > 0 ? `${(productionKwh / 1000).toFixed(1)} MWh` : "—"}
                      </TableCell>
                      <TableCell className="text-right p-2.5 whitespace-nowrap text-gray-600 font-medium" title="Consommation annuelle estimée (kWh/m² × surface)">
                        {isDiscovery && consumptionKwh > 0 ? `${(consumptionKwh / 1000).toFixed(1)} MWh` : "—"}
                      </TableCell>
                      <TableCell className="text-right p-2.5 whitespace-nowrap text-muted-foreground">
                        {isDiscovery && priceMin != null && priceMax != null
                          ? `${(priceMin / 1000).toFixed(0)}–${(priceMax / 1000).toFixed(0)} k€`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right p-2.5 whitespace-nowrap text-muted-foreground">
                        {breakEvenLabel}
                      </TableCell>
                      <TableCell className="p-2.5 max-w-[110px]">
                        {hasContactRow ? (
                          <span className="truncate flex items-center gap-1.5" title={contactLabel}>
                            {contactPhone ? <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                            <span className="truncate">{contactLabel}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground p-2.5 whitespace-nowrap text-xs">
                        {createdAt}
                      </TableCell>
                      <TableCell className="p-2.5 w-12 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                              <MoreVertical className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href="/discovery" className="flex items-center cursor-pointer">
                                <ScanSearch className="h-4 w-4 mr-2 shrink-0" />
                                Ouvrir la découverte
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => handleViewProspectPage(prospect, e)}
                              disabled={generatingLinkId === prospect.id || viewingPageId === prospect.id}
                            >
                              {viewingPageId === prospect.id ? (
                                <span className="animate-pulse">Ouverture...</span>
                              ) : (
                                <>
                                  <Eye className="h-4 w-4 mr-2 shrink-0" />
                                  Visualiser la page
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => handleGenerateLink(prospect, e)}
                              disabled={generatingLinkId === prospect.id || viewingPageId === prospect.id}
                            >
                              {generatingLinkId === prospect.id ? (
                                <span className="animate-pulse">Génération...</span>
                              ) : (
                                <>
                                  <Link2 className="h-4 w-4 mr-2" />
                                  Générer le lien
                                </>
                              )}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function HomePageWrapper() {
  return (
    <Suspense>
      <HomePage />
    </Suspense>
  );
}
