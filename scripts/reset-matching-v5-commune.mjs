#!/usr/bin/env node
/**
 * Supprime les données Matching V5 (features + combos) pour une commune.
 * Voir reset-matching-v5-all.mjs pour vider toute la base.
 *
 * Usage :
 *   DRY_RUN=1 node scripts/reset-matching-v5-commune.mjs --code-insee=33318
 *   CONFIRM_RESET=1 node scripts/reset-matching-v5-commune.mjs --code-insee=33318
 */

import {
  COMBOS_TABLE,
  FEATURES_TABLE,
  auditTarget,
  deleteMatchingV5ByInsee,
  fmtTableCount,
  loadEnvLocal,
  parseTargets,
  pickLocalUrl,
  pickNeonUrl,
  withClient,
} from "./lib/reset-matching-v5-shared.mjs";

function parseCodeInsee(argv) {
  const a = argv.find((x) => x.startsWith("--code-insee="));
  if (a) return a.slice("--code-insee=".length).trim();
  const i = argv.indexOf("--code-insee");
  if (i >= 0 && argv[i + 1]) return String(argv[i + 1]).trim();
  return null;
}

async function runOnTarget(label, url, codeInsee, dryRun) {
  await withClient(url, async (client) => {
    const before = await auditTarget(client, { codeInsee });
    console.log(
      `[reset-matching-v5] ${label} (${dryRun ? "DRY_RUN" : "DELETE"}) code_insee=${codeInsee} :` +
        ` ${fmtTableCount(FEATURES_TABLE, before.features)},` +
        ` ${fmtTableCount(COMBOS_TABLE, before.combos)}`
    );
    if (dryRun) return;
    await deleteMatchingV5ByInsee(client, codeInsee);
    const after = await auditTarget(client, { codeInsee });
    if ((after.features ?? 0) > 0 || (after.combos ?? 0) > 0) {
      throw new Error(`Reliquat pour ${codeInsee} après DELETE`);
    }
  });
}

async function main() {
  const codeInsee = parseCodeInsee(process.argv.slice(2));
  if (!codeInsee || !/^\d{5}$/.test(codeInsee)) {
    console.error("Usage: node scripts/reset-matching-v5-commune.mjs --code-insee=<INSEE>");
    process.exit(1);
  }

  const targets = parseTargets(process.argv.slice(2));
  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  const confirm = process.env.CONFIRM_RESET === "1";
  const dot = loadEnvLocal();

  if (!dryRun && !confirm) {
    console.error(
      "[reset-matching-v5] DRY_RUN=1 ou CONFIRM_RESET=1 requis pour supprimer."
    );
    process.exit(1);
  }

  const localUrl = pickLocalUrl(dot);
  const neon = pickNeonUrl(dot);

  if (targets.has("local") && !localUrl) {
    console.error("[reset-matching-v5] LOCAL_DATABASE_URL manquant");
    process.exit(1);
  }
  if (targets.has("neon") && !neon) {
    console.error("[reset-matching-v5] URL Neon introuvable");
    process.exit(1);
  }

  if (targets.has("local") && localUrl) {
    await runOnTarget("local", localUrl, codeInsee, dryRun);
  }
  if (targets.has("neon") && neon) {
    await runOnTarget(`neon (${neon.source})`, neon.url, codeInsee, dryRun);
  }

  if (dryRun) {
    console.error("[reset-matching-v5] DRY_RUN terminé.");
  } else {
    console.error("[reset-matching-v5] OK — imports inchangés.");
  }
}

main().catch((err) => {
  console.error("[reset-matching-v5] Erreur:", err);
  process.exit(1);
});
