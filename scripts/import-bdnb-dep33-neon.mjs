/**
 * Import BDNB (Gironde / dep 33) vers Neon.
 *
 * Prérequis : CSV extraits dans bdnb/dep33_extract/ (zip départemental BDNB).
 *
 * Usage :
 *   node scripts/import-bdnb-dep33-neon.mjs
 *     → commune par défaut 33063 (Bordeaux)
 *   node scripts/import-bdnb-dep33-neon.mjs --commune=33075
 *   node scripts/import-bdnb-dep33-neon.mjs --communes=33063,33075,33234,33162
 *   node scripts/import-bdnb-dep33-neon.mjs --communes-file=bdnb/dep33_communes_missing.txt --append
 *     → liste d’INSEE (une par ligne, # commentaire fin de ligne OK)
 *   node scripts/import-bdnb-dep33-neon.mjs --commune=33162 --append
 *     → ajoute une commune sans recréer la table (ON CONFLICT DO NOTHING)
 *   node scripts/import-bdnb-dep33-neon.mjs --all
 *     → tout le département 33 (attention taille DB Neon)
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { resolveDatabaseUrl } from "./lib/resolve-database-url.mjs";

async function copyCsvFile(client, { table, columns, filePath }) {
  const sql = `COPY ${table}(${columns.join(",")}) FROM STDIN WITH (FORMAT csv, DELIMITER ';', HEADER true, QUOTE '\"')`;

  await new Promise((resolve, reject) => {
    const stream = client.query(copyFrom(sql));
    const fileStream = fs.createReadStream(filePath);

    fileStream.on("error", reject);
    stream.on("error", reject);
    stream.on("finish", resolve);

    fileStream.pipe(stream);
  });
}

function parseSemicolonCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ";") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

function formatSemicolonCsvField(v) {
  if (v == null) return "";
  const s = String(v);
  const needsQuotes = s.includes(";") || s.includes('"') || s.includes("\n") || s.includes("\r");
  if (!needsQuotes) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * @param {{ filter?: (fullRow: Record<string, string>) => boolean }} opts
 */
async function copyCsvSelectedColumns(client, { table, columns, filePath, filter }) {
  const sql = `COPY ${table}(${columns.join(",")}) FROM STDIN WITH (FORMAT csv, DELIMITER ';', HEADER true, QUOTE '\"')`;

  await new Promise((resolve, reject) => {
    const copyStream = client.query(copyFrom(sql));
    copyStream.on("error", reject);
    copyStream.on("finish", resolve);

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    let header = null;
    let idxs = null;

    rl.on("line", (line) => {
      if (header === null) {
        header = parseSemicolonCsvLine(line);
        idxs = columns.map((c) => {
          const i = header.indexOf(c);
          if (i < 0) throw new Error(`Colonne absente dans ${path.basename(filePath)}: ${c}`);
          return i;
        });
        copyStream.write(columns.join(";") + "\n");
        return;
      }

      if (!line) return;
      const fields = parseSemicolonCsvLine(line);
      if (filter) {
        const fullRow = {};
        for (let i = 0; i < header.length; i++) {
          fullRow[header[i]] = fields[i] ?? "";
        }
        if (!filter(fullRow)) return;
      }
      const picked = idxs.map((i) => formatSemicolonCsvField(fields[i] ?? ""));
      copyStream.write(picked.join(";") + "\n");
    });

    rl.on("close", () => {
      copyStream.end();
    });

    rl.on("error", reject);
  });
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let commune = null;
  let communes = null;
  let communesFile = null;
  let all = false;
  let append = false;
  for (const a of argv) {
    if (a === "--all") all = true;
    else if (a === "--append") append = true;
    else if (a.startsWith("--communes-file="))
      communesFile = path.resolve(process.cwd(), a.slice("--communes-file=".length).trim());
    else if (a.startsWith("--communes=")) {
      communes = a
        .slice("--communes=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a.startsWith("--commune=")) commune = a.slice("--commune=".length).trim();
  }
  if (all) return { commune: null, communes: null, all: true, append };
  if (communesFile) {
    if (!fs.existsSync(communesFile)) {
      throw new Error(`Fichier introuvable: ${communesFile}`);
    }
    const raw = fs.readFileSync(communesFile, "utf8");
    communes = raw
      .split(/\r?\n/)
      .map((line) => line.replace(/\s*#.*$/, "").trim())
      .filter(Boolean);
    if (communes.length === 0) {
      throw new Error(`Aucun code INSEE dans ${communesFile}`);
    }
  }
  if (communes && communes.length > 0) return { commune: null, communes, all: false, append };
  if (!commune) commune = "33063";
  return { commune, communes: null, all: false, append };
}

function stripCsvQuotes(s) {
  if (s == null) return "";
  let t = String(s);
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  return t;
}

async function main() {
  const { commune: communeFilter, communes: communesFilters, all: importAll, append } = parseArgs();
  const repoRoot = process.cwd();
  const databaseUrl = resolveDatabaseUrl(repoRoot);

  if (!databaseUrl) {
    throw new Error(
      "Aucune URL Postgres reconnue (priorité Radianz_DATABASE_URL ; voir lib/server-database-url.ts ; env ou .env.local)."
    );
  }

  const communeInseeSet =
    importAll ? null : new Set(communesFilters?.length ? communesFilters : [communeFilter]);

  const allowedBatimentIds = new Set();
  const filterBatiment =
    importAll || !communeInseeSet
      ? undefined
      : (row) => {
          const cinsee = stripCsvQuotes(row.code_commune_insee);
          const ok = communeInseeSet.has(cinsee);
          if (ok) allowedBatimentIds.add(stripCsvQuotes(row.batiment_groupe_id));
          return ok;
        };
  const filterByAllowedIds =
    importAll || !communeInseeSet
      ? undefined
      : (row) => allowedBatimentIds.has(stripCsvQuotes(row.batiment_groupe_id));

  console.log(
    importAll
      ? "[bdnb] Mode: département 33 complet (risque quota Neon 512 Mo)"
      : communesFilters?.length
        ? `[bdnb] Mode: ${communesFilters.length} communes INSEE — ${communesFilters.join(", ")}`
        : `[bdnb] Mode: commune INSEE ${communeFilter} uniquement (recommandé sous quota Neon)`
  );
  if (append) {
    console.log("[bdnb] Mode table: append (ajout sans suppression, ON CONFLICT DO NOTHING)");
  } else {
    console.log("[bdnb] Mode table: replace (DROP/CREATE)");
  }

  const dataDir = path.join(repoRoot, "bdnb", "dep33_extract");
  const files = {
    batiment_groupe: path.join(dataDir, "batiment_groupe.csv"),
    ffo: path.join(dataDir, "batiment_groupe_ffo_bat.csv"),
    usage: path.join(dataDir, "batiment_groupe_synthese_propriete_usage.csv"),
    dpeRep: path.join(dataDir, "batiment_groupe_dpe_representatif_logement.csv"),
  };

  for (const [k, p] of Object.entries(files)) {
    if (!fs.existsSync(p)) {
      throw new Error(`Fichier manquant: ${k} -> ${p}`);
    }
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");

    await client.query("CREATE EXTENSION IF NOT EXISTS postgis");

    await client.query(`
      DROP TABLE IF EXISTS public._stg_bdnb_batiment_groupe;
      DROP TABLE IF EXISTS public._stg_bdnb_ffo;
      DROP TABLE IF EXISTS public._stg_bdnb_usage;
      DROP TABLE IF EXISTS public._stg_bdnb_dpe_rep;
    `);

    await client.query(`
      CREATE TABLE public._stg_bdnb_batiment_groupe (
        batiment_groupe_id text,
        code_departement_insee text,
        code_commune_insee text,
        geom_groupe text
      );
    `);

    await client.query(`
      CREATE TABLE public._stg_bdnb_ffo (
        batiment_groupe_id text,
        code_departement_insee text,
        nb_niveau integer,
        annee_construction integer,
        usage_niveau_1_txt text,
        mat_mur_txt text,
        mat_toit_txt text,
        nb_log integer
      );
    `);

    await client.query(`
      CREATE TABLE public._stg_bdnb_usage (
        batiment_groupe_id text,
        code_departement_insee text,
        usage_principal_bdnb_open text
      );
    `);

    await client.query(`
      CREATE TABLE public._stg_bdnb_dpe_rep (
        batiment_groupe_id text,
        identifiant_dpe text,
        code_departement_insee text,
        arrete_2021 integer,
        classe_bilan_dpe text,
        classe_conso_energie_arrete_2012 text,
        surface_habitable_logement numeric
      );
    `);

    // batiment_groupe.csv contient plus de colonnes que nécessaire → sélection streaming
    await copyCsvSelectedColumns(client, {
      table: "public._stg_bdnb_batiment_groupe",
      columns: [
        "batiment_groupe_id",
        "code_departement_insee",
        "code_commune_insee",
        "geom_groupe",
      ],
      filePath: files.batiment_groupe,
      filter: filterBatiment,
    });

    await copyCsvSelectedColumns(client, {
      table: "public._stg_bdnb_ffo",
      columns: [
        "batiment_groupe_id",
        "code_departement_insee",
        "nb_niveau",
        "annee_construction",
        "usage_niveau_1_txt",
        "mat_mur_txt",
        "mat_toit_txt",
        "nb_log",
      ],
      filePath: files.ffo,
      filter: filterByAllowedIds,
    });

    await copyCsvSelectedColumns(client, {
      table: "public._stg_bdnb_usage",
      columns: [
        "batiment_groupe_id",
        "code_departement_insee",
        "usage_principal_bdnb_open",
      ],
      filePath: files.usage,
      filter: filterByAllowedIds,
    });

    // dpe representatif contient beaucoup de colonnes → sélection streaming
    await copyCsvSelectedColumns(client, {
      table: "public._stg_bdnb_dpe_rep",
      columns: [
        "batiment_groupe_id",
        "identifiant_dpe",
        "code_departement_insee",
        "arrete_2021",
        "classe_bilan_dpe",
        "classe_conso_energie_arrete_2012",
        "surface_habitable_logement",
      ],
      filePath: files.dpeRep,
      filter: filterByAllowedIds,
    });

    if (!append) {
      await client.query(`
        DROP TABLE IF EXISTS public.bdnb_2025_07a_33;

        CREATE TABLE public.bdnb_2025_07a_33 AS
        SELECT
          bg.batiment_groupe_id,
          ST_SetSRID(ST_GeomFromText(bg.geom_groupe), 2154)::geometry(MultiPolygon,2154) AS geom_groupe,
          bg.code_commune_insee,
          ffo.annee_construction,
          CASE
            WHEN dr.arrete_2021 = 1 THEN dr.classe_bilan_dpe
            ELSE dr.classe_conso_energie_arrete_2012
          END AS dpe_mix_arrete_classe,
          ffo.nb_log AS nb_logements,
          dr.surface_habitable_logement,
          u.usage_principal_bdnb_open
        FROM public._stg_bdnb_batiment_groupe bg
        LEFT JOIN public._stg_bdnb_ffo ffo
          ON ffo.batiment_groupe_id = bg.batiment_groupe_id
        LEFT JOIN public._stg_bdnb_dpe_rep dr
          ON dr.batiment_groupe_id = bg.batiment_groupe_id
        LEFT JOIN public._stg_bdnb_usage u
          ON u.batiment_groupe_id = bg.batiment_groupe_id
        WHERE bg.code_departement_insee = '33';

        ALTER TABLE public.bdnb_2025_07a_33
          ADD PRIMARY KEY (batiment_groupe_id);
      `);
    } else {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.bdnb_2025_07a_33 (
          batiment_groupe_id text PRIMARY KEY,
          geom_groupe geometry(MultiPolygon,2154),
          code_commune_insee text,
          annee_construction integer,
          dpe_mix_arrete_classe text,
          nb_logements integer,
          surface_habitable_logement numeric,
          usage_principal_bdnb_open text
        );
      `);

      await client.query(`
        INSERT INTO public.bdnb_2025_07a_33 (
          batiment_groupe_id,
          geom_groupe,
          code_commune_insee,
          annee_construction,
          dpe_mix_arrete_classe,
          nb_logements,
          surface_habitable_logement,
          usage_principal_bdnb_open
        )
        SELECT
          bg.batiment_groupe_id,
          ST_SetSRID(ST_GeomFromText(bg.geom_groupe), 2154)::geometry(MultiPolygon,2154) AS geom_groupe,
          bg.code_commune_insee,
          ffo.annee_construction,
          CASE
            WHEN dr.arrete_2021 = 1 THEN dr.classe_bilan_dpe
            ELSE dr.classe_conso_energie_arrete_2012
          END AS dpe_mix_arrete_classe,
          ffo.nb_log AS nb_logements,
          dr.surface_habitable_logement,
          u.usage_principal_bdnb_open
        FROM public._stg_bdnb_batiment_groupe bg
        LEFT JOIN public._stg_bdnb_ffo ffo
          ON ffo.batiment_groupe_id = bg.batiment_groupe_id
        LEFT JOIN public._stg_bdnb_dpe_rep dr
          ON dr.batiment_groupe_id = bg.batiment_groupe_id
        LEFT JOIN public._stg_bdnb_usage u
          ON u.batiment_groupe_id = bg.batiment_groupe_id
        WHERE bg.code_departement_insee = '33'
        ON CONFLICT (batiment_groupe_id) DO NOTHING;
      `);
    }

    await client.query(`
      DROP TABLE IF EXISTS public._stg_bdnb_batiment_groupe;
      DROP TABLE IF EXISTS public._stg_bdnb_ffo;
      DROP TABLE IF EXISTS public._stg_bdnb_usage;
      DROP TABLE IF EXISTS public._stg_bdnb_dpe_rep;
    `);

    await client.query(
      "CREATE INDEX IF NOT EXISTS bdnb_2025_07a_33_geom_gix ON public.bdnb_2025_07a_33 USING GIST (geom_groupe)"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS bdnb_2025_07a_33_commune_idx ON public.bdnb_2025_07a_33 (code_commune_insee)"
    );

    const { rows: stats } = await client.query(`
      SELECT
        COUNT(*)::bigint AS n,
        COUNT(*) FILTER (WHERE geom_groupe IS NULL)::bigint AS n_geom_null,
        MIN(ST_SRID(geom_groupe)) AS srid_min,
        MAX(ST_SRID(geom_groupe)) AS srid_max
      FROM public.bdnb_2025_07a_33;
    `);
    console.log("[bdnb] Validation:", stats[0]);

    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

