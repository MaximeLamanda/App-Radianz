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
 * Surface empreinte groupe (Lambert 2154) :
 *   --min-groupe-area-m2=400 (défaut si ni flag ni BDNB_MIN_GROUPE_AREA_M2) : ne garde que les
 *   batiment_groupe dont ST_Area(geom_groupe) >= seuil. Pour un MultiPolygon, l’aire = somme des
 *   polygones (bâtiment seul large ou groupe dont la somme des empreintes atteint le seuil).
 *   --min-groupe-area-m2=0 : pas de filtre surface (import complet sur le périmètre communal / dept).
 *
 * Avancement (stdout) :
 *   --progress-every=N : jalon toutes les N lignes CSV lues par fichier (défaut 100000 en mode commune)
 *   En mode --all --departements=… sans --progress-every= explicite, défaut 5000 (progression plus granulaire).
 *   --progress-every=0 : désactiver les jalons intermédiaires
 *   --quiet : pas de jalons (sauf erreurs)
 *
 * Les messages d’avancement vont sur stdout (console.log), pas stderr — pour rester visibles
 * là où seuls les logs « npm » / stdout sont affichés.
 *
 * Env :
 *   BDNB_BUILDINGS_TABLE — défaut public.bdnb_buildings (voir lib/bdnb-buildings-table.ts)
 *   BDNB_MIN_GROUPE_AREA_M2 — seuil m² si le flag --min-groupe-area-m2= est absent (0 = désactiver ; le flag CLI prime)
 *
 * Schéma : la table inclut toutes les colonnes issues des CSV staging (FFO, DPE, usage, départements).
 * Si une base a encore l’ancienne table (moins de colonnes), supprimer la table ou lancer sans --append
 * puis réimporter pour recréer le schéma complet.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Transform } from "node:stream";
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
 * @param {{
 *   filter?: (fullRow: Record<string, string>) => boolean;
 *   progressLabel?: string;
 *   progressEvery?: number;
 *   quiet?: boolean;
 *   clearDdlHeartbeat?: () => void;
 * }} opts
 */
async function copyCsvSelectedColumns(
  client,
  {
    table,
    columns,
    filePath,
    filter,
    progressLabel,
    progressEvery = 100_000,
    quiet = false,
    clearDdlHeartbeat,
  }
) {
  clearDdlHeartbeat?.();

  const sql = `COPY ${table}(${columns.join(",")}) FROM STDIN WITH (FORMAT csv, DELIMITER ';', HEADER true, QUOTE '\"')`;
  const label = progressLabel || path.basename(filePath);
  const every = Math.max(0, Number(progressEvery) || 0);
  const t0 = Date.now();

  if (!quiet) {
    let sizeHint = "";
    try {
      const bytes = fs.statSync(filePath).size;
      sizeHint = ` — fichier ${(bytes / (1024 * 1024)).toFixed(1)} Mio`;
    } catch {
      /* ignore */
    }
    const freq =
      every <= 0 ? "sans jalons intermédiaires" : `jalon toutes les ${every.toLocaleString("fr-FR")} lignes lues`;
    console.log(`[bdnb] ${label}${sizeHint} ; ${freq}`);
    console.log(
      `[bdnb] ${label}: chaque ligne CSV peut être très longue (WKT géom_groupe). ` +
        "readline n’émet un événement qu’après une ligne complète : les jalons « par ligne » peuvent rester silencieux longtemps ; pulsation toutes les 12s ci-dessous."
    );
  }

  await new Promise((resolve, reject) => {
    const copyStream = client.query(copyFrom(sql));
    let linesRead = 0;
    let linesWritten = 0;
    let header = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    let heartbeat = null;

    const clearHb = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };

    const rejectWithCleanup = (err) => {
      clearHb();
      reject(err);
    };

    copyStream.on("error", rejectWithCleanup);
    copyStream.on("finish", () => {
      clearHb();
      resolve();
    });

    /** Octets déjà passés dans le fichier (chunks) — avance pendant l’assemblage d’une ligne WKT géante (readline). */
    let rawBytesIn = 0;
    const byteCount = new Transform({
      transform(chunk, _enc, cb) {
        rawBytesIn += chunk.length;
        cb(null, chunk);
      },
    });
    byteCount.on("error", rejectWithCleanup);

    const fileIn = fs.createReadStream(filePath);
    fileIn.on("error", rejectWithCleanup);
    fileIn.pipe(byteCount);

    const rl = readline.createInterface({
      input: byteCount,
      crlfDelay: Infinity,
    });

    if (!quiet) {
      heartbeat = setInterval(() => {
        const elapsedS = ((Date.now() - t0) / 1000).toFixed(0);
        const stuckOnFirstData =
          header !== null && linesRead === 0 ? " (0 ligne complète encore ; lecture WKT en cours ou parse synchrone)" : "";
        const mibRaw = (rawBytesIn / (1024 * 1024)).toFixed(2);
        console.log(
          `[bdnb] ${label}: pulsation +${elapsedS}s — ${linesRead.toLocaleString("fr-FR")} ligne(s) CSV terminée(s), ` +
            `${linesWritten.toLocaleString("fr-FR")} ligne(s) COPY ; flux brut ${mibRaw} Mio lus${stuckOnFirstData}`
        );
      }, 12_000);
    }

    let idxs = null;

    const maybeLog = () => {
      if (quiet) return;
      const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);
      if (linesRead === 1) {
        console.log(`[bdnb] ${label}: première ligne CSV de données lue [+${elapsedS}s]`);
      }
      if (every <= 0) return;
      if (linesRead > 0 && linesRead % every === 0) {
        console.log(
          `[bdnb] ${label}: ${linesRead.toLocaleString("fr-FR")} ligne(s) CSV lue(s), ` +
            `${linesWritten.toLocaleString("fr-FR")} ligne(s) envoyée(s) au COPY (filtre inclus) ` +
            `[+${elapsedS}s]`
        );
      }
    };

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
      linesRead += 1;
      const fields = parseSemicolonCsvLine(line);
      if (filter) {
        const fullRow = {};
        for (let i = 0; i < header.length; i++) {
          fullRow[header[i]] = fields[i] ?? "";
        }
        if (!filter(fullRow)) {
          maybeLog();
          return;
        }
      }
      linesWritten += 1;
      const picked = idxs.map((i) => formatSemicolonCsvField(fields[i] ?? ""));
      copyStream.write(picked.join(";") + "\n");
      maybeLog();
    });

    rl.on("close", () => {
      clearHb();
      if (!quiet) {
        const totalS = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(
          `[bdnb] ${label}: terminé en ${totalS}s — ${linesRead.toLocaleString("fr-FR")} ligne(s) lue(s), ` +
            `${linesWritten.toLocaleString("fr-FR")} ligne(s) insérée(s) via COPY`
        );
      }
      copyStream.end();
    });

    rl.on("error", rejectWithCleanup);
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
  let progressEvery = 100_000;
  let progressEveryExplicit = false;
  let quiet = false;
  /** @type {number | undefined} */
  let minGroupeAreaM2Cli = undefined;
  for (const a of argv) {
    if (a === "--all") all = true;
    else if (a === "--append") append = true;
    else if (a === "--quiet") quiet = true;
    else if (a.startsWith("--progress-every=")) {
      progressEveryExplicit = true;
      const n = parseInt(a.slice("--progress-every=".length).trim(), 10);
      if (!Number.isNaN(n)) progressEvery = Math.max(0, n);
    } else if (a.startsWith("--data-dir="))
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
    else if (a.startsWith("--min-groupe-area-m2=")) {
      const raw = a.slice("--min-groupe-area-m2=".length).trim();
      minGroupeAreaM2Cli = Number(raw);
      if (raw === "" || Number.isNaN(minGroupeAreaM2Cli)) {
        throw new Error(`Valeur numérique attendue pour --min-groupe-area-m2= (reçu : ${JSON.stringify(raw)})`);
      }
    }
  }
  if (!dataDir) {
    throw new Error("Argument requis: --data-dir=chemin/vers/extract_csv_bdnb");
  }
  if (all && departements && departements.length > 0 && !progressEveryExplicit) {
    progressEvery = 5_000;
  }
  if (all)
    return {
      commune: null,
      communes: null,
      all: true,
      append,
      dataDir,
      departements,
      progressEvery,
      quiet,
      minGroupeAreaM2Cli,
    };
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
    return {
      commune: null,
      communes,
      all: false,
      append,
      dataDir,
      departements,
      progressEvery,
      quiet,
      minGroupeAreaM2Cli,
    };
  if (!commune) commune = "33063";
  return {
    commune,
    communes: null,
    all: false,
    append,
    dataDir,
    departements,
    progressEvery,
    quiet,
    minGroupeAreaM2Cli,
  };
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

/** Aire empreinte au sol `geom_groupe` (2154). `minM2 <= 0` → pas de filtre. */
function buildGroupeFootprintAreaFilterSql(minM2) {
  if (!(minM2 > 0)) return "";
  const m = Number(minM2);
  if (!Number.isFinite(m) || m < 0) {
    throw new Error(`Seuil surface groupe invalide (attendu >= 0) : ${minM2}`);
  }
  return ` AND bg.geom_groupe IS NOT NULL AND ST_Area(ST_SetSRID(ST_GeomFromText(bg.geom_groupe), 2154)::geometry) >= ${m}`;
}

/**
 * @param {number | undefined} cliExplicit — si défini, provient de `--min-groupe-area-m2=` (prioritaire).
 * @returns {number} m² ; 0 = désactiver le filtre surface sur la table principale.
 */
function resolveMinGroupeAreaM2(cliExplicit) {
  if (cliExplicit !== undefined) {
    if (!Number.isFinite(cliExplicit) || cliExplicit < 0) {
      throw new Error(`--min-groupe-area-m2 invalide : ${cliExplicit}`);
    }
    return cliExplicit;
  }
  const e = process.env.BDNB_MIN_GROUPE_AREA_M2?.trim();
  if (e !== undefined && e !== "") {
    const n = Number(e);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`BDNB_MIN_GROUPE_AREA_M2 invalide : ${process.env.BDNB_MIN_GROUPE_AREA_M2}`);
    }
    return n;
  }
  return 400;
}

/**
 * Requête SQL avec log timing (diagnostic : CREATE EXTENSION postgis peut bloquer longtemps).
 * @param {{ phase: string; phaseStartedAt: number | null }} ddlCtx — lu par la pulsation DDL
 */
async function bdnbSql(client, phaseLabel, sql, quiet, ddlCtx) {
  ddlCtx.phase = phaseLabel;
  ddlCtx.phaseStartedAt = Date.now();
  if (!quiet) console.log(`[bdnb] SQL ▶ ${phaseLabel}…`);
  const t = Date.now();
  try {
    const res = await client.query(sql);
    if (!quiet) {
      console.log(`[bdnb] SQL ◀ ${phaseLabel} — ${((Date.now() - t) / 1000).toFixed(1)}s`);
    }
    return res;
  } catch (e) {
    if (!quiet) {
      console.log(
        `[bdnb] SQL ✖ ${phaseLabel} — erreur après ${((Date.now() - t) / 1000).toFixed(1)}s :`,
        /** @type {Error} */ (e).message
      );
    }
    throw e;
  } finally {
    ddlCtx.phaseStartedAt = null;
  }
}

async function main() {
  const {
    commune: communeFilter,
    communes: communesFilters,
    all: importAll,
    append,
    dataDir,
    departements: departementsArg,
    progressEvery,
    quiet,
    minGroupeAreaM2Cli,
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
  const minGroupeAreaM2 = resolveMinGroupeAreaM2(minGroupeAreaM2Cli);
  const groupeAreaSql = buildGroupeFootprintAreaFilterSql(minGroupeAreaM2);

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
  if (!quiet && progressEvery > 0) {
    console.log(
      `[bdnb] Avancement CSV : jalon toutes les ${progressEvery.toLocaleString("fr-FR")} lignes lues ` +
        `(--progress-every=0 pour désactiver, --quiet pour tout masquer sauf erreurs).`
    );
  }
  if (!quiet) {
    if (minGroupeAreaM2 > 0) {
      console.log(
        `[bdnb] Filtre empreinte groupe : ST_Area(geom_groupe) >= ${minGroupeAreaM2} m² (Lambert 2154). ` +
          `Désactiver : --min-groupe-area-m2=0`
      );
    } else {
      console.log("[bdnb] Filtre empreinte groupe : désactivé (import toutes les géométries du périmètre).");
    }
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
        ${groupeAreaSql}
  `;

  /** Pulsation pendant l’import ; `ddlCtx.phase` = dernière requête lancée (voir SQL ▶). BEGIN arrive après le DDL staging. */
  let ddlHeartbeat = null;
  const clearDdlHeartbeat = () => {
    if (ddlHeartbeat) {
      clearInterval(ddlHeartbeat);
      ddlHeartbeat = null;
    }
  };
  const ddlCtx = { phase: "", phaseStartedAt: /** @type {number | null} */ (null) };
  const csvProgress = { progressEvery, quiet, clearDdlHeartbeat };

  try {
    const tBegin = Date.now();
    if (!quiet) {
      console.log(
        "[bdnb] Import : logs SQL ▶ / ◀ avec durée ; pulsation toutes les 12s. " +
          "Le DDL pré-staging (extension, DROP/CREATE _stg_*) s’exécute hors BEGIN, puis BEGIN avant les COPY."
      );
      ddlHeartbeat = setInterval(() => {
        const sinceBegin = ((Date.now() - tBegin) / 1000).toFixed(0);
        const phase = ddlCtx.phase || "?";
        const onStep =
          ddlCtx.phaseStartedAt != null
            ? ((Date.now() - ddlCtx.phaseStartedAt) / 1000).toFixed(0)
            : "?";
        let hint = "";
        if (phase.includes("postgis")) {
          hint = " — CREATE EXTENSION peut être lent la 1ère fois.";
        } else if (phase.includes("CREATE _stg_")) {
          hint =
            " — une CREATE staging vide est normalement < 1s : si ça dure, chercher un verrou (autre session, import concurrent) ou la latence pooler (ex. Neon : connexion directe / non-pooled pour le DDL).";
        } else if (phase === "BEGIN") {
          hint = " — transaction ouverte pour COPY + table finale.";
        }
        console.log(
          `[bdnb] Pulsation +${sinceBegin}s depuis début import — étape « ${phase} » bloquée ~${onStep}s${hint}`
        );
      }, 12_000);
    }
    await bdnbSql(
      client,
      "SET lock_timeout (évite attente infinie sur verrous)",
      "SET lock_timeout = '90s'",
      quiet,
      ddlCtx
    );
    await bdnbSql(
      client,
      "CREATE EXTENSION postgis (souvent long la 1ère fois)",
      "CREATE EXTENSION IF NOT EXISTS postgis",
      quiet,
      ddlCtx
    );

    await bdnbSql(
      client,
      "DROP IF EXISTS tables staging _stg_bdnb_*",
      `
      DROP TABLE IF EXISTS public._stg_bdnb_batiment_groupe;
      DROP TABLE IF EXISTS public._stg_bdnb_ffo;
      DROP TABLE IF EXISTS public._stg_bdnb_usage;
      DROP TABLE IF EXISTS public._stg_bdnb_dpe_rep;
    `,
      quiet,
      ddlCtx
    );

    await bdnbSql(
      client,
      "CREATE _stg_bdnb_batiment_groupe",
      `
      CREATE TABLE public._stg_bdnb_batiment_groupe (
        batiment_groupe_id text,
        code_departement_insee text,
        code_commune_insee text,
        geom_groupe text
      );
    `,
      quiet,
      ddlCtx
    );

    await bdnbSql(
      client,
      "CREATE _stg_bdnb_ffo",
      `
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
    `,
      quiet,
      ddlCtx
    );

    await bdnbSql(
      client,
      "CREATE _stg_bdnb_usage",
      `
      CREATE TABLE public._stg_bdnb_usage (
        batiment_groupe_id text,
        code_departement_insee text,
        usage_principal_bdnb_open text
      );
    `,
      quiet,
      ddlCtx
    );

    await bdnbSql(
      client,
      "CREATE _stg_bdnb_dpe_rep",
      `
      CREATE TABLE public._stg_bdnb_dpe_rep (
        batiment_groupe_id text,
        identifiant_dpe text,
        code_departement_insee text,
        arrete_2021 integer,
        classe_bilan_dpe text,
        classe_conso_energie_arrete_2012 text,
        surface_habitable_logement numeric
      );
    `,
      quiet,
      ddlCtx
    );

    if (!quiet) {
      console.log(
        "[bdnb] DDL pré-staging terminé (autocommit). Ouverture de la transaction pour COPY + création table finale…"
      );
    }
    await bdnbSql(client, "BEGIN (transaction COPY + table finale)", "BEGIN", quiet, ddlCtx);

    if (!quiet) console.log("[bdnb] COPY staging : batiment_groupe.csv …");
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
      progressLabel: "batiment_groupe.csv → _stg_bdnb_batiment_groupe",
      ...csvProgress,
    });

    if (!quiet) console.log("[bdnb] COPY staging : batiment_groupe_ffo_bat.csv …");
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
      progressLabel: "batiment_groupe_ffo_bat.csv → _stg_bdnb_ffo",
      ...csvProgress,
    });

    if (!quiet) console.log("[bdnb] COPY staging : batiment_groupe_synthese_propriete_usage.csv …");
    await copyCsvSelectedColumns(client, {
      table: "public._stg_bdnb_usage",
      columns: [
        "batiment_groupe_id",
        "code_departement_insee",
        "usage_principal_bdnb_open",
      ],
      filePath: files.usage,
      filter: filterByAllowedIds,
      progressLabel: "batiment_groupe_synthese_propriete_usage.csv → _stg_bdnb_usage",
      ...csvProgress,
    });

    if (!quiet) console.log("[bdnb] COPY staging : batiment_groupe_dpe_representatif_logement.csv …");
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
      progressLabel: "batiment_groupe_dpe_representatif_logement.csv → _stg_bdnb_dpe_rep",
      ...csvProgress,
    });

    // Sans index, chaque LATERAL (FFO / DPE / usage) peut ressembler à un seq scan sur tout le staging
    // pour chaque ligne de batiment_groupe — facilement 15–30+ min sur un dept entier.
    if (!quiet) {
      console.log(
        "[bdnb] Index batiment_groupe_id sur _stg_ffo / _stg_dpe_rep / _stg_usage + ANALYZE (accélère le CREATE TABLE AS)…"
      );
    }
    const tStgIdx = Date.now();
    await client.query(
      `CREATE INDEX _stg_bdnb_ffo_batiment_groupe_id_idx ON public._stg_bdnb_ffo (batiment_groupe_id)`
    );
    await client.query(
      `CREATE INDEX _stg_bdnb_dpe_rep_batiment_groupe_id_idx ON public._stg_bdnb_dpe_rep (batiment_groupe_id)`
    );
    await client.query(
      `CREATE INDEX _stg_bdnb_usage_batiment_groupe_id_idx ON public._stg_bdnb_usage (batiment_groupe_id)`
    );
    await client.query(`
      ANALYZE public._stg_bdnb_batiment_groupe, public._stg_bdnb_ffo, public._stg_bdnb_dpe_rep, public._stg_bdnb_usage
    `);
    if (!quiet) {
      console.log(
        `[bdnb] Index staging + ANALYZE terminés en ${((Date.now() - tStgIdx) / 1000).toFixed(1)}s`
      );
    }

    if (!append) {
      await client.query(`DROP TABLE IF EXISTS ${qualifiedTable};`);

      if (!quiet) {
        console.log(
          "[bdnb] Étape SQL : CREATE TABLE AS (jointures FFO/DPE/usage + filtre dept/surface) — " +
            "peut prendre plusieurs minutes ; rappel toutes les 30s sur stdout…"
        );
      }
      const tCreateAs = Date.now();
      const hbCreate = !quiet
        ? setInterval(() => {
            console.log(
              `[bdnb] Étape SQL : CREATE TABLE AS toujours en cours… ${((Date.now() - tCreateAs) / 1000).toFixed(0)}s`
            );
          }, 30_000)
        : null;
      try {
        await client.query(`
        CREATE TABLE ${qualifiedTable} AS
        ${selectCore};
      `);
      } finally {
        if (hbCreate) clearInterval(hbCreate);
      }
      if (!quiet) {
        console.log(
          `[bdnb] Étape SQL : CREATE TABLE AS terminée en ${((Date.now() - tCreateAs) / 1000).toFixed(1)}s`
        );
      }

      if (!quiet) console.log(`[bdnb] Étape SQL : ALTER TABLE … ADD PRIMARY KEY (${qualifiedTable})…`);
      const tPk = Date.now();
      await client.query(`ALTER TABLE ${qualifiedTable} ADD PRIMARY KEY (batiment_groupe_id);`);
      if (!quiet) {
        console.log(`[bdnb] Étape SQL : PRIMARY KEY créée en ${((Date.now() - tPk) / 1000).toFixed(1)}s`);
      }
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

      if (!quiet) {
        console.log(
          "[bdnb] Étape SQL : INSERT … ON CONFLICT (append, jointures + géométrie) — peut prendre plusieurs minutes ; rappel 30s…"
        );
      }
      const tInsert = Date.now();
      const hbInsert = !quiet
        ? setInterval(() => {
            console.log(
              `[bdnb] Étape SQL : INSERT append toujours en cours… ${((Date.now() - tInsert) / 1000).toFixed(0)}s`
            );
          }, 30_000)
        : null;
      try {
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
      } finally {
        if (hbInsert) clearInterval(hbInsert);
      }
      if (!quiet) {
        console.log(`[bdnb] Étape SQL : INSERT append terminé en ${((Date.now() - tInsert) / 1000).toFixed(1)}s`);
      }
    }

    const pessacTalenceAreaCond =
      minGroupeAreaM2 > 0
        ? `ST_Area(ST_SetSRID(ST_GeomFromText(bg.geom_groupe), 2154)::geometry) >= ${Number(minGroupeAreaM2)}`
        : `ST_Area(ST_SetSRID(ST_GeomFromText(bg.geom_groupe), 2154)::geometry) > 1000`;

    // Pessac (33318) + Talence (33522) : géométrie seule, sans jointure FFO / DPE / usage.
    if (!quiet) {
      console.log(
        `[bdnb] Tables auxiliaires Pessac / Talence (filtre aire : ${
          minGroupeAreaM2 > 0 ? `>= ${minGroupeAreaM2} m²` : "> 1000 m² (filtre principal désactivé)"
        })…`
      );
    }
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
        AND ${pessacTalenceAreaCond};
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
        AND ${pessacTalenceAreaCond};
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
    console.log(
      `[bdnb] Pessac sans jointure (INSEE 33318, ${minGroupeAreaM2 > 0 ? `>= ${minGroupeAreaM2} m²` : "> 1000 m²"}):`,
      pessacGeomRows[0]
    );
    console.log(
      `[bdnb] Talence sans jointure (INSEE 33522, ${minGroupeAreaM2 > 0 ? `>= ${minGroupeAreaM2} m²` : "> 1000 m²"}):`,
      talenceGeomRows[0]
    );

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

    await client.query("RESET lock_timeout");
    await client.query("COMMIT");
  } catch (e) {
    clearDdlHeartbeat();
    try {
      await client.query("RESET lock_timeout");
    } catch {}
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    clearDdlHeartbeat();
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
