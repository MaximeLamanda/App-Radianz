/**
 * Import minimal BDNB Open Data dep33 (dep33_csv.zip) pour Matching V5 building-unit.
 *
 * Charge uniquement :
 * - public.batiment_construction (geom_cstr en geometry(MultiPolygon,2154))
 * - public.batiment_groupe_ffo_bat (annee_construction via FFO)
 *
 * Source attendue : extraction du zip BDNB, ex:
 *   datasource/bdnb/dep33_extract/csv/batiment_construction.csv
 *   datasource/bdnb/dep33_extract/csv/batiment_groupe_ffo_bat.csv
 *
 * Connexion : `LOCAL_DATABASE_URL` en priorité, sinon `DATABASE_URL`, etc.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { resolveDatabaseUrl } from "./lib/resolve-database-url.mjs";

function parseArgs() {
  const argv = process.argv.slice(2);
  let dataDir = null;
  for (const a of argv) {
    if (a.startsWith("--data-dir=")) dataDir = path.resolve(process.cwd(), a.slice("--data-dir=".length).trim());
  }
  if (!dataDir) {
    throw new Error("Argument requis: --data-dir=... (dossier contenant csv/)");
  }
  return { dataDir };
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
      if (ch === '"') inQuotes = true;
      else if (ch === ";") {
        out.push(cur);
        cur = "";
      } else cur += ch;
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

async function copyCsvSelectedColumns(client, { table, columns, filePath }) {
  const sql = `COPY ${table}(${columns.join(",")}) FROM STDIN WITH (FORMAT csv, DELIMITER ';', HEADER true, QUOTE '\"')`;
  await new Promise((resolve, reject) => {
    const stream = client.query(copyFrom(sql));
    stream.on("error", reject);
    stream.on("finish", resolve);
    fs.createReadStream(filePath).pipe(stream);
  });
}

async function copyCsvToStage(client, { table, columns, filePath }) {
  // On réécrit un CSV ne contenant que les colonnes attendues (et en bon ordre).
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
      const picked = idxs.map((i) => formatSemicolonCsvField(fields[i] ?? ""));
      copyStream.write(picked.join(";") + "\n");
    });

    rl.on("close", () => copyStream.end());
    rl.on("error", reject);
  });
}

async function main() {
  const { dataDir } = parseArgs();
  const csvDir = path.join(dataDir, "csv");
  const fConstruction = path.join(csvDir, "batiment_construction.csv");
  const fFfo = path.join(csvDir, "batiment_groupe_ffo_bat.csv");

  if (!fs.existsSync(fConstruction)) throw new Error(`Fichier manquant: ${fConstruction}`);
  if (!fs.existsSync(fFfo)) throw new Error(`Fichier manquant: ${fFfo}`);

  const databaseUrl = resolveDatabaseUrl(process.cwd());
  if (!databaseUrl) {
    throw new Error("Aucune URL Postgres reconnue (LOCAL_DATABASE_URL, DATABASE_URL, ...)");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE EXTENSION IF NOT EXISTS postgis");

    // IMPORTANT :
    // Dans dep33_csv.zip, `batiment_construction.csv` ne contient pas la géométrie (pas de WKT).
    // Pour rester full local et débloquer Matching V5, on dérive `batiment_construction`
    // depuis `public.bdnb_buildings` en éclatant `geom_groupe` en polygones.

    // 1) FFO : on garde le CSV en source (si dispo) mais on peut aussi retomber sur bdnb_buildings.
    await client.query("DROP TABLE IF EXISTS public.batiment_groupe_ffo_bat");
    await client.query(`
      CREATE TABLE public.batiment_groupe_ffo_bat (
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
    await copyCsvSelectedColumns(client, {
      table: "public.batiment_groupe_ffo_bat",
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
      filePath: fFfo,
    });
    await client.query(
      "CREATE INDEX IF NOT EXISTS batiment_groupe_ffo_bat_id_idx ON public.batiment_groupe_ffo_bat (batiment_groupe_id)"
    );

    // 2) Constructions dérivées depuis bdnb_buildings
    const { rows: has } = await client.query(`
      SELECT 1 AS ok
      FROM information_schema.tables
      WHERE table_schema='public' AND table_name='bdnb_buildings'
      LIMIT 1
    `);
    if (has.length === 0) {
      throw new Error(
        "Table requise absente: public.bdnb_buildings. Importe d'abord BDNB (batiment_groupe) en local, puis relance."
      );
    }

    await client.query("DROP TABLE IF EXISTS public.batiment_construction");
    await client.query(`
      CREATE TABLE public.batiment_construction AS
      SELECT
        (b.batiment_groupe_id::text || ':' || gs.i::text) AS batiment_construction_id,
        b.batiment_groupe_id::text AS batiment_groupe_id,
        b.code_commune_insee::text AS code_commune_insee,
        ST_GeometryN(b.geom_groupe, gs.i)::geometry(Polygon,2154) AS geom_cstr
      FROM public.bdnb_buildings b
      JOIN LATERAL generate_series(1, GREATEST(1, ST_NumGeometries(b.geom_groupe))) AS gs(i) ON TRUE
      WHERE b.geom_groupe IS NOT NULL;
    `);
    await client.query("ALTER TABLE public.batiment_construction ADD PRIMARY KEY (batiment_construction_id)");
    await client.query("CREATE INDEX IF NOT EXISTS batiment_construction_geom_gix ON public.batiment_construction USING GIST (geom_cstr)");
    await client.query("CREATE INDEX IF NOT EXISTS batiment_construction_commune_idx ON public.batiment_construction (code_commune_insee)");
    await client.query("CREATE INDEX IF NOT EXISTS batiment_construction_gid_idx ON public.batiment_construction (batiment_groupe_id)");

    const { rows: stats } = await client.query(`
      SELECT
        (SELECT COUNT(*)::bigint FROM public.batiment_construction) AS constructions,
        (SELECT COUNT(*)::bigint FROM public.batiment_groupe_ffo_bat) AS ffo_rows
    `);
    console.log("[bdnb-local] import ok:", stats[0]);

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

