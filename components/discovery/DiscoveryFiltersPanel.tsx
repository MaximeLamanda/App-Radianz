"use client";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type DiscoveryFiltersPanelProps = {
  surfaceMinM2: number;
  surfaceMaxM2: number;
  onSurfaceMinChange: (v: number) => void;
  onSurfaceMaxChange: (v: number) => void;
  rowCount: number;
  loading: boolean;
  error: string | null;
  className?: string;
};

export function DiscoveryFiltersPanel({
  surfaceMinM2,
  surfaceMaxM2,
  onSurfaceMinChange,
  onSurfaceMaxChange,
  rowCount,
  loading,
  error,
  className,
}: DiscoveryFiltersPanelProps) {
  return (
    <Card
      className={cn(
        "h-fit rounded-xl border-zinc-200 bg-white/95 shadow-lg backdrop-blur-sm",
        className
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Filtres</CardTitle>
        <p className="text-xs text-muted-foreground">
          {loading ? "Chargement…" : `${rowCount} entité(s) dans la vue (parcelles ou bâtiments)`}
        </p>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="surf-min">Surface empreinte min. (m²)</Label>
          <Input
            id="surf-min"
            type="number"
            min={0}
            step={50}
            value={Number.isFinite(surfaceMinM2) ? surfaceMinM2 : 0}
            onChange={(e) => onSurfaceMinChange(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="surf-max">Surface empreinte max. (m²)</Label>
          <Input
            id="surf-max"
            type="number"
            min={0}
            step={50}
            value={Number.isFinite(surfaceMaxM2) ? surfaceMaxM2 : 0}
            onChange={(e) => onSurfaceMaxChange(parseFloat(e.target.value) || 0)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
