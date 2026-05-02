/**
 * Import BDNB vers Postgres (Docker local, hébergé, etc.) — table canonique configurable (BDNB_BUILDINGS_TABLE).
 * Connexion : `LOCAL_DATABASE_URL` en priorité, puis `DATABASE_URL`, etc. (voir scripts/lib/resolve-database-url.mjs).
 *
 * Prérequis : CSV extraits du zip BDNB (même structure que l’open data BDNB).
 *
 * Usage :
 *   node scripts/import-bdnb-postgres.mjs --data-dir=bdnb/mon_extract
 *     → commune par défaut 33063 (override avec --commune=)
 *   node scripts/import-bdnb-postgres.mjs --data-dir=... --commune=33075
 *   node scripts/import-bdnb-postgres.mjs --data-dir=... --communes=33063,33075
 *   node scripts/import-bdnb-postgres.mjs --data-dir=... --communes-file=liste.txt --append
 *   node scripts/import-bdnb-postgres.mjs --data-dir=... --all --departements=33
 *     → tout le périmètre CSV pour les départements listés
 *
 * Env :
 *   BDNB_BUILDINGS_TABLE — défaut public.bdnb_buildings (voir lib/bdnb-buildings-table.ts)
 *
 * Schéma : la table inclut toutes les colonnes issues des CSV staging (FFO, DPE, usage, départements).
 * Si une base a encore l’ancienne table (moins de colonnes), supprimer la table ou lancer sans --append
 * puis réimporter pour recréer le schéma complet.
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

function parseQualifiedTable(raw) {
  const t = (raw || "public.bdnb_buildings").trim();
  const parts = t.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) return { schema: "public", name: parts[0] };
  if (parts.length === 2) return { schema: parts[0], name: parts[1] };
  throw new Error(`BDNB_BUILDINGS_TABLE invalide: ${raw}`);
}

function validateIdent(s) {
  if (!/^[a-z][a-z0-9_]*$/.test(s)) {
    throw new Error(`Identifiant SQL invalide: ${s}`);
  }
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let commune = null;
  let communes = null;
  let communesFile = null;
  let all = false;
  let append = false;
  let dataDir = null;
  let departements = null;
  for (const a of argv) {
    if (a === "--all") all = true;
    else if (a === "--append") append = true;
    else if (a.startsWith("--data-dir="))
      dataDir = path.resolve(process.cwd(), a.slice("--data-dir=".length).trim());
    else if (a.startsWith("--departements="))
      departements = a
        .slice("--departements=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
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
  if (!dataDir) {
    throw new Error("Argument requis: --data-dir=chemin/vers/extract_csv_bdnb");
  }
  if (all) return { commune: null, communes: null, all: true, append, dataDir, departements };
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
  if (communes && communes.length > 0)
    return { commune: null, communes, all: false, append, dataDir, departements };
  if (!commune) commune = "33063";
  return { commune, communes: null, all: false, append, dataDir, departements };
}

function stripCsvQuotes(s) {
  if (s == null) return "";
  let t = String(s);
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  return t;
}

function buildDeptWhereClause(departements) {
  if (!departements || departements.length === 0) return "";
  const list = departements.map((d) => `'${String(d).replace(/'/g, "''")}'`).join(", ");
  return `AND bg.code_departement_insee IN (${list})`;
}

async function main() {
  const {
    commune: communeFilter,
    communes: communesFilters,
    all: importAll,
    append,
    dataDir,
    departements: departementsArg,
  } = parseArgs();

  const tableRef = parseQualifiedTable(process.env.BDNB_BUILDINGS_TABLE);
  validateIdent(tableRef.schema);
  validateIdent(tableRef.name);
  const qualifiedTable = `"${tableRef.schema}"."${tableRef.name}"`;
  const idxPrefix = `${tableRef.schema}_${tableRef.name}`.replace(/[^a-z0-9_]/gi, "_");

  const departements =
    departementsArg?.length > 0
      ? departementsArg
      : process.env.BDNB_DEPARTEMENTS?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) ?? null;

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

  const deptWhere = buildDeptWhereClause(departements);

  console.log(`[bdnb] Table cible: ${qualifiedTable} (BDNB_BUILDINGS_TABLE)`);
  console.log(
    importAll
      ? `[bdnb] Mode: toutes les lignes CSV filtrées département ${deptWhere ? departements.join(",") : "(aucun filtre dept — risque volume)"}`
      : communesFilters?.length
        ? `[bdnb] Mode: ${communesFilters.length} communes INSEE — ${communesFilters.join(", ")}`
        : `[bdnb] Mode: commune INSEE ${communeFilter} uniquement`
  );
  if (append) {
    console.log("[bdnb] Mode table: append (ajout sans suppression, ON CONFLICT DO NOTHING)");
  } else {
    console.log("[bdnb] Mode table: replace (DROP/CREATE)");
  }

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

  /** Toutes les colonnes utiles des CSV staging (_stg_*), sans multiplication de lignes (LATERAL LIMIT 1). */
  const selectCore = `
        SELECT
          bg.batiment_groupe_id,
          ST_SetSRID(ST_GeomFromText(bg.geom_groupe), 2154)::geometry(MultiPolygon,2154) AS geom_groupe,
          bg.code_departement_insee,
          bg.code_commune_insee,
          ffo.ffo_code_departement_insee,
          ffo.nb_niveau,
          ffo.annee_construction,
          ffo.usage_niveau_1_txt,
          ffo.mat_mur_txt,
          ffo.mat_toit_txt,
          ffo.nb_logements,
          dr.identifiant_dpe,
          dr.dpe_code_departement_insee,
          dr.arrete_2021,
          dr.classe_bilan_dpe,
          dr.classe_conso_energie_arrete_2012,
          dr.surface_habitable_logement,
          CASE
            WHEN dr.arrete_2021 = 1 THEN dr.classe_bilan_dpe
            ELSE dr.classe_conso_energie_arrete_2012
          END AS dpe_mix_arrete_classe,
          u.usage_code_departement_insee,
          u.usage_principal_bdnb_open
        FROM public._stg_bdnb_batiment_groupe bg
        LEFT JOIN LATERAL (
          SELECT
            f.code_departement_insee AS ffo_code_departement_insee,
            f.nb_niveau,
            f.annee_construction,
            f.usage_niveau_1_txt,
            f.mat_mur_txt,
            f.mat_toit_txt,
            f.nb_log AS nb_logements
          FROM public._stg_bdnb_ffo f
          WHERE f.batiment_groupe_id = bg.batiment_groupe_id
          LIMIT 1
        ) ffo ON true
        LEFT JOIN LATERAL (
          SELECT
            d.identifiant_dpe,
            d.code_departement_insee AS dpe_code_departement_insee,
            d.arrete_2021,
            d.classe_bilan_dpe,
            d.classe_conso_energie_arrete_2012,
            d.surface_habitable_logement
          FROM public._stg_bdnb_dpe_rep d
          WHERE d.batiment_groupe_id = bg.batiment_groupe_id
          LIMIT 1
        ) dr ON true
        LEFT JOIN LATERAL (
          SELECT
            u2.code_departement_insee AS usage_code_departement_insee,
            u2.usage_principal_bdnb_open
          FROM public._stg_bdnb_usage u2
          WHERE u2.batiment_groupe_id = bg.batiment_groupe_id
          LIMIT 1
        ) u ON true
        WHERE 1=1
        ${deptWhere}
  `;

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
      await client.query(`DROP TABLE IF EXISTS ${qualifiedTable};`);

      await client.query(`
        CREATE TABLE ${qualifiedTable} AS
        ${selectCore};
      `);

      await client.query(`ALTER TABLE ${qualifiedTable} ADD PRIMARY KEY (batiment_groupe_id);`);
    } else {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${qualifiedTable} (
          batiment_groupe_id text PRIMARY KEY,
          geom_groupe geometry(MultiPolygon,2154),
          code_departement_insee text,
          code_commune_insee text,
          ffo_code_departement_insee text,
          nb_niveau integer,
          annee_construction integer,
          usage_niveau_1_txt text,
          mat_mur_txt text,
          mat_toit_txt text,
          nb_logements integer,
          identifiant_dpe text,
          dpe_code_departement_insee text,
          arrete_2021 integer,
          classe_bilan_dpe text,
          classe_conso_energie_arrete_2012 text,
          surface_habitable_logement numeric,
          dpe_mix_arrete_classe text,
          usage_code_departement_insee text,
          usage_principal_bdnb_open text
        );
      `);

      await client.query(`
        INSERT INTO ${qualifiedTable} (
          batiment_groupe_id,
          geom_groupe,
          code_departement_insee,
          code_commune_insee,
          ffo_code_departement_insee,
          nb_niveau,
          annee_construction,
          usage_niveau_1_txt,
          mat_mur_txt,
          mat_toit_txt,
          nb_logements,
          identifiant_dpe,
          dpe_code_departement_insee,
          arrete_2021,
          classe_bilan_dpe,
          classe_conso_energie_arrete_2012,
          surface_habitable_logement,
          dpe_mix_arrete_classe,
          usage_code_departement_insee,
          usage_principal_bdnb_open
        )
        ${selectCore}
        ON CONFLICT (batiment_groupe_id) DO NOTHING;
      `);
    }

    // Pessac (33318) + Talence (33522) : géométrie seule, sans jointure FFO / DPE / usage. > 1000 m².
    await client.query(`DROP TABLE IF EXISTS public.bdnb_pessac_geom_raw;`);
    await client.query(`DROP TABLE IF EXISTS public.bdnb_talence_geom_raw;`);
    await client.query(`CREATE TABLE public.bdnb_pessac_geom_raw (
        batiment_groupe_id text PRIMARY KEY,
        geom_groupe geometry(MultiPolygon,2154) NOT NULL,
        code_commune_insee text NOT NULL,
        area_m2 double precision NOT NULL
      );`);
    await client.query(`CREATE TABLE public.bdnb_talence_geom_raw (
        batiment_groupe_id text PRIMARY KEY,
        geom_groupe geometry(MultiPolygon,2154) NOT NULL,
        code_commune_insee text NOT NULL,
        area_m2 double precision NOT NULL
      );`);
    await client.query(`
      INSERT INTO public.bdnb_pessac_geom_raw (batiment_groupe_id, geom_groupe, code_commune_insee, area_m2)
      SELECT
        bg.batiment_groupe_id,
        ST_SetSRID(ST_GeomFromText(bg.geom_groupe), 2154)::geometry(MultiPolygon,2154) AS geom_groupe,
        bg.code_commune_insee,
        ST_Area(ST_SetSRID(ST_GeomFromText(bg.geom_groupe), 2154)::geometry)::double precision AS area_m2
      FROM public._stg_bdnb_batiment_groupe bg
      WHERE bg.code_commune_insee = '33318'
        AND ST_Area(ST_SetSRID(ST_GeomFromText(bg.geom_groupe), 2154)::geometry) > 1000;
    `);
    await client.query(`
      INSERT INTO public.bdnb_talence_geom_raw (batiment_groupe_id, geom_groupe, code_commune_insee, area_m2)
      SELECT
        bg.batiment_groupe_id,
        ST_SetSRID(ST_GeomFromText(bg.geom_groupe), 2154)::geometry(MultiPolygon,2154) AS geom_groupe,
        bg.code_commune_insee,
        ST_Area(ST_SetSRID(ST_GeomFromText(bg.geom_groupe), 2154)::geometry)::double precision AS area_m2
      FROM public._stg_bdnb_batiment_groupe bg
      WHERE bg.code_commune_insee = '33522'
        AND ST_Area(ST_SetSRID(ST_GeomFromText(bg.geom_groupe), 2154)::geometry) > 1000;
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS bdnb_pessac_geom_raw_gix ON public.bdnb_pessac_geom_raw USING GIST (geom_groupe)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS bdnb_talence_geom_raw_gix ON public.bdnb_talence_geom_raw USING GIST (geom_groupe)`
    );
    const { rows: pessacGeomRows } = await client.query(
      `SELECT COUNT(*)::bigint AS n FROM public.bdnb_pessac_geom_raw`
    );
    const { rows: talenceGeomRows } = await client.query(
      `SELECT COUNT(*)::bigint AS n FROM public.bdnb_talence_geom_raw`
    );
    console.log("[bdnb] Pessac sans jointure (INSEE 33318, >1000 m²):", pessacGeomRows[0]);
    console.log("[bdnb] Talence sans jointure (INSEE 33522, >1000 m²):", talenceGeomRows[0]);

    await client.query(`
      DROP TABLE IF EXISTS public._stg_bdnb_batiment_groupe;
      DROP TABLE IF EXISTS public._stg_bdnb_ffo;
      DROP TABLE IF EXISTS public._stg_bdnb_usage;
      DROP TABLE IF EXISTS public._stg_bdnb_dpe_rep;
    `);

    await client.query(
      `CREATE INDEX IF NOT EXISTS ${idxPrefix}_geom_gix ON ${qualifiedTable} USING GIST (geom_groupe)`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS ${idxPrefix}_commune_idx ON ${qualifiedTable} (code_commune_insee)`
    );

    const { rows: stats } = await client.query(`
      SELECT
        COUNT(*)::bigint AS n,
        COUNT(*) FILTER (WHERE geom_groupe IS NULL)::bigint AS n_geom_null,
        MIN(ST_SRID(geom_groupe)) AS srid_min,
        MAX(ST_SRID(geom_groupe)) AS srid_max
      FROM ${qualifiedTable};
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
