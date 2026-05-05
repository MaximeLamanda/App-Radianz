/**
 * Supprime de public.bdnb_buildings (ou BDNB_BUILDINGS_TABLE) les groupes
 * classés « résidentiel individuel » d’après BDNB / FFO :
 * - usage_principal_bdnb_open (synthèse usage)
 * - usage_niveau_1_txt (FFO)
 *
 * Nettoie aussi : BDNB_CONSTRUCTIONS_TABLE, bdnb_pessac_geom_raw, bdnb_talence_geom_raw,
 * BDNB_FFO_TABLE (défaut public.batiment_groupe_ffo_bat, colonne usage_niveau_1_txt).
 *
 * Usage :
 *   node scripts/delete-bdnb-residentiel-individuel.mjs --dry-run
 *   node scripts/delete-bdnb-residentiel-individuel.mjs
 *
 * Connexion : resolve-database-url (LOCAL_DATABASE_URL prioritaire, etc.).
 */
import path from "node:path";
import { Client } from "pg";
import { loadDotenvMap, resolveDatabaseUrl } from "./lib/resolve-database-url.mjs";

const IDENT = /^[a-z][a-z0-9_]*$/;

function parseQualifiedTable(raw, fallbackSchema, fallbackTable) {
  const t = (raw || `${fallbackSchema}.${fallbackTable}`).trim();
  const parts = t.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    return { schema: fallbackSchema, table: parts[0] };
  }
  if (parts.length === 2) {
    return { schema: parts[0], table: parts[1] };
  }
  throw new Error(`Nom de table invalide: ${raw}`);
}

function validateIdent(name, label) {
  if (!IDENT.test(name)) {
    throw new Error(`${label} invalide: "${name}"`);
  }
}

function qualify(schema, table) {
  validateIdent(schema, "Schéma");
  validateIdent(table, "Table");
  return `"${schema}"."${table}"`;
}

/** Libellés BDNB type « Résidentiel individuel » (ILIKE). Préfixe table `b.`. */
const RESIDENTIEL_INDIVIDUEL_PRED = `(
  (NULLIF(trim(COALESCE(b.usage_principal_bdnb_open, '')), '') IS NOT NULL
   AND trim(COALESCE(b.usage_principal_bdnb_open, '')) ILIKE '%résidentiel%individuel%')
  OR
  (NULLIF(trim(COALESCE(b.usage_niveau_1_txt, '')), '') IS NOT NULL
   AND trim(COALESCE(b.usage_niveau_1_txt, '')) ILIKE '%résidentiel%individuel%')
)`;

/**
 * Table FFO : libellé officiel BDNB « Résidentiel individuel » (égalité après trim).
 * Pour un mode plus large (ex. libellés composés), définir BDNB_FFO_USAGE_LOOSE=1 :
 * alors ILIKE '%résidentiel%individuel%' (attention au volume).
 */
function residentielIndividuelPredFfo() {
  if (process.env.BDNB_FFO_USAGE_LOOSE === "1") {
    return `(
  NULLIF(trim(COALESCE(f.usage_niveau_1_txt, '')), '') IS NOT NULL
  AND trim(COALESCE(f.usage_niveau_1_txt, '')) ILIKE '%résidentiel%individuel%'
)`;
  }
  return `(
  NULLIF(trim(COALESCE(f.usage_niveau_1_txt, '')), '') IS NOT NULL
  AND trim(COALESCE(f.usage_niveau_1_txt, '')) = 'Résidentiel individuel'
)`;
}

const root = process.cwd();
const dot = loadDotenvMap(path.join(root, ".env.local"));
for (const [k, v] of Object.entries(dot)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

const dryRun = process.argv.includes("--dry-run");

const buildingsRaw = (process.env.BDNB_BUILDINGS_TABLE || "public.bdnb_buildings").trim();
const { schema: bs, table: bt } = parseQualifiedTable(buildingsRaw, "public", "bdnb_buildings");
const buildingsQ = qualify(bs, bt);

const constructionsRaw = (process.env.BDNB_CONSTRUCTIONS_TABLE || "public.batiment_construction").trim();
const { schema: cs, table: ct } = parseQualifiedTable(constructionsRaw, "public", "batiment_construction");
const constructionsQ = qualify(cs, ct);

const ffoRaw = (process.env.BDNB_FFO_TABLE || "public.batiment_groupe_ffo_bat").trim();
const { schema: fs, table: ft } = parseQualifiedTable(ffoRaw, "public", "batiment_groupe_ffo_bat");
const ffoQ = qualify(fs, ft);

const databaseUrl = resolveDatabaseUrl(root);
if (!databaseUrl) {
  console.error("Aucune URL Postgres (voir .env.local / DATABASE_URL).");
  process.exit(1);
}

async function tableExists(client, schema, table) {
  const { rows } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2
    ) AS ok`,
    [schema, table]
  );
  return Boolean(rows[0]?.ok);
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::bigint AS n FROM ${buildingsQ} b WHERE ${RESIDENTIEL_INDIVIDUEL_PRED.replace(/\n/g, " ")}`
    );
    const n = Number(countRows[0]?.n ?? 0);
    console.log(`[bdnb] Bâtiments « résidentiel individuel » (critère usage) : ${n}`);

    const hasFfo = await tableExists(client, fs, ft);
    let nf = 0;
    const predFfo = residentielIndividuelPredFfo();
    if (hasFfo) {
      const { rows: ffoCount } = await client.query(
        `SELECT COUNT(*)::bigint AS n FROM ${ffoQ} f WHERE ${predFfo.replace(/\n/g, " ")}`
      );
      nf = Number(ffoCount[0]?.n ?? 0);
      console.log(`[bdnb] Lignes FFO « résidentiel individuel » dans ${ffoQ} : ${nf}`);
    } else {
      console.log(`[bdnb] Table FFO absente, ignorée : ${ffoQ}`);
    }

    if (dryRun) {
      console.log("[bdnb] --dry-run : aucune suppression.");
      return;
    }
    if (n === 0 && nf === 0) {
      console.log("[bdnb] Rien à supprimer.");
      return;
    }

    const hasConstructions = await tableExists(client, cs, ct);
    const hasPessacRaw = await tableExists(client, "public", "bdnb_pessac_geom_raw");
    const hasTalenceRaw = await tableExists(client, "public", "bdnb_talence_geom_raw");

    await client.query("BEGIN");

    if (n > 0 && hasConstructions) {
      const delC = await client.query(
        `WITH doomed AS (
           SELECT b.batiment_groupe_id FROM ${buildingsQ} b WHERE ${RESIDENTIEL_INDIVIDUEL_PRED.replace(/\n/g, " ")}
         )
         DELETE FROM ${constructionsQ} c
         USING doomed d
         WHERE c.batiment_groupe_id = d.batiment_groupe_id`
      );
      console.log(`[bdnb] Lignes supprimées dans ${constructionsQ} : ${delC.rowCount ?? 0}`);
    } else if (n > 0) {
      console.log(`[bdnb] Table absente, ignorée : ${constructionsQ}`);
    }

    if (n > 0 && hasPessacRaw) {
      const r = await client.query(
        `WITH doomed AS (
           SELECT b.batiment_groupe_id FROM ${buildingsQ} b WHERE ${RESIDENTIEL_INDIVIDUEL_PRED.replace(/\n/g, " ")}
         )
         DELETE FROM public.bdnb_pessac_geom_raw p USING doomed d WHERE p.batiment_groupe_id = d.batiment_groupe_id`
      );
      console.log(`[bdnb] bdnb_pessac_geom_raw supprimées : ${r.rowCount ?? 0}`);
    }
    if (n > 0 && hasTalenceRaw) {
      const r = await client.query(
        `WITH doomed AS (
           SELECT b.batiment_groupe_id FROM ${buildingsQ} b WHERE ${RESIDENTIEL_INDIVIDUEL_PRED.replace(/\n/g, " ")}
         )
         DELETE FROM public.bdnb_talence_geom_raw t USING doomed d WHERE t.batiment_groupe_id = d.batiment_groupe_id`
      );
      console.log(`[bdnb] bdnb_talence_geom_raw supprimées : ${r.rowCount ?? 0}`);
    }

    if (hasFfo && nf > 0) {
      const delF = await client.query(
        `DELETE FROM ${ffoQ} f WHERE ${predFfo.replace(/\n/g, " ")}`
      );
      console.log(`[bdnb] Lignes supprimées dans ${ffoQ} : ${delF.rowCount ?? 0}`);
    }

    if (n > 0) {
      const delB = await client.query(
        `DELETE FROM ${buildingsQ} b WHERE ${RESIDENTIEL_INDIVIDUEL_PRED.replace(/\n/g, " ")}`
      );
      console.log(`[bdnb] Lignes supprimées dans ${buildingsQ} : ${delB.rowCount ?? 0}`);
    }

    await client.query("COMMIT");
    console.log("[bdnb] OK. Pense à VACUUM ANALYZE si la base est grosse (hors transaction).");
    console.log(
      "[bdnb] Si tu utilises scout_matching_v5_features / scout_leads, vérifie les orphelins éventuels."
    );
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
