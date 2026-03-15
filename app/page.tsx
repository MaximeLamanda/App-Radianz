"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
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
import { MapPin, Phone, Globe, Sun, Zap, Filter, X, MoreVertical, Link2, ExternalLink, Eye } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  usePanelReferences,
  useInverterReferences,
  useProspectsForPipeline,
} from "@/lib/swr-hooks";
import { translatePlaceType } from "@/lib/place-types-translation";
import { getEnergyConsumption } from "@/lib/building-energy-consumption";
import { ProspectDrawer } from "@/components/solar-scout/ProspectDrawer";
import { updateProspectInPipeline, updateProspect } from "@/lib/firestore";
import { getCommercialReferent, buildCommercialReferentFromUser } from "@/lib/commercial-mock";
import { getUserProfile } from "@/lib/firestore-user-profile";
import { surfaceToKwp } from "@/lib/surface-to-kwp";
import { useDrawer } from "@/lib/drawer-context";
import type { Prospect, ProspectPipelineStatus, PanelReference, InverterReference } from "@/types";
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

function EquipmentThumbnail({
  equipment,
  fallbackIcon: FallbackIcon,
  alt,
}: {
  equipment: PanelReference | InverterReference | null;
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
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const { data: panelsData } = usePanelReferences(user?.uid ?? null);
  const { data: invertersData } = useInverterReferences(user?.uid ?? null);
  const {
    data: prospectsData,
    error: prospectsError,
    isLoading: prospectsLoading,
    mutate: mutateProspects,
  } = useProspectsForPipeline(user?.uid ?? null);

  const prospects = prospectsData ?? [];
  const panelRef = panelsData?.find((p) => p.recommended) ?? panelsData?.[0] ?? null;
  const inverterRef = invertersData?.find((i) => i.recommended) ?? invertersData?.[0] ?? null;

  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);
  const { isDrawerOpen, setIsDrawerOpen, setDrawerContent } = useDrawer();
  const searchParams = useSearchParams();

  // À la fermeture du drawer : retirer prospectId de l'URL (sans recharger) et revenir à la vue table "classique"
  const handleDrawerOpenChange = useCallback(
    (open: boolean) => {
      setIsDrawerOpen(open);
      if (!open && searchParams.get("prospectId")) {
        setSelectedProspect(null);
        router.replace(pathname ?? "/");
      }
    },
    [pathname, router, searchParams, setIsDrawerOpen]
  );
  const error = prospectsError ? (prospectsError.message || "Erreur lors du chargement") : null;
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPlaceType, setFilterPlaceType] = useState<string>("all");
  const [leadPeriod, setLeadPeriod] = useState<"daily" | "weekly" | "yearly" | "all">("weekly");

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  // Ouvrir automatiquement le drawer d'un prospect via ?prospectId= dans l'URL
  useEffect(() => {
    const prospectId = searchParams.get("prospectId");
    if (!prospectId || prospects.length === 0) return;
    const found = prospects.find((p) => p.id === prospectId);
    if (found && selectedProspect?.id !== prospectId) {
      setSelectedProspect(found);
    }
  }, [searchParams, prospects]);

  // Calcul des prospects filtrés
  const filteredProspects = useMemo(() => {
    return prospects.filter((prospect) => {
      const status = prospect.pipelineStatus ?? "nouveau";
      const matchesStatus = filterStatus === "all" || status === filterStatus;
      const matchesPlaceType = filterPlaceType === "all" || prospect.placeType === filterPlaceType;
      return matchesStatus && matchesPlaceType;
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

  // Calcul des KPIs par type de prospect pour le graphique pie
  const kpisByPlaceType = useMemo(() => {
    const counts: Record<string, number> = {};
    prospects.forEach((prospect) => {
      const type = prospect.placeType || "other";
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [prospects]);

  // Données pour le graphique pie/donut par type de prospect
  const chartDataByPlaceType = useMemo(() => {
    // Générer des couleurs pour chaque type
    const colors = [
      "hsl(217, 91%, 60%)",
      "hsl(38, 92%, 50%)",
      "hsl(142, 76%, 36%)",
      "hsl(142, 71%, 45%)",
      "hsl(0, 84%, 60%)",
      "hsl(262, 83%, 58%)",
      "hsl(280, 78%, 60%)",
      "hsl(346, 77%, 50%)",
    ];
    
    return Object.entries(kpisByPlaceType)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8) // Limiter à 8 types max
      .map(([type, count], index) => ({
        name: translatePlaceType(type),
        value: count,
        typeKey: type,
        color: colors[index % colors.length],
      }));
  }, [kpisByPlaceType]);

  // Obtenir les types de customer uniques pour le filtre
  const uniquePlaceTypes = useMemo(() => {
    const types = new Set<string>();
    prospects.forEach((prospect) => {
      types.add(prospect.placeType);
    });
    return Array.from(types).sort();
  }, [prospects]);

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
      setSelectedProspect((prev) => (prev?.id === prospect.id ? updated : prev));
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
      setSelectedProspect((prev) => (prev?.id === prospect.id ? updated : prev));
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

  function calculateQualityScore(area: number, placeType: string): number {
    let score = 0;
    if (area > 1000) score += 40;
    else if (area > 500) score += 35;
    else if (area > 200) score += 30;
    else if (area > 100) score += 20;
    else if (area > 0) score += 10;
    const energyIntensive = ["warehouse", "supermarket", "industrial"];
    if (energyIntensive.includes(placeType)) score += 30;
    else if (placeType === "retail" || placeType === "office") score += 20;
    else score += 10;
    return Math.min(100, score);
  }

  // Mettre à jour le drawer quand selectedProspect change
  useEffect(() => {
    if (selectedProspect) {
      setIsDrawerOpen(true);
      setDrawerContent(
        <ProspectDrawer
          prospect={selectedProspect}
          isOpen={true}
          onOpenChange={handleDrawerOpenChange}
          isDrawing={false}
          onProspectUpdate={(p) => {
            setSelectedProspect(p);
            if (p.id) {
              mutateProspects((prev) =>
                prev ? prev.map((x) => (x.id === p.id ? p : x)) : prev
              );
            }
          }}
          onSurfaceDelete={(surfaceId) => {
            const prospect = selectedProspect;
            if (!prospect) return;
            const surfaces = prospect.roofSurfaces || 
              (prospect.roofSurface?.area ? [{ ...prospect.roofSurface, id: "surface-0" }] : []);
            const updatedSurfaces = surfaces.filter((s, idx) => 
              (s.id || `surface-${idx}`) !== surfaceId
            );
            const totalArea = updatedSurfaces.reduce((sum, s) => sum + s.area, 0);
            const estimatedKwp = surfaceToKwp(totalArea);
            const prev = prospect.solarPotential;
            const updatedProspect: Prospect = {
              ...prospect,
              roofSurfaces: updatedSurfaces,
              roofSurface: updatedSurfaces.length > 0 
                ? updatedSurfaces[updatedSurfaces.length - 1] 
                : { area: 0, polygon: [] },
              qualityScore: calculateQualityScore(totalArea, prospect.placeType),
              solarPotential: {
                ...prev,
                maxArrayPanelsCount: prev?.maxArrayPanelsCount ?? 0,
                maxArrayAreaMeters2: totalArea,
                maxSunshineHoursPerYear: prev?.maxSunshineHoursPerYear ?? 0,
                maxKwhPerYear: prev?.maxKwhPerYear ?? 0,
                estimatedKwp,
                pvgisDataFetched: false,
              },
            };
            setSelectedProspect(updatedProspect);
            mutateProspects((prev) =>
              prev ? prev.map((x) => (x.id === prospect.id ? updatedProspect : x)) : prev
            );
            if (prospect.id) {
              updateProspectInPipeline(prospect.id, updatedProspect, { estimatedKwp })
                .then(() => {
                  mutateProspects();
                  toast.success("Surface supprimée");
                })
                .catch((err) => {
                  console.error("Erreur Firestore après suppression de surface:", err);
                  toast.error("Erreur lors de la sauvegarde");
                });
            }
          }}
          onSaveSuccess={() => mutateProspects()}
          voirHref={(id) => `/solar-scout?prospectId=${id}`}
        />
      );
    } else {
      setIsDrawerOpen(false);
      setDrawerContent(null);
    }
  }, [selectedProspect, setIsDrawerOpen, setDrawerContent, mutateProspects, handleDrawerOpenChange]);

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
                      variant={periodProgress.diff >= 0 ? "default" : "destructive"}
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
                  <label className="text-sm font-medium mb-2 block">Type de customer</label>
                  <Select value={filterPlaceType} onValueChange={setFilterPlaceType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Tous les types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous les types</SelectItem>
                      {uniquePlaceTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {translatePlaceType(type)}
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
              <p className="mb-2">Aucun prospect dans le pipeline</p>
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
                  const totalArea =
                    prospect.roofSurfaces?.reduce((sum, s) => sum + s.area, 0) ??
                    prospect.solarPotential?.maxArrayAreaMeters2 ??
                    0;
                  const kwp = prospect.solarPotential?.estimatedKwp ?? 0;
                  const prodPerKwp = prospect.solarPotential?.productionPerKwpAnnual;
                  const productionKwh =
                    prospect.solarPotential?.maxKwhPerYear ??
                    (prodPerKwp != null && kwp > 0 ? Math.round(prodPerKwp * kwp) : 0);
                  const consumptionKwh =
                    prospect.annualConsumptionKwhOverride ??
                    (totalArea > 0 ? getEnergyConsumption(prospect.placeType) * totalArea : 0);
                  const status = prospect.pipelineStatus ?? "nouveau";
                  const priceMin = prospect.priceRangeMinEur;
                  const priceMax = prospect.priceRangeMaxEur;
                  const breakEvenMin = prospect.breakEvenMinYears;
                  const breakEvenMax = prospect.breakEvenMaxYears;
                  const breakEvenLabel =
                    breakEvenMin != null && breakEvenMax != null
                      ? breakEvenMin === breakEvenMax
                        ? `${breakEvenMin} an${breakEvenMin > 1 ? "s" : ""}`
                        : `${breakEvenMin} – ${breakEvenMax} ans`
                      : "—";
                  const contactPhone =
                    prospect.contact?.nationalPhoneNumber ||
                    prospect.contact?.internationalPhoneNumber;
                  const contactWeb = prospect.contact?.websiteUri;
                  const contactDisplay = contactPhone || contactWeb;
                  const createdAt = prospect.createdAt
                    ? new Date(prospect.createdAt).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "2-digit",
                        year: "2-digit",
                      })
                    : "—";

                  return (
                    <TableRow
                      key={prospect.id}
                      className="cursor-pointer h-12 border-b border-border/50 hover:bg-muted/30 transition-colors"
                      onClick={() => {
                        setSelectedProspect(prospect);
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
                        <span className="truncate block" title={translatePlaceType(prospect.placeType)}>
                          {translatePlaceType(prospect.placeType)}
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
                        {kwp > 0 ? `${kwp.toFixed(1)}` : "—"}
                      </TableCell>
                      <TableCell className="p-2.5">
                        <ScoreGauge score={prospect.qualityScore} />
                      </TableCell>
                      <TableCell className="p-2.5 align-middle">
                        <EquipmentThumbnail equipment={panelRef} fallbackIcon={Sun} alt="Panneau" />
                      </TableCell>
                      <TableCell className="p-2.5 align-middle">
                        <EquipmentThumbnail equipment={inverterRef} fallbackIcon={Zap} alt="Onduleur" />
                      </TableCell>
                      <TableCell className="text-right p-2.5 whitespace-nowrap text-muted-foreground">
                        {totalArea > 0 ? `${totalArea.toFixed(0)} m²` : "—"}
                      </TableCell>
                      <TableCell className="text-right p-2.5 whitespace-nowrap text-blue-700 font-medium">
                        {productionKwh > 0 ? `${(productionKwh / 1000).toFixed(1)} MWh` : "—"}
                      </TableCell>
                      <TableCell className="text-right p-2.5 whitespace-nowrap text-gray-600 font-medium" title="Consommation annuelle estimée (kWh/m² × surface)">
                        {consumptionKwh > 0 ? `${(consumptionKwh / 1000).toFixed(1)} MWh` : "—"}
                      </TableCell>
                      <TableCell className="text-right p-2.5 whitespace-nowrap text-muted-foreground">
                        {priceMin != null && priceMax != null
                          ? `${(priceMin / 1000).toFixed(0)}–${(priceMax / 1000).toFixed(0)} k€`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right p-2.5 whitespace-nowrap text-muted-foreground">
                        {breakEvenLabel}
                      </TableCell>
                      <TableCell className="p-2.5 max-w-[110px]">
                        {contactDisplay ? (
                          <span className="truncate flex items-center gap-1.5" title={String(contactDisplay)}>
                            {contactPhone ? <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                            <span className="truncate">{contactPhone || contactWeb}</span>
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
                              <Link href={`/solar-scout?prospectId=${prospect.id}`} className="flex items-center cursor-pointer">
                                <ExternalLink className="h-4 w-4 mr-2 shrink-0" />
                                Voir sur la carte
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
