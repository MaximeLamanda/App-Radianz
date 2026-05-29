import type { DiscoveryAdjacentParcelle } from "@/lib/matching-v5-parcelles-adjacent-http";
import type { ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";
import { polygonAreaM2ApproxWgs84 } from "@/lib/geojson-polygon-area-m2";

/** Même convention que `run_matching_v5.py` (`parcelle:{code_insee}:{section}:{numero_norm}`). */
export function scoutV5IdFromCadastreKeys(
  codeInsee: string,
  section: string,
  numeroNorm: string
): string {
  return `parcelle:${codeInsee.trim()}:${section.trim()}:${numeroNorm.trim()}`;
}

export function cadastreLabelFromKeys(
  codeInsee: string,
  section: string,
  numeroNorm: string
): string {
  const s = section.trim();
  const n = numeroNorm.trim();
  const ci = codeInsee.trim();
  if (s && n) return ci ? `${s} ${n} · ${ci}` : `${s} ${n}`;
  return ci;
}

export function parseScoutV5ParcelleId(
  scoutV5Id: string
): { codeInsee: string; section: string; numeroNorm: string } | null {
  const raw = scoutV5Id.trim();
  if (!raw.startsWith("parcelle:")) return null;
  const parts = raw.split(":");
  if (parts.length < 4) return null;
  return {
    codeInsee: parts[1] ?? "",
    section: parts[2] ?? "",
    numeroNorm: parts.slice(3).join(":"),
  };
}

/** Ligne parcelle minimale pour le tiroir quand la parcelle n’est pas dans le matching V5. */
export function scoutMatchingV5RowFromAdjacentCadastreParcel(
  p: DiscoveryAdjacentParcelle
): ScoutMatchingV5Row {
  const geom = p.geometry;
  const footprintSumM2 =
    geom.type === "Polygon" || geom.type === "MultiPolygon"
      ? Math.round(polygonAreaM2ApproxWgs84(geom))
      : 0;
  const label = p.cadastre_label || cadastreLabelFromKeys(p.code_insee, p.section, p.numero_norm);
  return {
    id: p.scout_v5_id,
    grain: "parcelle",
    geometry: geom,
    label,
    batimentConstructionId: null,
    batimentGroupeId: null,
    codeInsee: p.code_insee,
    section: p.section,
    numeroNorm: p.numero_norm,
    nbBatiments: 0,
    footprintSumM2,
    sirenStatus: "",
    statusTechnique: "",
    statusMetier: "none",
    siretCount: 0,
    siretsJson: "",
    sirensJson: "",
    matchingConfidence: 0,
    matchingReason: "",
    matchStatus: p.match_status ?? "cadastre_only",
    passerelleAddress: "",
    passerelleAddressesJson: "",
    parcellesJson: "",
    buildingsJson: "",
    buildingGeometriesJson: "",
    properties: { source: "cadastre_france_feuilles_geom" },
  };
}
