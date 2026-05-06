import { fetchWithAuth } from "@/lib/api-client";
import { linkedParcelleRowsForV5DrawerAnchor } from "@/lib/discovery-pipeline-match";
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

  /** Aligné sur `effectiveDiscoveryLinkedParcelleRows` quand le prospect pointe déjà sur cette ligne. */
  const discoveryLinkedParcelleRowsForDrawer = linkedParcelleRowsForV5DrawerAnchor(anchor, rows);

  return {
    ok: true,
    anchor,
    discoveryLinkedParcelleRowsForDrawer,
  };
}
