import { fetchWithAuth } from "@/lib/api-client";
import { scoutMatchingV5RowFromAdjacentCadastreParcel } from "@/lib/discovery-cadastre-parcel";
import {
  buildParcellesCadastreLookupSearchParams,
  type DiscoveryAdjacentParcelle,
} from "@/lib/matching-v5-parcelles-adjacent-http";
import { parseMatchingV5GeoJsonFeatureCollection, type ScoutMatchingV5Row } from "@/lib/scout-matching-v5-map";

/** Charge les géométries cadastre pour des `scout_v5_id` (parcelles hors matching V5 incluses). */
export async function fetchCadastreParcellesByScoutV5Ids(
  ids: readonly string[]
): Promise<DiscoveryAdjacentParcelle[]> {
  const unique = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const res = await fetchWithAuth(
    `/api/matching-v5/parcelles-adjacent?${buildParcellesCadastreLookupSearchParams(unique).toString()}`
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { parcelles?: DiscoveryAdjacentParcelle[] };
  return Array.isArray(json.parcelles) ? json.parcelles : [];
}

export async function fetchMatchingV5ParcelleRowById(
  scoutV5Id: string
): Promise<ScoutMatchingV5Row | null> {
  const id = scoutV5Id.trim();
  if (!id) return null;
  const res = await fetchWithAuth(
    `/api/matching-v5/features?scout_v5_id=${encodeURIComponent(id)}&limit=1`
  );
  if (!res.ok) return null;
  const json: unknown = await res.json();
  const { rows, error: parseErr } = parseMatchingV5GeoJsonFeatureCollection(json);
  if (parseErr || rows.length === 0) return null;
  const row = rows[0] ?? null;
  return row?.grain === "parcelle" ? row : null;
}

/**
 * Résout une parcelle : matching V5 d’abord, sinon cadastre (`cadastre_france_feuilles_geom`).
 */
export async function fetchMatchingV5ParcelleRowWithCadastreFallback(
  scoutV5Id: string
): Promise<ScoutMatchingV5Row | null> {
  const fromMatching = await fetchMatchingV5ParcelleRowById(scoutV5Id);
  if (fromMatching) return fromMatching;
  const parcelles = await fetchCadastreParcellesByScoutV5Ids([scoutV5Id]);
  const p = parcelles.find((x) => x.scout_v5_id === scoutV5Id.trim());
  return p ? scoutMatchingV5RowFromAdjacentCadastreParcel(p) : null;
}

/** Résout plusieurs ids (matching puis cadastre en lot pour les manquants). */
export async function fetchMatchingV5ParcelleRowsWithCadastreFallback(
  ids: readonly string[]
): Promise<ScoutMatchingV5Row[]> {
  const unique = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const byId = new Map<string, ScoutMatchingV5Row>();
  const missing: string[] = [];

  for (const id of unique) {
    const row = await fetchMatchingV5ParcelleRowById(id);
    if (row) byId.set(id, row);
    else missing.push(id);
  }

  if (missing.length > 0) {
    const parcelles = await fetchCadastreParcellesByScoutV5Ids(missing);
    for (const p of parcelles) {
      byId.set(p.scout_v5_id, scoutMatchingV5RowFromAdjacentCadastreParcel(p));
    }
  }

  return unique.map((id) => byId.get(id)).filter((r): r is ScoutMatchingV5Row => r != null);
}
