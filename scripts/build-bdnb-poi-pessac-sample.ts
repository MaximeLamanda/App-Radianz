/**
 * Compatibilité : délègue à `build-bdnb-poi-sample.ts` avec commune **33318** si aucune variable INSEE n’est définie.
 * Préférez : `npx tsx scripts/build-bdnb-poi-sample.ts` et `BDNB_POI_SAMPLE_COMMUNE_INSEE` / `COMMUNE_INSEE`.
 */
if (
  !process.env.BDNB_POI_SAMPLE_COMMUNE_INSEE?.trim() &&
  !process.env.COMMUNE_INSEE?.trim()
) {
  process.env.BDNB_POI_SAMPLE_COMMUNE_INSEE = "33318";
}

void import("./build-bdnb-poi-sample").catch((e) => {
  console.error(e);
  process.exit(1);
});
