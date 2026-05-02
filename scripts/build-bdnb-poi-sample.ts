/**
 * Génère un GeoJSON Pipeline (une commune INSEE) : BDNB emprise par emprise (> 700 m²) →
 * Google Places Nearby par polygone (`ST_Dump`) → SIRENE (findLocalSiren).
 *
 * Chaque feature = une emprise (Polygon). Sortie puis import possible dans `public.scout_bdnb_poi_sample` (nom global).
 *
 * Prérequis : `.env.local` avec LOCAL_DATABASE_URL (prioritaire) ou DATABASE_URL, BDNB_BUILDINGS_TABLE,
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (Places activé).
 *
 * Usage : `npx tsx scripts/build-bdnb-poi-sample.ts`
 *
 * Variables principales :
 * - `BDNB_POI_SAMPLE_COMMUNE_INSEE` ou `COMMUNE_INSEE` : code INSEE à 5 chiffres (défaut **33318** si absent).
 * - `BDNB_POI_SAMPLE_OUT` : chemin du fichier .geojson (défaut `data-pipeline/out/scout_bdnb_poi_sample_<INSEE>.geojson`).
 * - `BDNB_POI_SAMPLE_LIMIT` : max d’emprises ; **absent** → toutes (plafond 50 000).
 * - `BDNB_POI_SAMPLE_ALL=1` ou `LIMIT=0|all` : forcer tout le périmètre.
 * - `BDNB_POI_MAX_POIS_PER_BUILDING` (défaut 1).
 * - `BDNB_POI_DISABLE_GOOGLE=1` : coupe tous les appels Google (Nearby + Details).
 * - `BDNB_POI_GOOGLE_PLACE_DETAILS=0` : sans Place Details.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { Client } from "pg";
import { v5 as uuidv5 } from "uuid";
import { getBdnbBuildingsTableRef } from "../lib/bdnb-buildings-table";
import { getServerDatabaseUrl } from "../lib/server-database-url";
import { findLocalSiren } from "../lib/find-local-siren";
import type { ResultatApiRechercheEntreprises } from "../lib/api-gouv-enrichment-map";
import {
  getOuterRing,
  ringCentroid,
  sortPlacesLikeClient,
  polygonBBoxDiagonalMeters,
  type NearbyPlaceLite,
} from "../lib/bdnb-poi-nearby-logic";
import {
  buildNearbySearchUrl,
  summarizePlacesNearbyResponse,
} from "../lib/google-places-nearby";

function namespaceUuidStringToBytes(uuidStr: string): Uint8Array {
  const hex = uuidStr.replace(/-/g, "");
  if (hex.length !== 32) throw new Error(`Namespace UUID invalide: ${uuidStr}`);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const LEAD_ID_NS = namespaceUuidStringToBytes(
  "a3e3f7b2-4c1d-5e6f-7a8b-9c0d1e2f3a4b"
);
const MIN_AREA_M2 = 700;
/** Utilisé seulement si la limite d’échantillon est définie mais valeur non numérique. */
const FALLBACK_SAMPLE_LIMIT = 80;
/** Plafond sécurité pour éviter une valeur env absurde. */
const MAX_SAMPLE_LIMIT = 50_000;
const DEFAULT_MAX_POIS_PER_BUILDING = 1;

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* ignore */
  }
}

/** lead_id stable par emprise (groupe + chemin PostGIS ST_Dump). */
function stableLeadId(batimentGroupeId: string, footprintPath: string): string {
  return uuidv5(`${batimentGroupeId}#${footprintPath}`, LEAD_ID_NS);
}

type NearbyCallMeta = {
  httpOk: boolean;
  httpStatus: number;
  apiStatus: string;
  rawResultCount: number;
  retainedAfterStatusRule: number;
  errorMessage?: string;
};

async function googleNearbyWithMeta(
  apiKey: string,
  lat: number,
  lng: number,
  radiusM: number
): Promise<{ places: NearbyPlaceLite[]; meta: NearbyCallMeta }> {
  const url = buildNearbySearchUrl({ lat, lng, radiusM, apiKey, type: "establishment" });
  const res = await fetch(url);
  if (!res.ok) {
    return {
      places: [],
      meta: {
        httpOk: false,
        httpStatus: res.status,
        apiStatus: "HTTP_ERROR",
        rawResultCount: 0,
        retainedAfterStatusRule: 0,
      },
    };
  }
  const data: unknown = await res.json();
  const sum = summarizePlacesNearbyResponse(data);
  return {
    places: sum.resultsIfOk,
    meta: {
      httpOk: true,
      httpStatus: res.status,
      apiStatus: sum.status,
      rawResultCount: sum.rawResultCount,
      retainedAfterStatusRule: sum.resultsIfOk.length,
      errorMessage: sum.errorMessage,
    },
  };
}

async function googlePlaceDetails(
  apiKey: string,
  placeId: string
): Promise<{ formatted_address?: string; name?: string } | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set(
    "fields",
    "place_id,name,formatted_address,geometry"
  );
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = (await res.json()) as {
    result?: { formatted_address?: string; name?: string };
    status?: string;
  };
  if (data.status !== "OK" || !data.result) return null;
  return data.result;
}

async function run(): Promise<void> {
  loadEnvLocal();

  const communeInseeRaw =
    process.env.BDNB_POI_SAMPLE_COMMUNE_INSEE?.trim() ||
    process.env.COMMUNE_INSEE?.trim() ||
    "33318";
  const communeInsee = communeInseeRaw.replace(/\s/g, "");
  if (!/^\d{5}$/.test(communeInsee)) {
    console.error(
      "BDNB_POI_SAMPLE_COMMUNE_INSEE (ou COMMUNE_INSEE) doit être un code INSEE à exactement 5 chiffres."
    );
    process.exit(1);
  }

  const databaseUrl = getServerDatabaseUrl();
  if (!databaseUrl) {
    console.error("DATABASE_URL (ou équivalent) manquant.");
    process.exit(1);
  }

  const disableGoogleNearby =
    process.env.BDNB_POI_DISABLE_GOOGLE?.trim() === "1";

  const apiKey =
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  if (!disableGoogleNearby && !apiKey) {
    console.error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ou GOOGLE_MAPS_API_KEY requis.");
    process.exit(1);
  }

  const useGooglePlaceDetails =
    process.env.BDNB_POI_GOOGLE_PLACE_DETAILS?.trim() !== "0";

  const maxPoisPerBuilding = Math.min(
    30,
    Math.max(
      1,
      parseInt(
        process.env.BDNB_POI_MAX_POIS_PER_BUILDING?.trim() ??
          String(DEFAULT_MAX_POIS_PER_BUILDING),
        10
      ) || DEFAULT_MAX_POIS_PER_BUILDING
    )
  );

  const defaultOut = `data-pipeline/out/scout_bdnb_poi_sample_${communeInsee}.geojson`;
  const outPath = resolve(
    process.cwd(),
    process.env.BDNB_POI_SAMPLE_OUT?.trim() ?? defaultOut
  );

  let tableRef: ReturnType<typeof getBdnbBuildingsTableRef>;
  try {
    tableRef = getBdnbBuildingsTableRef();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const { rows: countRows } = await client.query<{ n: string }>(
    `
    SELECT COUNT(*)::text AS n
    FROM ${tableRef.qualifiedSql} b
    CROSS JOIN LATERAL ST_Dump(ST_MakeValid(b.geom_groupe)) AS d
    WHERE b.code_commune_insee = $1
      AND ST_Area((d.geom)::geometry) > $2
    `,
    [communeInsee, MIN_AREA_M2]
  );
  const totalEmprisesCommune = Number(countRows[0]?.n ?? "0");

  const envRaw = process.env.BDNB_POI_SAMPLE_LIMIT?.trim() ?? "";
  /** Pas de variable → tout le périmètre (comportement par défaut). */
  const sampleAll =
    process.env.BDNB_POI_SAMPLE_ALL?.trim() === "1" ||
    envRaw.toLowerCase() === "all" ||
    envRaw === "0" ||
    envRaw === "";

  let limit: number;
  if (sampleAll) {
    limit = Math.max(1, totalEmprisesCommune);
  } else {
    const parsed = parseInt(envRaw, 10);
    const n =
      Number.isFinite(parsed) && parsed > 0
        ? parsed
        : FALLBACK_SAMPLE_LIMIT;
    limit = Math.min(MAX_SAMPLE_LIMIT, Math.max(1, n));
  }

  const scopeLabel =
    sampleAll || limit >= totalEmprisesCommune
      ? `toutes les ${totalEmprisesCommune} emprise(s) (tri surface ↓)`
      : `les ${limit} plus grandes emprises`;

  console.log(
    `[bdnb-poi] Commune INSEE ${communeInsee}, emprises > ${MIN_AREA_M2} m² (après ST_Dump) : ${totalEmprisesCommune} au total — enrichissement de ${scopeLabel}, max ${maxPoisPerBuilding} POI par emprise, Google: ${disableGoogleNearby ? "désactivé (BDNB_POI_DISABLE_GOOGLE=1)" : useGooglePlaceDetails ? "Nearby + Place Details (adresse)" : "Nearby uniquement (BDNB_POI_GOOGLE_PLACE_DETAILS=0)"}.\n`
  );

  type BdnbStagingSql = {
    batiment_groupe_id: string;
    code_commune_insee: string | null;
    code_departement_insee: string | null;
    ffo_code_departement_insee: string | null;
    nb_niveau: string | number | null;
    annee_construction: string | number | null;
    usage_niveau_1_txt: string | null;
    mat_mur_txt: string | null;
    mat_toit_txt: string | null;
    nb_logements: string | number | null;
    identifiant_dpe: string | null;
    dpe_code_departement_insee: string | null;
    arrete_2021: string | number | null;
    classe_bilan_dpe: string | null;
    classe_conso_energie_arrete_2012: string | null;
    surface_habitable_logement: string | number | null;
    dpe_mix_arrete_classe: string | null;
    usage_code_departement_insee: string | null;
    usage_principal_bdnb_open: string | null;
    footprint_path: string;
    area_m2: string | number;
    geom: GeoJSON.Polygon;
  };

  function numOrNull(v: string | number | null | undefined): number | null {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  }

  function bdnbStagingProperties(r: BdnbStagingSql): Record<string, unknown> {
    return {
      code_departement_insee: r.code_departement_insee,
      code_commune_insee: r.code_commune_insee,
      ffo_code_departement_insee: r.ffo_code_departement_insee,
      nb_niveau: numOrNull(r.nb_niveau),
      annee_construction: numOrNull(r.annee_construction),
      usage_niveau_1_txt: r.usage_niveau_1_txt,
      mat_mur_txt: r.mat_mur_txt,
      mat_toit_txt: r.mat_toit_txt,
      nb_logements: numOrNull(r.nb_logements),
      identifiant_dpe: r.identifiant_dpe,
      dpe_code_departement_insee: r.dpe_code_departement_insee,
      arrete_2021: numOrNull(r.arrete_2021),
      classe_bilan_dpe: r.classe_bilan_dpe,
      classe_conso_energie_arrete_2012: r.classe_conso_energie_arrete_2012,
      surface_habitable_logement: numOrNull(r.surface_habitable_logement),
      dpe_mix_arrete_classe: r.dpe_mix_arrete_classe,
      usage_code_departement_insee: r.usage_code_departement_insee,
      usage_principal_bdnb_open: r.usage_principal_bdnb_open,
    };
  }

  const q = await client.query<BdnbStagingSql>(
    `
    SELECT
      b.batiment_groupe_id::text AS batiment_groupe_id,
      b.code_commune_insee,
      b.code_departement_insee,
      b.ffo_code_departement_insee,
      b.nb_niveau,
      b.annee_construction,
      b.usage_niveau_1_txt,
      b.mat_mur_txt,
      b.mat_toit_txt,
      b.nb_logements,
      b.identifiant_dpe,
      b.dpe_code_departement_insee,
      b.arrete_2021,
      b.classe_bilan_dpe,
      b.classe_conso_energie_arrete_2012,
      b.surface_habitable_logement,
      b.dpe_mix_arrete_classe,
      b.usage_code_departement_insee,
      b.usage_principal_bdnb_open,
      array_to_string(d.path, '.') AS footprint_path,
      ST_Area((d.geom)::geometry)::double precision AS area_m2,
      ST_AsGeoJSON(ST_Transform((d.geom)::geometry, 4326))::json AS geom
    FROM ${tableRef.qualifiedSql} b
    CROSS JOIN LATERAL ST_Dump(ST_MakeValid(b.geom_groupe)) AS d
    WHERE b.code_commune_insee = $1
      AND ST_Area((d.geom)::geometry) > $2
    ORDER BY ST_Area((d.geom)::geometry) DESC
    LIMIT $3
    `,
    [communeInsee, MIN_AREA_M2, limit]
  );

  // Charge les SIRENs présents dans parcelles_personnes_morales pour cette commune.
  // Utilisé pour booster le score des candidats SIRENE qui possèdent des parcelles localement.
  const { rows: cadastreRows } = await client.query<{ numero_siren: string }>(
    `
    SELECT DISTINCT numero_siren
    FROM public.parcelles_personnes_morales
    WHERE code_insee = $1
      AND numero_siren ~ '^[0-9]{9}$'
    `,
    [communeInsee]
  );
  const cadastreSirens = new Set(cadastreRows.map((r) => r.numero_siren));
  console.log(`[cadastre] ${cadastreSirens.size} SIRENs propriétaires chargés pour ${communeInsee}`);

  /** Adresse ppm (passerelle) par emprise : intersection emprise ↔ cadastre ↔ parcelles_personnes_morales. */
  const passerelleByFootprint = new Map<string, string>();
  try {
    type PasserelleRow = {
      batiment_groupe_id: string;
      footprint_path: string;
      passerelle_company_address: string | null;
    };
    const passerelleSql = `
    WITH ranked AS (
      SELECT
        b.batiment_groupe_id::text AS batiment_groupe_id,
        array_to_string(d.path, '.') AS footprint_path,
        ST_Transform(ST_MakeValid((d.geom)::geometry), 4326) AS geom_wgs84
      FROM ${tableRef.qualifiedSql} b
      CROSS JOIN LATERAL ST_Dump(ST_MakeValid(b.geom_groupe)) AS d
      WHERE b.code_commune_insee = $1
        AND ST_Area((d.geom)::geometry) > $2
      ORDER BY ST_Area((d.geom)::geometry) DESC
      LIMIT $3
    )
    SELECT
      r.batiment_groupe_id,
      r.footprint_path,
      STRING_AGG(
        DISTINCT NULLIF(TRIM(CONCAT_WS(' ', ppm.numero_voirie, ppm.indice_repetition, ppm.nature_voie, ppm.nom_voie)), ''),
        ' | '
      ) AS passerelle_company_address
    FROM ranked r
    LEFT JOIN public.cadastre_france_feuilles_geom c
      ON c.code_insee = $1
      AND ST_Intersects(
        c.geom::geometry,
        ST_MakeValid(r.geom_wgs84::geometry)
      )
    LEFT JOIN public.parcelles_personnes_morales ppm
      ON ppm.code_insee = c.code_insee
      AND TRIM(UPPER(COALESCE(ppm.section, ''))) = TRIM(UPPER(COALESCE(c.section, '')))
      AND (
        TRIM(COALESCE(ppm.numero_parcelle, '')) = TRIM(COALESCE(NULLIF(c.numero_norm, ''), NULLIF(c.numero, ''), ''))
        OR (
          ppm.numero_parcelle ~ '^[0-9]+$'
          AND COALESCE(NULLIF(TRIM(c.numero_norm), ''), NULLIF(TRIM(c.numero), '')) ~ '^[0-9]+$'
          AND (TRIM(ppm.numero_parcelle))::bigint
            = (COALESCE(NULLIF(TRIM(c.numero_norm), ''), TRIM(COALESCE(c.numero, ''))))::bigint
        )
      )
      AND ppm.numero_siren ~ '^[0-9]{9}$'
    GROUP BY r.batiment_groupe_id, r.footprint_path
    `;
    const { rows: passerelleRows } = await client.query<PasserelleRow>(passerelleSql, [
      communeInsee,
      MIN_AREA_M2,
      limit,
    ]);
    for (const pr of passerelleRows) {
      const addr = pr.passerelle_company_address?.trim();
      if (addr) passerelleByFootprint.set(`${pr.batiment_groupe_id}|${pr.footprint_path}`, addr);
    }
    console.log(
      `[passerelle] ${passerelleByFootprint.size} emprise(s) avec adresse ppm (cadastre + jointure parcelle)`
    );
  } catch (e) {
    console.warn(
      "[passerelle] requête ignorée (tables cadastre/ppm absentes ou erreur SQL) :",
      e instanceof Error ? e.message : e
    );
  }

  await client.end();

  /** Bonus de score (+200/1000) accordé à un SIREN présent dans le cadastre de la commune. */
  const CADASTRE_BONUS = 200;

  const fetcher = async (query: string, perPage: number) => {
    const url = new URL("https://recherche-entreprises.api.gouv.fr/search");
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", String(perPage));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { results: [] as ResultatApiRechercheEntreprises[] };
    const data = (await res.json()) as { results?: ResultatApiRechercheEntreprises[] };
    return { results: data.results ?? [] };
  };

  const features: GeoJSON.Feature[] = [];
  let totalPoisExported = 0;
  let emprisesSansPoi = 0;
  let googleDeniedOrError = 0;

  for (let i = 0; i < q.rows.length; i++) {
    const row = q.rows[i];
    const geom =
      typeof row.geom === "string"
        ? (JSON.parse(row.geom) as (typeof row)["geom"])
        : row.geom;
    if (geom.type !== "Polygon") {
      console.warn(`[${i + 1}] skip non-Polygon: ${row.batiment_groupe_id} path=${row.footprint_path}`);
      continue;
    }
    const outer = getOuterRing(geom);
    const centroid = ringCentroid(outer);
    const diagonal = polygonBBoxDiagonalMeters(outer);
    const radius = Math.max(diagonal * 1.5, 100);

    console.log(
      `[${i + 1}/${q.rows.length}] ${row.batiment_groupe_id} fp=${row.footprint_path} area=${Number(row.area_m2).toFixed(0)} m²`
    );

    const { places: nearby, meta: gMeta } = disableGoogleNearby
      ? {
          places: [] as NearbyPlaceLite[],
          meta: {
            httpOk: true,
            httpStatus: 200,
            apiStatus: "DISABLED",
            rawResultCount: 0,
            retainedAfterStatusRule: 0,
            errorMessage: "Google Nearby désactivé par BDNB_POI_DISABLE_GOOGLE=1",
          },
        }
      : await googleNearbyWithMeta(
          apiKey as string,
          centroid.lat,
          centroid.lng,
          radius
        );
    const ordered = disableGoogleNearby
      ? []
      : sortPlacesLikeClient(nearby, centroid, outer);

    if (gMeta.apiStatus === "REQUEST_DENIED" || gMeta.apiStatus === "OVER_QUERY_LIMIT") {
      googleDeniedOrError += 1;
    }
    if (!gMeta.httpOk) {
      console.log(
        `  Places Nearby: HTTP ${gMeta.httpStatus} (échec réseau ou quota HTTP) — 0 résultat`
      );
    } else {
      const errLine =
        gMeta.errorMessage && gMeta.errorMessage.trim() !== ""
          ? ` | msg: ${gMeta.errorMessage}`
          : "";
      console.log(
        `  Places Nearby: HTTP ${gMeta.httpStatus} | API status=${gMeta.apiStatus} | brut=${gMeta.rawResultCount} | retenus (OK)=${gMeta.retainedAfterStatusRule}${errLine}`
      );
      console.log(
        `  → rayon ${Math.round(radius)} m | centre ${centroid.lat.toFixed(5)}, ${centroid.lng.toFixed(5)} | après tri client (types/nom): ${ordered.length}`
      );
      if (ordered.length > 0) {
        const preview = ordered
          .slice(0, 5)
          .map((p) => p.name ?? "?")
          .join(" · ");
        console.log(`  → échantillon noms: ${preview}${ordered.length > 5 ? " …" : ""}`);
      }
    }

    const poisOut: Array<Record<string, unknown>> = [];

    for (const pl of ordered.slice(0, maxPoisPerBuilding)) {
      const pid = pl.place_id;
      const loc = pl.geometry?.location;
      if (!loc) continue;

      let formattedAddress = "";
      let name = pl.name?.trim() ?? "";
      if (pid && useGooglePlaceDetails) {
        const details = await googlePlaceDetails(apiKey as string, pid);
        if (details?.formatted_address) formattedAddress = details.formatted_address;
        if (details?.name) name = details.name.trim() || name;
        await new Promise((r) => setTimeout(r, 120));
      }

      if (!formattedAddress) {
        formattedAddress = `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
      }

      const match = await findLocalSiren(
        name || "POI",
        formattedAddress,
        loc.lat,
        loc.lng,
        fetcher
      );

      // Applique le bonus cadastre sur les candidats dont le SIREN est propriétaire
      // d'au moins une parcelle dans la commune, puis re-trie et re-ranke.
      const rawCandidates = match?.phase2Scoring ?? [];
      const boosted = rawCandidates
        .map((s) => {
          const isCadastreMatch = cadastreSirens.has(s.siren);
          return {
            ...s,
            score: isCadastreMatch ? s.score + CADASTRE_BONUS : s.score,
            cadastre_match: isCadastreMatch,
          };
        })
        .sort((a, b) => b.score - a.score)
        .map((s, i) => ({ ...s, rank: i + 1 }));

      if (boosted.some((c) => c.cadastre_match)) {
        console.log(
          `  [cadastre-bonus] ${boosted.filter((c) => c.cadastre_match).length} candidat(s) boosté(s) → nouveau #1: ${boosted[0]?.nom_complet} (score ${boosted[0]?.score})`
        );
      }

      const sireneCandidates = boosted.map((s) => ({
        rank: s.rank,
        score: s.score,
        siret: s.siret,
        siren: s.siren,
        nom_complet: s.nom_complet,
        company_manager_name: s.company_manager_name,
        code_postal: s.code_postal,
        adresse: s.adresse,
        activite_principale: s.activite_principale,
        tranche_effectif_salarie: s.tranche_effectif_salarie,
        cadastre_match: s.cadastre_match,
      }));

      poisOut.push({
        name: name || "Sans nom",
        place_id: pid,
        lat: loc.lat,
        lng: loc.lng,
        formatted_address: formattedAddress,
        sirene_candidates: sireneCandidates,
      });
    }

    const leadId = stableLeadId(row.batiment_groupe_id, row.footprint_path);
    const passerelleKey = `${row.batiment_groupe_id}|${row.footprint_path}`;
    const passerelleCompanyAddress = passerelleByFootprint.get(passerelleKey) ?? null;

    totalPoisExported += poisOut.length;
    if (poisOut.length === 0) emprisesSansPoi += 1;

    features.push({
      type: "Feature",
      geometry: geom,
      properties: {
        lead_id: leadId,
        batiment_groupe_id: row.batiment_groupe_id,
        commune_insee: communeInsee,
        footprint_path: row.footprint_path,
        lat: centroid.lat,
        lng: centroid.lng,
        area_m2: Number(row.area_m2),
        code_commune_insee: row.code_commune_insee,
        /** Adresse(s) ppm sur parcelles intersectant l’emprise (contexte passerelle). */
        ...(passerelleCompanyAddress
          ? { passerelle_company_address: passerelleCompanyAddress }
          : {}),
        /** Toutes les colonnes staging (FFO / DPE / usage) telles qu’en base après import. */
        bdnb_staging: bdnbStagingProperties(row),
        pois: poisOut,
      },
    });

    console.log(
      `  → export GeoJSON: ${poisOut.length} POI enrichis (max ${maxPoisPerBuilding}) · SIRENE: ${poisOut.filter((p) => Array.isArray(p.sirene_candidates) && (p.sirene_candidates as unknown[]).length > 0).length} avec au moins 1 candidat`
    );

    await new Promise((r) => setTimeout(r, 400));
  }

  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(fc, null, 0), "utf8");
  console.log("");
  console.log("--- Récap Google / export ---");
  console.log(`Fichier: ${outPath}`);
  console.log(`Emprises: ${features.length} | POI total dans le GeoJSON: ${totalPoisExported}`);
  console.log(`Emprises sans aucun POI: ${emprisesSansPoi}`);
  if (googleDeniedOrError > 0) {
    console.log(
      `⚠ Au moins une requête avec API status problématique (REQUEST_DENIED / OVER_QUERY_LIMIT): ${googleDeniedOrError} — vérifier clé, facturation Places, quotas.`
    );
  }
  if (limit < totalEmprisesCommune) {
    console.log(
      `[bdnb-poi] Export partiel : ${totalEmprisesCommune} emprises disponibles — pour tout enrichir : BDNB_POI_SAMPLE_ALL=1 ou npm run build:bdnb-poi-sample:all`
    );
  }
  console.log("---");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
