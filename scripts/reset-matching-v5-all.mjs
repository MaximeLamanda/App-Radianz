#!/usr/bin/env node
/**
 * Vide **toute** la base résultat Matching V5 (features + combos), toutes communes.
 * Les tables d’import (cadastre, BDNB, OSM, PPM, établissements, …) ne sont pas touchées.
 *
 * Usage :
 *   DRY_RUN=1 node scripts/reset-matching-v5-all.mjs
 *   CONFIRM_RESET_ALL=1 node scripts/reset-matching-v5-all.mjs
 *   CONFIRM_RESET_ALL=1 node scripts/reset-matching-v5-all.mjs --targets=local
 *   CONFIRM_RESET_ALL=1 node scripts/reset-matching-v5-all.mjs --targets=neon
 */

import {
  BUILDINGS_MV,
  COMBOS_TABLE,
  FEATURES_TABLE,
  auditTarget,
  fmtTableCount,
  loadEnvLocal,
  parseTargets,
  pickLocalUrl,
  pickNeonUrl,
  truncateMatchingV5Tables,
  withClient,
} from "./lib/reset-matching-v5-shared.mjs";

function printAudit(label, audit, dryRun) {
  console.log(`\n[reset-matching-v5-all] ${label} (${dryRun ? "DRY_RUN" : "TRUNCATE"})`);
  console.log(
    `  ${fmtTableCount(FEATURES_TABLE, audit.features)}` +
      ` — ${audit.inseeFeatures ?? "?"} commune(s) distincte(s)`
  );
  console.log(
    `  ${fmtTableCount(COMBOS_TABLE, audit.combos)}` +
      ` — ${audit.inseeCombos ?? "?"} commune(s) distincte(s)`
  );
  if (audit.mvRows != null) {
    console.log(
      `  ${BUILDINGS_MV}=${audit.mvRows}` +
        (dryRun
          ? " (vue matérialisée : sera rafraîchie après TRUNCATE si présente)"
          : " (rafraîchie après TRUNCATE)")
    );
  }
  if (audit.byInsee?.features?.length) {
    console.log("  Top communes (features) :");
    for (const row of audit.byInsee.features) {
      console.log(`    ${row.codeInsee} → ${row.n}`);
    }
  }
  if (audit.byInsee?.combos?.length) {
    console.log("  Top communes (combos) :");
    for (const row of audit.byInsee.combos) {
      console.log(`    ${row.codeInsee} → ${row.n}`);
    }
  }
}

async function runTarget(label, url, dryRun) {
  await withClient(url, async (client) => {
    const before = await auditTarget(client);
    printAudit(label, before, dryRun);
    if (dryRun) return;
    const removed = await truncateMatchingV5Tables(client, { refreshMv: true });
    const after = await auditTarget(client);
    console.log(
      `[reset-matching-v5-all] ${label} supprimé :` +
        ` ${fmtTableCount(FEATURES_TABLE, removed[FEATURES_TABLE])},` +
        ` ${fmtTableCount(COMBOS_TABLE, removed[COMBOS_TABLE])}`
    );
    console.log(
      `[reset-matching-v5-all] ${label} après purge :` +
        ` features=${after.features ?? 0}, combos=${after.combos ?? 0}, mv=${after.mvRows ?? "n/a"}`
    );
    if ((after.features ?? 0) > 0 || (after.combos ?? 0) > 0) {
      throw new Error("Reliquat détecté après TRUNCATE");
    }
  });
}

async function main() {
  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  const confirm = process.env.CONFIRM_RESET_ALL === "1";
  const targets = parseTargets(process.argv.slice(2));
  const dot = loadEnvLocal();

  if (!dryRun && !confirm) {
    console.error(
      "[reset-matching-v5-all] Refus d’exécuter sans garde-fou.\n" +
        "  DRY_RUN=1           → inventaire complet sans modifier\n" +
        "  CONFIRM_RESET_ALL=1 → TRUNCATE features + combos (toutes communes)"
    );
    process.exit(1);
  }

  const localUrl = pickLocalUrl(dot);
  const neon = pickNeonUrl(dot);

  if (targets.has("local") && !localUrl) {
    console.error("[reset-matching-v5-all] LOCAL_DATABASE_URL manquant");
    process.exit(1);
  }
  if (targets.has("neon") && !neon) {
    console.error("[reset-matching-v5-all] URL Neon introuvable");
    process.exit(1);
  }

  console.error(
    "[reset-matching-v5-all] Périmètre : scout_matching_v5_features + scout_matching_v5_combos uniquement."
  );
  console.error("[reset-matching-v5-all] Imports (cadastre, BDNB, OSM, PPM, …) : inchangés.");

  if (targets.has("local") && localUrl) {
    await runTarget("local", localUrl, dryRun);
  }
  if (targets.has("neon") && neon) {
    await runTarget(`neon (${neon.source})`, neon.url, dryRun);
  }

  if (dryRun) {
    console.error(
      "\n[reset-matching-v5-all] DRY_RUN terminé. Pour purger : CONFIRM_RESET_ALL=1 node scripts/reset-matching-v5-all.mjs"
    );
  } else {
    console.error("\n[reset-matching-v5-all] OK — aucun reliquat matching/combos sur les cibles traitées.");
  }
}

main().catch((err) => {
  console.error("[reset-matching-v5-all] Erreur:", err);
  process.exit(1);
});
