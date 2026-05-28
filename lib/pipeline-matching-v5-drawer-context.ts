import { fetchWithAuth } from "@/lib/api-client";
import { fetchMatchingV5ParcelleRowWithCadastreFallback } from "@/lib/discovery-cadastre-parcel-fetch";
import {
  buildingSelectionIdsForDiscoveryProspect,
  parcelleRowsForDiscoveryProspect,
} from "@/lib/discovery-pipeline-match";
import { parseMatchingV5GeoJsonFeatureCollection, type ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";
import type { Prospect } from "@/types";

/** Marge WGS84 autour du centroïde prospect pour charger assez de lignes V5 (liens parcelles). */
const BBOX_PAD = 0.028;

export type PipelineDiscoveryDrawerContext =
  | {
      ok: true;
      anchor: ScoutMatchingV5Row;
      /** Même agrégation que la page Découverte (`effectiveDiscoveryLinkedParcelleRows`). */
      discoveryLinkedParcelleRowsForDrawer: ScoutMatchingV5Row[];
      /** Sélection bâtiments enregistrée à l’ajout pipeline (si présente). */
      persistedBuildingSelectionIds?: string[];
    }
  | { ok: false; message: string };

/**
 * Charge les features matching V5 autour du prospect et calcule l’ancre + parcelles liées pour le tiroir Découverte.
 */
export async function loadMatchingV5DrawerContextForProspect(
  prospect: Prospect
): Promise<PipelineDiscoveryDrawerContext> {
  const rowId = String(prospect.matchingV5RowId ?? "").trim();
  if (!rowId) return { ok: false, message: "Identifiant matching V5 manquant." };

  const { lat, lng } = prospect.coordinates ?? {};
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, message: "Coordonnées prospect invalides." };
  }

  const params = new URLSearchParams({
    limit: "4000",
    minLat: String(lat - BBOX_PAD),
    maxLat: String(lat + BBOX_PAD),
    minLng: String(lng - BBOX_PAD),
    maxLng: String(lng + BBOX_PAD),
  });

  const res = await fetchWithAuth(`/api/matching-v5/features?${params.toString()}`);
  if (!res.ok) {
    return {
      ok: false,
      message: res.status === 500 ? "Erreur serveur (matching V5)." : `Erreur HTTP ${res.status}`,
    };
  }

  const json: unknown = await res.json();
  const { rows, error: parseErr } = parseMatchingV5GeoJsonFeatureCollection(json);
  if (parseErr) return { ok: false, message: parseErr };

  const anchor = rows.find((r) => r.id === rowId);
  if (!anchor) {
    return {
      ok: false,
      message: "Emprise introuvable dans la zone chargée. Vérifiez l’export ou ouvrez la Découverte sur la carte.",
    };
  }

  let discoveryLinkedParcelleRowsForDrawer = parcelleRowsForDiscoveryProspect(prospect, anchor, rows);

  const persistedParcelleIds = prospect.matchingV5ParcelleIds?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (persistedParcelleIds.length > 0) {
    const byId = new Map(discoveryLinkedParcelleRowsForDrawer.map((r) => [r.id, r]));
    for (const id of persistedParcelleIds) {
      if (byId.has(id)) continue;
      const fetched = await fetchMatchingV5ParcelleRowWithCadastreFallback(id);
      if (fetched) byId.set(id, fetched);
    }
    discoveryLinkedParcelleRowsForDrawer = persistedParcelleIds
      .map((id) => byId.get(id))
      .filter((r): r is ScoutMatchingV5Row => r != null);
    if (discoveryLinkedParcelleRowsForDrawer.length === 0) {
      discoveryLinkedParcelleRowsForDrawer = parcelleRowsForDiscoveryProspect(prospect, anchor, rows);
    }
  }

  const persistedBuildingSelectionIds = buildingSelectionIdsForDiscoveryProspect(prospect);

  return {
    ok: true,
    anchor,
    discoveryLinkedParcelleRowsForDrawer,
    persistedBuildingSelectionIds,
  };
}
