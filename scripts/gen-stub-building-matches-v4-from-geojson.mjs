/**
 * Génère un CSV minimal `building_matches_v4.csv` à partir d’un GeoJSON d’échantillon
 * (`scout_bdnb_poi_sample_<INSEE>.geojson`) : une ligne par feature, clés alignées
 * sur l’export V4 (batiment_id + footprint_path). SIREN/SIRET = 1er candidat SIRENE si présent.
 *
 * Usage (racine du repo) :
 *   node scripts/gen-stub-building-matches-v4-from-geojson.mjs
 *   node scripts/gen-stub-building-matches-v4-from-geojson.mjs --in=data-pipeline/out/scout_bdnb_poi_sample_33522.geojson
 *   node scripts/gen-stub-building-matches-v4-from-geojson.mjs --out=data-pipeline/out/matching/v4/building_matches_v4.csv
 *
 * Ce n’est pas un « vrai » matching V4 : uniquement pour valider la chaîne CSV → fusion GeoJSON → carte.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function argVal(name) {
  const p = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : null;
}

const inRel =
  argVal("in") || "data-pipeline/out/scout_bdnb_poi_sample_33318.geojson";
const outRel =
  argVal("out") || "data-pipeline/out/matching/v4/building_matches_v4.csv";

const inPath = path.isAbsolute(inRel) ? inRel : path.join(root, inRel);
const outPath = path.isAbsolute(outRel) ? outRel : path.join(root, outRel);

/** @type {string[]} */
const header = [
  "batiment_id",
  "footprint_path",
  "area_m2",
  "primary_poi_id",
  "primary_poi_name",
  "primary_poi_osm_building",
  "primary_poi_score",
  "primary_poi_source",
  "nb_poi_detected",
  "multi_tenant",
  "siren",
  "siret",
  "match_confidence_score",
  "fuzzy_score_nom",
  "score_adresse",
  "coherence_cadastre",
  "siren_alt_list",
  "fallback_google_used",
  "address_lookup_status",
  "building_address_ban",
  "consumption_annual_mwh",
  "consumption_match_method",
  "consumption_match_confidence",
  "consumption_geocode_lat",
  "consumption_geocode_lng",
  "consumption_geocode_distance_m",
  "consumption_matched_address_raw",
  "consumption_match_status",
  "consumption_annual_mwh_by_year",
  "enedis_tri_des_adresses",
  "enedis_code_iris",
  "enedis_code_secteur_naf2",
  "enedis_nombre_de_sites",
  "enedis_nombre_de_sites_max",
  "match_path",
  "address_used_source",
  "entreprises_a_adresse_count",
  "osm_candidates_tried",
];

function escCell(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToLine(cells) {
  return cells.map(escCell).join(",");
}

let text;
try {
  text = fs.readFileSync(inPath, "utf8");
} catch {
  console.error(`[stub-v4] Fichier introuvable: ${inPath}`);
  process.exit(1);
}

/** @type {{ type?: string, features?: unknown[] }} */
let fc;
try {
  fc = JSON.parse(text);
} catch {
  console.error(`[stub-v4] JSON invalide: ${inPath}`);
  process.exit(1);
}

const features = Array.isArray(fc.features) ? fc.features : [];
/** @type {string[]} */
const lines = [rowToLine(header)];

for (const feat of features) {
  if (!feat || typeof feat !== "object" || feat.type !== "Feature") continue;
  const p = feat.properties && typeof feat.properties === "object" ? feat.properties : {};
  const bid = String(p.batiment_groupe_id ?? p.batimentGroupeId ?? "").trim();
  const fp = String(p.footprint_path ?? p.footprintPath ?? "").trim();
  if (!bid) continue;

  const pois = Array.isArray(p.pois) ? p.pois : [];
  const p0 = pois[0] && typeof pois[0] === "object" ? pois[0] : {};
  const name = String(p0.name ?? "").trim();
  const sc = p0.sirene_candidates ?? p0.sireneCandidates;
  const arr = Array.isArray(sc) ? sc : [];
  const c0 = arr[0] && typeof arr[0] === "object" ? arr[0] : {};
  const siren = String(c0.siren ?? "").trim();
  const siret = String(c0.siret ?? "").trim();

  const row = [
    bid,
    fp,
    String(p.area_m2 ?? p.areaM2 ?? ""),
    "",
    name,
    "",
    "0",
    "stub_geojson",
    "1",
    "false",
    siren,
    siret,
    "0",
    "0",
    "0",
    "0",
    "[]",
    "false",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "0",
    "",
    "",
    "",
    "",
    "",
    "",
    "0",
    "0",
    "",
    "",
    "",
    "",
  ];
  if (row.length !== header.length) {
    console.error(`[stub-v4] internal: colonnes ${row.length} != ${header.length}`);
    process.exit(1);
  }
  lines.push(rowToLine(row));
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
console.log(
  `[stub-v4] ${lines.length - 1} ligne(s) → ${path.relative(root, outPath)} (source ${path.relative(root, inPath)})`
);
