/**
 * Client API Enedis ODS — utilisé par le pipeline Python/TS d'import uniquement.
 * La route Discovery lit `scout_enedis_consumption_sites` en Postgres.
 */
import {
  DISCOVERY_ENEDIS_API_MAX_LIMIT,
  discoveryEnedisHiEffective,
  isDiscoveryEnedisMwhFilterDisabled,
} from "@/lib/discovery-enedis-layer";

export const ENEDIS_CONSUMPTION_DATASET_ID = "consommation-annuelle-entreprise-par-adresse";

export const ENEDIS_OPENDATA_RECORDS_URL = `https://opendata.enedis.fr/api/explore/v2.1/catalog/datasets/${ENEDIS_CONSUMPTION_DATASET_ID}/records`;

export type EnedisOpenDataRecord = {
  nombre_de_sites?: number;
  code_departement?: string;
  nom_iris?: string;
  annee?: string;
  code_iris?: string;
  code_commune?: string;
  code_secteur_naf2?: string;
  code_categorie_consommation?: string;
  code_epci?: string;
  tri_des_adresses?: number;
  libelle_de_voie?: string | null;
  code_grand_secteur?: string;
  code_region?: string;
  adresse?: string | null;
  nom_commune?: string | null;
  consommation_annuelle_totale_de_ladresse_mwh?: number;
  numero_de_voie?: string | number | null;
  indice_de_repetition?: string | null;
  type_de_voie?: string | null;
};

export function normalizeEnedisAddressKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

export function formatEnedisAddressLabel(record: EnedisOpenDataRecord): string | null {
  const commune = String(record.nom_commune ?? "").trim();
  const parts: string[] = [];

  const num = record.numero_de_voie;
  if (num != null && String(num).trim()) {
    parts.push(String(num).trim());
  }
  const rep = String(record.indice_de_repetition ?? "").trim();
  if (rep) parts.push(rep);

  const typeVoie = String(record.type_de_voie ?? "").trim();
  const libelle = String(record.libelle_de_voie ?? "").trim();
  const street = [typeVoie, libelle].filter(Boolean).join(" ").trim();
  if (street) {
    parts.push(street);
  } else {
    const adresse = String(record.adresse ?? "").trim();
    if (adresse) parts.push(adresse);
    else {
      const iris = String(record.nom_iris ?? "").trim();
      if (iris) parts.push(iris);
    }
  }

  if (commune) parts.push(commune);
  const label = parts.join(" ").replace(/\s+/g, " ").trim();
  return label.length >= 5 ? label : null;
}

export function enedisRecordStableId(record: EnedisOpenDataRecord): string {
  const cc = String(record.code_commune ?? "").trim();
  const year = String(record.annee ?? "").trim();
  const tri = record.tri_des_adresses;
  if (cc && year && tri != null && Number.isFinite(Number(tri))) {
    return `${cc}:${year}:${tri}`;
  }
  const label = formatEnedisAddressLabel(record) ?? "";
  const mwh = record.consommation_annuelle_totale_de_ladresse_mwh ?? 0;
  return `${cc}:${year}:${normalizeEnedisAddressKey(label)}:${mwh}`;
}

function escapeOdsString(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildEnedisOdsWhereClause(input: {
  codeCommunes: readonly string[];
  annee: string;
  mwhMin: number;
  mwhMax: number;
}): string {
  const codes = input.codeCommunes
    .map((c) => String(c).trim())
    .filter((c) => /^\d{5}$/.test(c));
  if (codes.length === 0) {
    return "false";
  }
  const inList = codes.map((c) => `'${escapeOdsString(c)}'`).join(", ");
  const parts: string[] = [
    `code_commune IN (${inList})`,
    `annee = '${escapeOdsString(input.annee)}'`,
  ];
  if (!isDiscoveryEnedisMwhFilterDisabled(input.mwhMin, input.mwhMax)) {
    const hi = discoveryEnedisHiEffective(input.mwhMax);
    parts.push(
      `consommation_annuelle_totale_de_ladresse_mwh >= ${input.mwhMin}`
    );
    if (Number.isFinite(hi)) {
      parts.push(`consommation_annuelle_totale_de_ladresse_mwh <= ${hi}`);
    }
  }
  return parts.join(" AND ");
}

export function buildEnedisRecordsUrl(input: {
  codeCommunes: readonly string[];
  annee: string;
  mwhMin: number;
  mwhMax: number;
  limit?: number;
}): string {
  const limit = Math.min(
    input.limit ?? DISCOVERY_ENEDIS_API_MAX_LIMIT,
    DISCOVERY_ENEDIS_API_MAX_LIMIT
  );
  const where = buildEnedisOdsWhereClause(input);
  const params = new URLSearchParams({
    limit: String(limit),
    where,
    order_by: "consommation_annuelle_totale_de_ladresse_mwh DESC",
  });
  return `${ENEDIS_OPENDATA_RECORDS_URL}?${params.toString()}`;
}

export async function fetchEnedisRecords(input: {
  codeCommunes: readonly string[];
  annee: string;
  mwhMin: number;
  mwhMax: number;
  limit?: number;
  fetchFn?: typeof fetch;
}): Promise<{ records: EnedisOpenDataRecord[]; totalCount: number }> {
  const fetchImpl = input.fetchFn ?? fetch;
  const url = buildEnedisRecordsUrl(input);
  const res = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`Enedis ODS HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    total_count?: number;
    results?: EnedisOpenDataRecord[];
  };
  return {
    records: Array.isArray(json.results) ? json.results : [],
    totalCount: Number(json.total_count) || 0,
  };
}
